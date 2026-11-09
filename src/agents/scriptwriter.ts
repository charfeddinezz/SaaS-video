/** Script writer: generates a video script from a topic, using WebChat2API.
 * Free-only: relies on the account pool inside WebChat2API, not a paid LLM key.
 */
import { WebChat2Api, type ChatMessage } from '../providers/webchat2api.js';

/** Options for script generation. */
export interface ScriptWriterOptions {
  /** Max words in the final script. */
  maxWords?: number;
  /** Language code, e.g. 'ar' or 'en'. */
  language?: string;
  /** Tone/style hints passed to the LLM. */
  styleHints?: string[];
}

/** Result of script generation. */
export interface GeneratedScript {
  id: string;
  title: string;
  hook: string;       // first 10-15 seconds hook
  outline: string[];  // bullet points for each section
  script: string;     // full narration text
  durationEstSec: number;
  tags: string[];
}

/** Writes a script optimized for short-form video (30-60s typical).
 * The LLM is asked to output strict JSON via the json() method so we get
 * a parseable result without fragile string splitting.
 */
export async function writeScript(
  topic: string,
  spec: ScriptWriterOptions = {},
): Promise<GeneratedScript> {
  const api = new WebChat2Api({
    baseUrl: 'http://127.0.0.1:83',
    apiKey: 'sk-local-free', // WebChat2API accepts any string as it bridges a local UI
    timeoutMs: 30_000,
  });

  const language = spec.language ?? 'ar';
  const maxWords = spec.maxWords ?? 800;
  const styleHints = spec.styleHints ?? [];

  const systemMsg: ChatMessage = {
    role: 'system',
    content: `You are a short-form video script writer. Produce output as valid JSON with these fields:
{
  "title": "string",
  "hook": "string",        // first 5-8 seconds, very catchy
  "outline": ["string", "string", "..."], // 3-7 bullet points
  "script": "string",      // full narration, max ${maxWords} words total
  "durationEstSec": number,
  "tags": ["string", "..."] // 3-5 hashtags
}
Rules:
- Output ONLY the JSON object, no surrounding prose, no markdown fences.
- Use "${language}" language throughout.
- Make the hook extremely engaging - first 3 seconds matter most.
- Keep total duration under 60 seconds for YouTube Shorts, or up to 600 seconds for longer formats.
- Tags should be 3-5 relevant hashtags.
- ${styleHints.length > 0 ? 'Style preferences: ' + styleHints.join(', ') : ''}
- The narration should be concise, each sentence is one visual scene.`,

  };

  const userMsg: ChatMessage = {
    role: 'user',
    content: `Topic: "${topic}". Write a short-form video script following the system instructions above.`,
  };

  // api.json() accepts a ChatMessage[] array
  const raw = await api.json([systemMsg, userMsg]);
  // api.json returns T (parsed JSON). Cast to our normalized shape:
  const rawObj = raw as Record<string, unknown>;

  const script: GeneratedScript = {
    id: `script-${Date.now()}`,
    title: rawObj.title as string || `${topic} - tips and insights`,
    hook: rawObj.hook as string || '',
    outline: (rawObj.outline as unknown as string[]) || [],
    script: rawObj.script as string || '',
    durationEstSec: typeof rawObj.durationEstSec === 'number' ? rawObj.durationEstSec : 45,
    tags: Array.isArray(rawObj.tags as any[])
      ? (rawObj.tags as string[])
      : (rawObj.tags as string | undefined
          ? String(rawObj.tags).split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0)
          : []),
  };

  // Sanity: ensure we have at least a hook and outline
  if (!script.hook && script.outline.length > 0) {
    script.hook = script.outline[0] || '';
  }
  if (script.script.length < 20 && script.outline.length > 0) {
    // reconstruct from outline if script is too short
    script.script = script.outline.join('. ') + '.';
  }

  return script;
}

/** Convenience: write a script in Arabic with typical Shorts style. */
export async function writeArabicShortsScript(topic: string, maxWords: number = 800): Promise<GeneratedScript> {
  return writeScript(topic, {
    language: 'ar',
    maxWords,
    styleHints: ['hook in first 3 seconds', 'cinematic visuals', 'engaging storytelling', 'clear CTA at end'],
  });
}