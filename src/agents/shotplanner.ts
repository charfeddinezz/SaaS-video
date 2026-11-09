/** Shot planner: breaks a generated script into a sequence of video shots.
 * Free-only: generates prompts for text2video/image2video sites.
 */
import type { GeneratedScript } from './scriptwriter.js';

export interface ShotSpec {
  id: string;
  prompt: string;
  durationSec: number;
  capability: 'text2video' | 'image2video';
  description: string;
}

export interface ShotPlan {
  scriptId: string;
  shots: ShotSpec[];
  totalDurationSec: number;
  estimatedCostPerShot: number;
}

export function planShotsFromScript(script: GeneratedScript): ShotPlan {
  const shots: ShotSpec[] = [];
  const lines = script.script
    .split(/[.!?]+/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 10);

  const primarySources: string[] = [];
  for (const item of script.outline) primarySources.push(item);
  for (const sentence of lines) primarySources.push(sentence);

  const seen = new Set<string>();
  const uniqueSources: string[] = [];
  for (const src of primarySources) {
    const key = src.toLowerCase().trim();
    if (!seen.has(key)) { seen.add(key); uniqueSources.push(src); }
  }

  let secAccum = 0;
  for (let i = 0; i < uniqueSources.length; i++) {
    const text = uniqueSources[i];
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    const wordCount = text.split(/\s+/).length;
    const dur = Math.max(3, Math.min(12, Math.round(2 * wordCount / 2)));
    secAccum += dur;
    shots.push({
      id: 'shot-' + script.id + '-' + i,
      prompt: text,
      durationSec: dur,
      capability: 'text2video',
      description: text,
    });
  }

  if (shots.length === 0 && script.outline.length > 0) {
    for (let i = 0; i < script.outline.length; i++) {
      const text = script.outline[i];
      if (typeof text !== 'string' || text.trim().length === 0) continue;
      shots.push({
        id: 'script-' + script.id + '-outline-' + i,
        prompt: text,
        durationSec: 8,
        capability: 'text2video',
        description: text,
      });
    }
  }

  const totalDurationSec = shots.reduce((sum: number, s: ShotSpec) => sum + s.durationSec, 0);
  return { scriptId: script.id, shots: shots, totalDurationSec: totalDurationSec, estimatedCostPerShot: 1 };
}

export function planShotsDiverse(
  script: GeneratedScript,
  diversityWeights: { camera: number; subject: number; style: number } = { camera: 0.33, subject: 0.33, style: 0.34 },
): ShotPlan {
  const base = planShotsFromScript(script);
  if (base.shots.length <= 1) return base;

  const applied: ShotSpec[] = [];
  for (const s of base.shots) { if (s && s.prompt) applied.push(s as ShotSpec); }

  for (let i = 1; i < applied.length; i++) {
    // $FlowFixMe
    // $FlowFixMe: indices may be undefined
    const prev: ShotSpec | undefined = applied[i - 1];
    // $FlowFixMe
    const curr: ShotSpec | undefined = applied[i];
    if (prev == null || curr == null || prev.prompt == null || curr.prompt == null) continue;
    // $FlowFixMe
    const prevFp: string = (String(prev.prompt).toLowerCase().split(/\s+/).slice(0, 6).join(' '));
    // $FlowFixMe
    const currFp: string = (String(curr.prompt).toLowerCase().split(/\s+/).slice(0, 6).join(' '));
    if (prevFp === currFp || (prevFp.substring(0, 5) === currFp.substring(0, 5) && Math.random() < 0.5)) {
      const modifiers = ['close-up shot of', 'wide angle of', ' aerial view of', 'macro of', 'point-of-view of'];
      const mod = modifiers[Math.floor(Math.random() * modifiers.length)];
      // $FlowFixMe
      // $FlowFixMe: applied[i] may still be TS-unaware
      applied[i].prompt = mod + ' ' + String(curr.prompt);
      // $FlowFixMe
      // $FlowFixMe: applied[i] may still be TS-unaware
      applied[i].durationSec = Math.min(12, (applied[i].durationSec ?? 6) + 2);
    }
  }

  return {
    scriptId: base.scriptId,
    shots: applied,
    totalDurationSec: applied.reduce((sum: number, s: ShotSpec) => sum + s.durationSec, 0),
    estimatedCostPerShot: base.estimatedCostPerShot,
  };
}