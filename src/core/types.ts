/** Shared domain types for the ReelForge control plane. */

export type Capability =
  | 'llm'
  | 'text2video'
  | 'image2video'
  | 'reference2video'
  | 'video2video'
  | 'text2image'
  | 'image2image'
  | 'tts'
  | 'dubbing'
  | 'music'
  | 'sfx'
  | 'lipsync'
  | 'avatar'
  | 'edit'
  | 'caption'
  | 'stem-separation'
  | 'vector'
  | 'storyboard'
  | 'upload';

export type Category = 'video' | 'image' | 'audio' | 'edit' | 'publish' | 'llm';
export type Period = 'day' | 'week' | 'month' | 'once';
export type Unit =
  | 'credits'
  | 'images'
  | 'videos'
  | 'minutes'
  | 'characters'
  | 'tokens'
  | 'buzz'
  | 'units'
  | 'uses'
  | 'unlimited';

export interface FreeAllowance {
  amount: number;
  unit: Unit;
  period: Period;
}

export interface SiteEntry {
  id: string;
  name: string;
  url: string;
  category: Category;
  caps: Capability[];
  free: FreeAllowance | null;
  limits: string;
  auth: string;
  access: 'browser' | 'api' | 'both' | 'none';
  repo: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

export interface Catalog {
  generatedAt: string;
  disclaimer?: string;
  sites: SiteEntry[];
}

export type Risk = 'low' | 'medium' | 'high';

export interface Health {
  /** Exponentially weighted success rate, 0..1. */
  successEwma: number;
  /** Exponentially weighted latency in milliseconds. */
  latencyMs: number;
  consecutiveFailures: number;
  cooldownUntil: number | null;
}

export interface ProviderState {
  siteId: string;
  capability: Capability;
  /** Expected output quality for this capability, 0..1. */
  quality: number;
  /** How exposed the automation path is to terms-of-service / ban risk. */
  risk: Risk;
  /** Maximum parallel jobs this provider tolerates. */
  concurrency: number;
  enabled: boolean;
  health: Health;
}

export interface Candidate {
  site: SiteEntry;
  state: ProviderState;
  score: number;
  remainingRatio: number;
}

export interface Artifact {
  id: string;
  kind: 'text' | 'image' | 'video' | 'audio' | 'json';
  path: string;
  meta: Record<string, unknown>;
}

export interface JobSpec {
  id: string;
  topic: string;
  language: string;
  durationSec: number;
  aspect: '9:16' | '1:1' | '16:9';
  style: string;
  targetPlatforms: string[];
  budgetCredits?: number;
}

export type JobStatus = 'queued' | 'running' | 'blocked' | 'failed' | 'done';

export const SITE_CAPABILITIES: readonly Capability[] = [
  'llm',
  'text2video',
  'image2video',
  'reference2video',
  'video2video',
  'text2image',
  'image2image',
  'tts',
  'dubbing',
  'music',
  'sfx',
  'lipsync',
  'avatar',
  'edit',
  'caption',
  'stem-separation',
  'vector',
  'storyboard',
  'upload',
];
