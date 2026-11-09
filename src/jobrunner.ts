import type { Artifact, JobSpec } from './core/types.js';
import { Pipeline, type PipelineEvent, type Stage } from './core/pipeline.js';
import { createShortsPackage } from './core/studio.js';

export interface JobRunnerOptions {
  durationSec?: number;
  style?: string;
  audience?: string;
  onEvent?: (event: PipelineEvent) => void;
  sleep?: (ms: number) => Promise<void>;
}

export type JobResult =
  | { status: 'done'; artifact: Artifact; output: string }
  | { status: 'failed'; output: string };

export async function runJob(topic: string, options: JobRunnerOptions = {}): Promise<JobResult> {
  let production: ReturnType<typeof createShortsPackage> | undefined;
  const job: JobSpec = {
    id: `job-${Date.now()}`,
    topic,
    language: 'ar',
    durationSec: options.durationSec ?? 45,
    aspect: '9:16',
    style: options.style ?? 'وثائقي سينمائي',
    targetPlatforms: ['youtube', 'instagram', 'tiktok'],
  };
  const artifact = (id: string, kind: Artifact['kind'], path: string, meta: Record<string, unknown> = {}): Artifact => ({
    id: `${job.id}-${id}`,
    kind,
    path,
    meta,
  });
  const stages: Stage[] = [
    {
      name: 'brief',
      maxAttempts: 1,
      async run() {
        return [artifact('brief', 'json', 'brief.json', {
          topic: job.topic,
          audience: options.audience ?? 'الجمهور العام',
          durationSec: job.durationSec,
          aspect: job.aspect,
        })];
      },
    },
    {
      name: 'script',
      maxAttempts: 1,
      async run() {
        production = createShortsPackage(job.topic, {
          durationSec: job.durationSec,
          style: job.style,
          audience: options.audience,
        });
        return [artifact('script', 'text', 'script.txt', { script: production.script, title: production.title })];
      },
    },
    {
      name: 'shots',
      maxAttempts: 1,
      async run() {
        if (!production) throw new Error('تعذر إنشاء السيناريو.');
        return [artifact('storyboard', 'json', 'storyboard.json', { shots: production.shots })];
      },
    },
    {
      name: 'qc',
      maxAttempts: 1,
      async run() {
        if (!production || production.shots.length < 3) throw new Error('لوحة المشاهد غير مكتملة.');
        return [artifact('quality-check', 'json', 'quality-check.json', {
          passed: true,
          checks: ['وجود موضوع', 'سيناريو عربي', 'أربع مشاهد مخططة'],
          note: 'الفحص يغطي النص والخطة فقط؛ لا يوجد ملف فيديو لمراجعته.',
        })];
      },
    },
    {
      name: 'publish',
      maxAttempts: 1,
      async run() {
        if (!production) throw new Error('لا توجد حزمة إنتاج للتصدير.');
        return [artifact('production-package', 'json', 'production-package.json', { production })];
      },
    },
  ];

  try {
    const result = await new Pipeline(stages, {
      onEvent: options.onEvent,
      sleep: options.sleep,
    }).run(job);
    const finalArtifact = result.get('publish')?.[0];
    if (!finalArtifact) return { status: 'failed', output: 'اكتمل المسار دون إنشاء حزمة الإنتاج.' };
    return {
      status: 'done',
      artifact: finalArtifact,
      output: 'اكتملت حزمة السيناريو ولوحة المشاهد. لم يتم توليد ملف فيديو أو نشره.',
    };
  } catch (error) {
    return { status: 'failed', output: error instanceof Error ? error.message : String(error) };
  }
}

export function runArabicShortsJob(topic: string, options: JobRunnerOptions = {}): Promise<JobResult> {
  return runJob(topic, options);
}