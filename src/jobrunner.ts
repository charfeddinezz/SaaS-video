// $FlowFixMe
import assert from 'node:assert/strict';
import type { Artifact, Catalog, JobSpec } from './core/types.js';
import { CreditLedger } from './core/ledger.js';
import { CapabilityRouter } from './core/router.js';
import { PolicyGuard } from './core/policy.js';
import { Pipeline, type PipelineEvent } from './core/pipeline.js';
import { loadCatalog } from './core/catalog.js';
import { briefStage, scriptStage, shotsStage, imagesStage, clipsStage, voiceStage, musicStage, editStage, qcStage, publishStage } from './pipeline/stages.js';

// $FlowFixMe
export interface JobRunnerOptions {
  maxDailyBudget?: number;
  catalog?: Catalog;
  ledger?: CreditLedger;
  router?: CapabilityRouter;
  policyGuard?: PolicyGuard;
  onEvent?: (event: any) => void;
  sleep?: (ms: number) => Promise<void>;
}

// $FlowFixMe
export type JobResult =
  | { status: string; artifact: Artifact; output?: string }
  | { status: string; output: string };

export async function runJob(topic: string, options: JobRunnerOptions = {}): Promise<JobResult> {
  // $FlowFixMe
  const { maxDailyBudget = 0, catalog: catalogOverride, ledger: ledgerOverride, router: routerOverride, policyGuard: policyGuardOverride, onEvent, sleep: sleepOverride } = options;
  // $FlowFixMe
  const catalogObj = catalogOverride ?? await loadCatalog();
  // $FlowFixMe
  const ledger = ledgerOverride ?? new CreditLedger(() => new Date());
  // $FlowFixMe
  const router = routerOverride ?? new CapabilityRouter(catalogObj);
  // $FlowFixMe
  const policyGuard = policyGuardOverride ?? new PolicyGuard();
  // $FlowFixMe
  const sleep = sleepOverride ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  // $FlowFixMe
  const job: JobSpec = {
    id: 'job-' + Date.now(),
    topic: topic,
    language: 'ar',
    durationSec: 60,
    aspect: '9:16',
    style: 'cinematic',
    targetPlatforms: ['youtube'],
    budgetCredits: maxDailyBudget,
  };

  // $FlowFixMe: gates type compatibility; stages Stage interface uses simpler gate structure than Pipeline.QualityGate
  // $FlowFixMe: stages Stage interface
  // $FlowFixMe: Pipeline constructor
  const pipeline = new Pipeline(
    [briefStage, scriptStage, shotsStage, imagesStage, clipsStage, voiceStage, musicStage, editStage, qcStage, publishStage],
    { onEvent: (event: any) => onEvent?.(event), sleep: sleep, router, ledger },
  );

  // $FlowFixMe
  try {
    // $FlowFixMe
    const candidates: any[] = router.rank('text2video', ledger);
    if (candidates.length === 0) {
      // $FlowFixMe
      return { status: 'failed', output: 'no available providers with remaining credits' } as JobResult;
    }
    // $FlowFixMe
    const first: any = candidates[0];
    // $FlowFixMe
    const site: any = catalogObj.sites.find(function(s: any) { return s.id === first.site.id; });
    if (!site) { return { status: 'failed', output: 'selected site not found in catalog' } as JobResult; }
    // $FlowFixMe
    policyGuard.assertAllowed(site);
    // $FlowFixMe
    const release = policyGuard.begin(site);
    try {
      // $FlowFixMe
      let resultMap: Map<string, any>;
      try {
        // $FlowFixMe
        resultMap = await pipeline.run(job);
      } catch (err: any) {
        // $FlowFixMe
        // $FlowFixMe: PipelineEvent doesn't have 'job:failed', cast to any
        onEvent?.({ type: 'job:failed' as any, error: err.message });
        // $FlowFixMe
        return { status: 'failed', output: err.message } as JobResult;
      }

      // $FlowFixMe
      const qcArtifacts: any[] = resultMap.get('qc') || [];
      if (qcArtifacts && qcArtifacts.length > 0) {
        // $FlowFixMe
        const qcMeta: any = (qcArtifacts[0] as any).meta ?? {};
        if (qcMeta.checks) {
          // $FlowFixMe
          const allPassed: boolean = (qcMeta.checks as any[]).every(function(c: any) { return c.pass; });
          if (!allPassed) {
            // $FlowFixMe
            const feedbackArtifact: Artifact = qcArtifacts.find(function(a: any) { return a.kind === 'text'; });
            return { status: 'qc_failed', artifact: feedbackArtifact ?? qcArtifacts[0], output: 'quality control failures; see artifact for details' } as JobResult;
          }
        }
      }

      // $FlowFixMe
      const publishArtifacts: any[] = resultMap.get('publish') || [];
      if (publishArtifacts && publishArtifacts.length > 0) {
        // $FlowFixMe
        const publishMeta: any = (publishArtifacts[0] as any).meta ?? {};
        return {
          status: 'done' as const,
          artifact: publishArtifacts[0],
          output: 'YouTube upload ready (private). Title: ' + (publishMeta.videoTitle ?? 'unknown') + '. Use sau CLI to publish.',
        } as JobResult;
      }

      // $FlowFixMe
      let lastArtifact: any;
      // $FlowFixMe
      for (var _i = 0; _i < ['publish', 'qc', 'edit', 'voice', 'music', 'clips', 'images', 'shots', 'script', 'brief'].length; _i++) {
        // $FlowFixMe
        const stageName: string = ['publish', 'qc', 'edit', 'voice', 'music', 'clips', 'images', 'shots', 'script', 'brief'][_i];
        // $FlowFixMe
        const arts = resultMap.get(stageName);
        if (arts && arts.length > 0) { lastArtifact = arts[arts.length - 1]; }
      }
      // $FlowFixMe
      // $FlowFixMe: lastArtifact may be TS-unaware
      // $FlowFixMe: lastArtifact narrowed by runtime check above
      const statusStr: string = lastArtifact != null ? 'done' : 'partial' as string;
      return {
        status: statusStr,
        artifact: lastArtifact,
        output: 'pipeline completed but no publish artifact generated',
      } as JobResult;
    } finally {
      // $FlowFixMe
      release();
    }
  } catch (policyError: any) {
    // $FlowFixMe: PipelineEvent doesn't have 'policy:blocked', cast to any
    onEvent?.({ type: 'policy:blocked' as any, detail: policyError.message });
    return { status: 'policy_blocked', output: policyError.message } as JobResult;
  }
}

// $FlowFixMe
export async function runArabicShortsJob(topic: string, options: any = {}): Promise<JobResult> {
  // $FlowFixMe
  return runJob(topic, { catalog: options.catalog, ledger: options.ledger, router: options.router, policyGuard: options.policyGuard });
}