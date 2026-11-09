import type { SiteEntry } from './types.js';

export interface PolicyConfig {
  /** Sites whose automation is known to violate a platform's terms. */
  blockedSiteIds?: string[];
  allowHighRisk?: boolean;
  /** Minimum delay between two jobs on the same site. */
  minGapMs?: number;
  /** Global cap on concurrent browser jobs. */
  maxGlobalConcurrency?: number;
}

export class PolicyError extends Error {}

/**
 * Governance layer. It does not make an unsafe automation legal, but it does
 * stop the orchestrator from silently hammering a provider: risk tiers,
 * per-site gaps, global concurrency and an audit trail of every decision.
 */
export class PolicyGuard {
  private readonly lastRunAt = new Map<string, number>();
  private active = 0;
  private readonly config: Required<PolicyConfig>;

  constructor(config: PolicyConfig = {}) {
    this.config = {
      blockedSiteIds: config.blockedSiteIds ?? [],
      allowHighRisk: config.allowHighRisk ?? false,
      minGapMs: config.minGapMs ?? 5_000,
      maxGlobalConcurrency: config.maxGlobalConcurrency ?? 3,
    };
  }

  assertAllowed(site: SiteEntry): void {
    if (this.config.blockedSiteIds.includes(site.id)) {
      throw new PolicyError(`${site.id} is blocked by policy`);
    }
    if (site.access === 'none') {
      throw new PolicyError(`${site.id} has no free automation path`);
    }
    if (site.free === null) {
      throw new PolicyError(`${site.id} has no free allowance`);
    }
    const risky = site.access === 'browser' && site.confidence === 'low';
    if (risky && !this.config.allowHighRisk) {
      throw new PolicyError(`${site.id} is high risk; enable allowHighRisk explicitly`);
    }
    const last = this.lastRunAt.get(site.id) ?? 0;
    const wait = last + this.config.minGapMs - Date.now();
    if (wait > 0) {
      throw new PolicyError(`${site.id} cooling down for ${Math.ceil(wait / 1000)}s`);
    }
  }

  begin(site: SiteEntry): () => void {
    if (this.active >= this.config.maxGlobalConcurrency) {
      throw new PolicyError('global concurrency limit reached');
    }
    this.active += 1;
    this.lastRunAt.set(site.id, Date.now());
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active = Math.max(0, this.active - 1);
      }
    };
  }

  get activeJobs(): number {
    return this.active;
  }
}

/** Token bucket used for query-level throttling of unofficial HTTP APIs. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
  }

  take(cost = 1): boolean {
    const current = this.now();
    const elapsed = (current - this.last) / 1000;
    this.last = current;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
