import type { Artifact, JobSpec } from './types.js';

export type StageName =
  | 'brief'
  | 'script'
  | 'shots'
  | 'images'
  | 'clips'
  | 'voice'
  | 'music'
  | 'edit'
  | 'qc'
  | 'publish';

export interface StageContext {
  job: JobSpec;
  attempt: number;
  artifacts: ReadonlyMap<StageName, Artifact[]>;
  signal?: AbortSignal;
}

export interface QualityGate {
  /** Throwing or returning ok:false blocks the stage. */
  check(artifacts: Artifact[]): Promise<{ ok: boolean; score?: number; reason?: string }>;
}

export interface Stage {
  name: StageName;
  maxAttempts?: number;
  timeoutMs?: number;
  gates?: QualityGate[];
  run(ctx: StageContext, extra?: { site?: any }): Promise<Artifact[]>;
}

export type PipelineEvent =
  | { type: 'stage:start'; stage: StageName; attempt: number }
  | { type: 'stage:done'; stage: StageName; artifacts: number }
  | { type: 'stage:failed'; stage: StageName; attempt: number; error: string }
  | { type: 'stage:skipped'; stage: StageName }
  | { type: 'gate:failed'; stage: StageName; gate: string; reason: string }
  | { type: 'job:done'; artifacts: number };

export interface PipelineOptions {
  onEvent?: (event: PipelineEvent) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Checkpointed stages, so a resumed job does not re-spend credits. */
  checkpoint?: ReadonlyMap<StageName, Artifact[]>;
  /** Router and ledger for stages that need to select sites / track credits. */
  router?: import('./router.js').CapabilityRouter;
  ledger?: import('./ledger.js').CreditLedger;
}

export interface PipelineArtifacts {
  [stage: StageName]: Artifact[];
}

export class PipelineError extends Error {
  constructor(
    readonly stage: StageName,
    message: string,
  ) {
    super(`stage ${stage}: ${message}`);
  }
}

/**
 * Deterministic DAG runner for the video pipeline.
 *
 * Each stage is idempotent by contract and checkpointed, retries use
 * exponential backoff with jitter, and every stage may declare quality gates
 * (thresholds on CLIP score, audio loudness, aspect ratio, ...).
 */
export class Pipeline {
  constructor(
    private readonly stages: Stage[],
    private readonly options: PipelineOptions = {},
  ) {}

  private async emit(event: PipelineEvent): Promise<void> {
    this.options.onEvent?.(event);
  }

  async run(job: JobSpec): Promise<Map<StageName, Artifact[]>> {
    const done = new Map<StageName, Artifact[]>(this.options.checkpoint ?? []);
    const sleep = this.options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const router = this.options.router;
    const ledger = this.options.ledger;

    for (const stage of this.stages) {
      if (done.has(stage.name)) {
        await this.emit({ type: 'stage:skipped', stage: stage.name });
        continue;
      }
      const maxAttempts = Math.max(1, stage.maxAttempts ?? 3);
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await this.emit({ type: 'stage:start', stage: stage.name, attempt });
        try {
          const extra: Record<string, any> = {};
          if (router && stage.name === 'clips') {
            const picked = router.pick('text2video', ledger);
            extra.site = picked?.site;
            console.log('PIPELINE: clips extra.site =', extra.site?.id || 'undefined');
          }
          console.log('PIPELINE: about to call stage.run with extra =', extra);
          const artifacts = await this.withTimeout(
            stage.run({ job, attempt, artifacts: done, signal: undefined, ...extra }),
            stage.timeoutMs ?? 15 * 60_000,
          );
          for (const gate of stage.gates ?? []) {
            const result = await gate.check(artifacts);
            if (!result.ok) {
              await this.emit({
                type: 'gate:failed',
                stage: stage.name,
                gate: gate.name,
                reason: result.reason ?? 'gate rejected output',
              });
              throw new PipelineError(stage.name, `gate ${gate.name}: ${result.reason ?? 'rejected'}`);
            }
          }
          done.set(stage.name, artifacts);
          lastError = null;
          await this.emit({ type: 'stage:done', stage: stage.name, artifacts: artifacts.length });
          break;
        } catch (error) {
          lastError = error;
          await this.emit({
            type: 'stage:failed',
            stage: stage.name,
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
          if (attempt < maxAttempts) {
            const base = 500 * 2 ** (attempt - 1);
            await sleep(base + Math.floor(Math.random() * 250));
          }
        }
      }
      if (lastError !== null) {
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
      }
    }

    await this.emit({ type: 'job:done', artifacts: [...done.values()].flat().length });
    return done;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Built-in gates used by the media stages. */
export const gates = {
  hasVideo: (): QualityGate => ({
    name: 'has-video',
    async check(artifacts) {
      const video = artifacts.find((artifact) => artifact.kind === 'video');
      return video
        ? { ok: true, score: 1 }
        : { ok: false, reason: 'no video artifact produced' };
    },
  }),

  minDuration: (minSec: number): QualityGate => ({
    name: `duration>=${minSec}s`,
    async check(artifacts) {
      const video = artifacts.find((artifact) => artifact.kind === 'video');
      const duration = Number(video?.meta['durationSec'] ?? 0);
      return duration >= minSec
        ? { ok: true, score: 1 }
        : { ok: false, reason: `duration ${duration}s < ${minSec}s` };
    },
  }),

  loudness: (minLufs = -20): QualityGate => ({
    name: `loudness>=${minLufs}`,
    async check(artifacts) {
      const audio = artifacts.find((artifact) => artifact.kind === 'audio');
      const lufs = Number(audio?.meta['lufs'] ?? Number.NEGATIVE_INFINITY);
      return lufs >= minLufs ? { ok: true, score: 1 } : { ok: false, reason: `loudness ${lufs} LUFS` };
    },
  }),
};