import { CreditLedger } from './ledger.js';
import type { Candidate, Capability, Catalog, ProviderState, Risk, SiteEntry } from './types.js';

export interface RouterWeights {
  quality: number;
  reliability: number;
  headroom: number;
  risk: number;
  latency: number;
}

export const DEFAULT_WEIGHTS: RouterWeights = {
  quality: 0.35,
  reliability: 0.25,
  headroom: 0.2,
  risk: 0.15,
  latency: 0.05,
};

const RISK_SCORE: Record<Risk, number> = { low: 0, medium: 0.5, high: 1 };

/**
 * Capability router: picks the best free provider for a job.
 *
 * Score = quality + reliability + remaining-headroom - risk - latency,
 * with a hard filter on capability, configured allowance, cooldown and
 * circuit-breaker state. Failure opens a circuit with exponential cooldown so
 * a broken selector on one site does not stall the whole pipeline.
 */
export class CapabilityRouter {
  private readonly states = new Map<string, ProviderState>();

  constructor(
    private readonly catalog: Catalog,
    private readonly weights: RouterWeights = DEFAULT_WEIGHTS,
    private readonly now: () => number = () => Date.now(),
  ) {
    for (const state of defaultStates(catalog)) {
      this.states.set(stateKey(state.siteId, state.capability), state);
    }
  }

  state(siteId: string, capability: Capability): ProviderState {
    const state = this.states.get(stateKey(siteId, capability));
    if (!state) throw new Error(`no provider state for ${siteId}/${capability}`);
    return state;
  }

  /** All viable candidates, best first. */
  rank(capability: Capability, ledger: CreditLedger): Candidate[] {
    const candidates: Candidate[] = [];
    for (const site of this.catalog.sites) {
      if (!site.caps.includes(capability)) continue;
      if (site.free === null || site.access === 'none') continue;
      const state = this.state(site.id, capability);
      if (!state.enabled) continue;
      if (state.health.cooldownUntil !== null && state.health.cooldownUntil > this.now()) continue;
      const remainingRatio = ledger.remainingRatio(site);
      if (remainingRatio <= 0) continue;
      candidates.push({ site, state, score: this.score(state, remainingRatio), remainingRatio });
    }
    return candidates.sort((a, b) => b.score - a.score);
  }

  pick(capability: Capability, ledger: CreditLedger, exclude: ReadonlySet<string> = new Set()): Candidate | null {
    for (const candidate of this.rank(capability, ledger)) {
      if (exclude.has(candidate.site.id)) continue;
      return candidate;
    }
    return null;
  }

  score(state: ProviderState, remainingRatio: number): number {
    const w = this.weights;
    const latencyNorm = Math.min(1, state.health.latencyMs / 120_000);
    return (
      w.quality * state.quality +
      w.reliability * state.health.successEwma +
      w.headroom * remainingRatio -
      w.risk * RISK_SCORE[state.risk] -
      w.latency * latencyNorm
    );
  }

  /** Enhanced: apply site-specific headroom adjustment based on free tier limits */
  private adjustedRemainingRatio(state: ProviderState, remainingRatio: number, site: SiteEntry): number {
    // Apply confidence-based adjustments
    if (site.confidence === 'high') {
      // High confidence sites get a small boost for reliability
      return Math.min(1, remainingRatio * 1.1);
    } else if (site.confidence === 'medium') {
      // Medium confidence sites use raw ratio
      return remainingRatio;
    } else {
      // Low confidence sites get a penalty
      return Math.max(0, remainingRatio * 0.9);
    }
  }

  /** Feed real outcomes back into the routing model. */
  noteResult(
    siteId: string,
    capability: Capability,
    outcome: { ok: boolean; latencyMs?: number; charged?: boolean },
    ledger?: CreditLedger,
  ): void {
    const state = this.state(siteId, capability);
    const alpha = 0.2;
    state.health.successEwma = state.health.successEwma * (1 - alpha) + (outcome.ok ? alpha : 0);
    if (typeof outcome.latencyMs === 'number') {
      state.health.latencyMs = state.health.latencyMs * (1 - alpha) + outcome.latencyMs * alpha;
    }
    if (outcome.ok) {
      state.health.consecutiveFailures = 0;
      state.health.cooldownUntil = null;
      return;
    }
    state.health.consecutiveFailures += 1;
    const backoffMs = Math.min(30 * 60_000, 30_000 * 2 ** (state.health.consecutiveFailures - 1));
    state.health.cooldownUntil = this.now() + backoffMs;
    if (outcome.charged && ledger) {
      ledger.refund(findSite(this.catalog, siteId), 1);
    }
  }

  setEnabled(siteId: string, capability: Capability, enabled: boolean): void {
    this.state(siteId, capability).enabled = enabled;
  }
}

/** Enhanced: score with confidence-based headroom adjustment */
export function adjustedScore(state: ProviderState, remainingRatio: number, site: SiteEntry): number {
  const w = DEFAULT_WEIGHTS;
  const latencyNorm = Math.min(1, state.health.latencyMs / 120_000);
  // Use the same adjustment logic as the router's private method
  let adjRemaining: number;
  if (site.confidence === 'high') {
    adjRemaining = Math.min(1, remainingRatio * 1.1);
  } else if (site.confidence === 'medium') {
    adjRemaining = remainingRatio;
  } else {
    adjRemaining = Math.max(0, remainingRatio * 0.9);
  }
  return (
    w.quality * state.quality +
    w.reliability * state.health.successEwma +
    w.headroom * adjRemaining -
    w.risk * RISK_SCORE[state.risk] -
    w.latency * latencyNorm
  );
}

/** Enhanced: defaultStates with per-site headroom tuning */
export function defaultStates(catalog: Catalog): ProviderState[] {
  const states: ProviderState[] = [];
  for (const site of catalog.sites) {
    for (const capability of site.caps) {
      states.push({
        siteId: site.id,
        capability,
        quality: qualityFor(site, capability),
        risk: riskFor(site),
        concurrency: capability === 'upload' ? 1 : 2,
        enabled: site.access !== 'none',
        health: { successEwma: 0.6, latencyMs: 60_000, consecutiveFailures: 0, cooldownUntil: null },
      });
    }
  }
  return states;
}

function qualityFor(site: SiteEntry, capability: Capability): number {
  const base = site.confidence === 'high' ? 0.8 : site.confidence === 'medium' ? 0.65 : 0.5;
  const videoBonus = capability === 'text2video' || capability === 'image2video' ? 0.05 : 0;
  return Math.min(1, base + videoBonus);
}

function riskFor(site: SiteEntry): Risk {
  if (site.access === 'api' || site.access === 'both') return 'low';
  return site.confidence === 'high' ? 'medium' : 'high';
}

function stateKey(siteId: string, capability: Capability): string {
  return `${siteId}::${capability}`;
}

function findSite(catalog: Catalog, siteId: string): SiteEntry {
  const site = catalog.sites.find((candidate) => candidate.id === siteId);
  if (!site) throw new Error(`unknown site ${siteId}`);
  return site;
}