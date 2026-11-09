/** Example: run a complete video generation job from a topic.
 * Usage: npx tsx scripts/run-job.ts "your topic here"
 *
 * This demonstrates the end-to-end pipeline using only free-tier resources.
 */

import { runArabicShortsJob } from '../src/jobrunner.js';

// The topic can be anything - the script writer will generate a Shorts-optimized
// video script from it.
const topic = process.argv[2] || 'أخطاء يجب تجنبها فيفيدوهاتك القصيرة';

console.log(`🚀 Starting ReelForge job: "${topic}"`);
console.log('This will use only free-tier AI sites and credits.\n');

// Run the full pipeline
const result = await runArabicShortsJob(topic, {
  onEvent: (event) => {
    // Log pipeline events for the user
    const timestamps = new Date().toLocaleTimeString();
    console.log(`[${timestamps}] ${event.type}${event.detail ? `: ${event.detail}` : ''}`);
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

// Print the result
console.log('\n📊 Job result:');
switch (result.status) {
  case 'done':
    console.log('   ✅ Pipeline completed successfully!');
    if (result.artifact) {
      const meta = (result.artifact as any)?.meta ?? {};
      console.log(`   📺 Video: ${meta.path ?? 'out/final.mp4'}`);
      console.log(`   ⏱️ Duration: ${meta.totalDurationSec ?? '?'}s`);
      console.log(`   🎬 Clips: ${meta.clipCount ?? '?'}`);
      if (meta.youtubeArgs) {
        console.log('   ▶️ YouTube args ready (private mode)');
        console.log(`      Command: sau youtube upload-video ${meta.youtubeArgs.slice(4).join(' ')}`);
      }
    }
    break;

  case 'qc_failed':
    console.log('   ⚠️ Pipeline completed but QC failed.');
    if (result.artifact) {
      const meta = (result.artifact as any)?.meta ?? {};
      console.log('   📝 Feedback:', meta.checks ? JSON.stringify(meta.checks, null, 2) : meta.message);
    }
    break;

  case 'policy_blocked':
    console.log('   🚫 Pipeline blocked by policy guard.');
    console.log(`      Detail: ${result.output}`);
    break;

  case 'failed':
  case 'partial':
    console.log(`   ❌ Pipeline failed: ${result.output ?? 'unknown error'}`);
    break;

  case 'qc_failed':
    console.log('   ⚠️ QC failures detected; see artifact for details.');
    break;

  default:
    console.log(`   ? Unknown status: ${result.status}`);
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('Job finished. Review the output above.');
console.log('='.repeat(50));