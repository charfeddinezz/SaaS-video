import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadCatalog, summarize, sitesFor } from './catalog.js';
import { CreditLedger } from './ledger.js';
import { CapabilityRouter } from './router.js';
import { Pipeline, PipelineError, gates, type PipelineEvent } from './pipeline.js';
import { PolicyGuard, PolicyError } from './policy.js';
import { buildYouTubeArgs, SocialAutoUpload, UploadValidationError } from '../upload/social-auto-upload.js';
import type { Artifact, Catalog, JobSpec, SiteEntry } from './types.js';
import { createShortsPackage } from './studio.js';
import { runArabicShortsJob } from '../jobrunner.js';

const job: JobSpec = {
  id: 'job-1',
  topic: 'ثلاثة أخطاء تقتل فيديوهاتك القصيرة',
  language: 'ar',
  durationSec: 35,
  aspect: '9:16',
  style: 'cinematic',
  targetPlatforms: ['youtube'],
};

function site(id: string, caps: SiteEntry['caps'], overrides: Partial<SiteEntry> = {}): SiteEntry {
  return {
    id,
    name: id,
    url: 'https://example.com',
    category: 'video',
    caps,
    free: { amount: 60, unit: 'credits', period: 'day' },
    limits: 'test',
    auth: 'email',
    access: 'browser',
    repo: null,
    confidence: 'high',
    notes: 'test',
    ...overrides,
  };
}

function catalogOf(sites: SiteEntry[]): Catalog {
  return { generatedAt: '2026-11-08', sites };
}

test('catalog contains at least 50 unique sites across all media types', () => {
  const catalog = loadCatalog();
  assert.ok(catalog.sites.length >= 50, `only ${catalog.sites.length} sites`);
  assert.equal(new Set(catalog.sites.map((s) => s.id)).size, catalog.sites.length);
  for (const capability of ['text2video', 'text2image', 'tts', 'upload'] as const) {
    assert.ok(sitesFor(catalog, capability).length > 0, `no site for ${capability}`);
  }
  const stats = summarize(catalog);
  assert.ok((stats['video'] ?? 0) >= 20);
  assert.ok((stats['image'] ?? 0) >= 15);
});

test('ledger resets at UTC midnight and blocks overspend', () => {
  let now = new Date('2026-11-08T23:30:00Z');
  const ledger = new CreditLedger(() => now);
  const kling = site('kling', ['text2video'], { free: { amount: 2, unit: 'videos', period: 'day' } });

  assert.equal(ledger.remaining(kling), 2);
  assert.ok(ledger.tryConsume(kling));
  assert.ok(ledger.tryConsume(kling));
  assert.equal(ledger.tryConsume(kling), false);
  assert.equal(ledger.remaining(kling), 0);

  now = new Date('2026-11-09T00:10:00Z');
  assert.equal(ledger.remaining(kling), 2);
});

test('ledger refunds failed generations and supports unlimited allowances', () => {
  const ledger = new CreditLedger(() => new Date('2026-11-08T10:00:00Z'));
  const suno = site('suno', ['music'], { category: 'audio', free: { amount: 50, unit: 'credits', period: 'day' } });
  ledger.tryConsume(suno, 10);
  ledger.refund(suno, 10);
  assert.equal(ledger.remaining(suno), 50);

  const local = site('kokoro', ['tts'], { free: { amount: 1, unit: 'unlimited', period: 'day' } });
  assert.equal(ledger.remaining(local), Infinity);
  assert.ok(ledger.tryConsume(local, 9999));
});

test('router prefers the stronger provider, then falls back when its quota is gone', () => {
  const weak = site('weak', ['text2video'], { confidence: 'medium' });
  const strong = site('strong', ['text2video'], { confidence: 'high' });
  const catalog = catalogOf([weak, strong]);
  const router = new CapabilityRouter(catalog, undefined, () => 0);
  const ledger = new CreditLedger(() => new Date('2026-11-08T10:00:00Z'));

  const first = router.pick('text2video', ledger);
  assert.equal(first?.site.id, 'strong');

  ledger.tryConsume(strong, 60);
  const second = router.pick('text2video', ledger);
  assert.equal(second?.site.id, 'weak');
});

test('router opens a circuit after failures and recovers it', () => {
  const catalog = catalogOf([site('a', ['text2image']), site('b', ['text2image'])]);
  const router = new CapabilityRouter(catalog, undefined, () => 1_000);
  const ledger = new CreditLedger();
  router.noteResult('a', 'text2image', { ok: false });
  const picked = router.pick('text2image', ledger);
  assert.equal(picked?.site.id, 'b');
  router.noteResult('a', 'text2image', { ok: true });
  assert.equal(router.state('a', 'text2image').health.consecutiveFailures, 0);
});

test('pipeline retries a failing stage, then completes and checkpoints', async () => {
  const events: PipelineEvent[] = [];
  let attempts = 0;
  const pipeline = new Pipeline(
    [
      {
        name: 'script',
        maxAttempts: 3,
        async run() {
          attempts += 1;
          if (attempts < 2) throw new Error('flaky model');
          const artifact: Artifact = { id: 's1', kind: 'text', path: 'script.md', meta: {} };
          return [artifact];
        },
      },
      {
        name: 'clips',
        gates: [gates.hasVideo()],
        async run() {
          const artifact: Artifact = {
            id: 'v1',
            kind: 'video',
            path: 'clip.mp4',
            meta: { durationSec: 6 },
          };
          return [artifact];
        },
      },
    ],
    { onEvent: (event) => events.push(event), sleep: async () => undefined },
  );

  const result = await pipeline.run(job);
  assert.equal(attempts, 2);
  assert.ok(result.has('clips'));
  assert.equal(events.filter((event) => event.type === 'stage:failed').length, 1);
  assert.ok(events.some((event) => event.type === 'job:done'));
});

test('pipeline fails the job when a quality gate rejects every attempt', async () => {
  let runs = 0;
  const pipeline = new Pipeline(
    [
      {
        name: 'clips',
        maxAttempts: 2,
        gates: [gates.hasVideo()],
        async run() {
          runs += 1;
          return [{ id: `bad-${runs}`, kind: 'image', path: 'still.png', meta: {} }];
        },
      },
    ],
    { sleep: async () => undefined },
  );
  await assert.rejects(() => pipeline.run(job), (error: unknown) => {
    assert.ok(error instanceof PipelineError);
    assert.equal(error.stage, 'clips');
    return true;
  });
  assert.equal(runs, 2);
});

test('policy blocks high-risk automation unless explicitly enabled', () => {
  const risky = site('risky', ['text2video'], { confidence: 'low' });
  assert.throws(() => new PolicyGuard().assertAllowed(risky), PolicyError);
  assert.doesNotThrow(() => new PolicyGuard({ allowHighRisk: true }).assertAllowed(risky));
  assert.throws(
    () => new PolicyGuard().assertAllowed(site('paid', ['text2video'], { free: null })),
    PolicyError,
  );
});

test('YouTube arguments are validated and ordered for sau', () => {
  const args = buildYouTubeArgs({
    account: 'main',
    file: 'videos/out.mp4',
    title: 'اختبار',
    description: 'وصف',
    tags: ['shorts', 'ai'],
    visibility: 'public',
  });
  assert.deepEqual(args.slice(0, 4), ['youtube', 'upload-video', '--account', 'main']);
  assert.equal(args[args.indexOf('--tags') + 1], 'shorts,ai');
  assert.throws(() => buildYouTubeArgs({ account: 'a', file: 'f', title: '', description: '' }), UploadValidationError);
  assert.throws(
    () => buildYouTubeArgs({ account: 'a', file: 'f', title: 'x'.repeat(101), description: '' }),
    UploadValidationError,
  );
});

test('uploader parses the returned video id and reports failure codes', async () => {
  const uploader = new SocialAutoUpload({
    async run() {
      return { code: 0, stdout: 'uploaded: https://youtu.be/dQw4w9WgXcQ', stderr: '' };
    },
  });
  const outcome = await uploader.uploadYouTube({ account: 'a', file: 'f.mp4', title: 't', description: 'd' });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.videoId, 'dQw4w9WgXcQ');

  const failing = new SocialAutoUpload({
    async run() {
      return { code: 1, stdout: '', stderr: 'login required' };
    },
  });
  const failed = await failing.uploadYouTube({ account: 'a', file: 'f.mp4', title: 't', description: 'd' });
  assert.equal(failed.ok, false);
  assert.equal(failed.videoId, null);
});

test('studio creates a timed Arabic script and storyboard package', () => {
  const production = createShortsPackage('كيف نبني عادة القراءة؟', { durationSec: 30 });
  assert.equal(production.deliverable, 'script-and-storyboard');
  assert.equal(production.shots.length, 4);
  assert.equal(production.shots.reduce((sum, shot) => sum + shot.durationSec, 0), 30);
  assert.ok(production.script.includes(production.topic));
  assert.throws(() => createShortsPackage('  '), /ثلاثة أحرف/);
});

test('job runner exports a production package without claiming to render video', async () => {
  const events: PipelineEvent[] = [];
  const result = await runArabicShortsJob('التعلم بالممارسة', {
    onEvent: (event) => events.push(event),
    sleep: async () => undefined,
  });

  assert.equal(result.status, 'done');
  if (result.status !== 'done') return;
  assert.equal(result.artifact.kind, 'json');
  assert.equal(result.artifact.path, 'production-package.json');
  assert.match(result.output, /لم يتم توليد ملف فيديو/);
  assert.ok(events.some((event) => event.type === 'job:done'));
});
