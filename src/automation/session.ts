import type { SiteEntry } from '../core/types.js';

export interface BrowserSessionSpec {
  siteId: string;
  /** Persistent profile directory: cookies and localStorage survive restarts. */
  profileDir: string;
  headless: boolean;
  locale: string;
  timezoneId: string;
  /** Sticky proxy per account, e.g. http://user:pass@host:port */
  proxyUrl?: string;
}

export interface SessionHandle {
  id: string;
  siteId: string;
  /** Driver-specific page object (Playwright Page, CDP target, ...). */
  page: unknown;
  close(): Promise<void>;
}

export interface SessionDriver {
  open(spec: BrowserSessionSpec): Promise<SessionHandle>;
  probe(handle: SessionHandle): Promise<boolean>;
}

export type ChallengeKind = 'captcha' | 'two-factor' | 'phone' | 'consent' | 'login';

export interface HumanChallenge {
  siteId: string;
  kind: ChallengeKind;
  url: string;
  message: string;
}

export interface HumanBroker {
  /** Ask a human to solve something the robot must not solve. */
  request(challenge: HumanChallenge): Promise<'solved' | 'skipped' | 'timeout'>;
}

export interface BrowserLayerOptions {
  concurrency?: number;
  onEvent?: (event: { type: string; siteId: string; detail?: string }) => void;
}

/**
 * The "reality layer": every free web UI is driven through one long-lived
 * browser profile. Sessions are serialized per site, health-probed before use,
 * and hand control to a human when a challenge appears. The orchestrator never
 * stores plaintext passwords; it stores profile directories and cookies.
 */
export class BrowserRealityLayer {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly concurrency: number;

  constructor(
    private readonly driver: SessionDriver,
    private readonly broker: HumanBroker,
    private readonly options: BrowserLayerOptions = {},
  ) {
    this.concurrency = options.concurrency ?? 2;
  }

  async withSession<T>(spec: BrowserSessionSpec, fn: (handle: SessionHandle) => Promise<T>): Promise<T> {
    const previous = this.locks.get(spec.siteId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      this.options.onEvent?.({ type: 'session:open', siteId: spec.siteId });
      const handle = await this.driver.open(spec);
      try {
        const healthy = await this.driver.probe(handle);
        if (!healthy) {
          const outcome = await this.broker.request({
            siteId: spec.siteId,
            kind: 'login',
            url: `https://${spec.siteId}`,
            message: 'الجلسة منتهية أو مرفوضة. سجّل الدخول ثم تابع.',
          });
          if (outcome !== 'solved') throw new Error(`session blocked for ${spec.siteId}: ${outcome}`);
        }
        return await fn(handle);
      } finally {
        await handle.close();
        this.options.onEvent?.({ type: 'session:close', siteId: spec.siteId });
      }
    });
    this.locks.set(spec.siteId, run.catch(() => undefined));
    return run;
  }

  get maxConcurrency(): number {
    return this.concurrency;
  }
}

/** In-memory broker used by tests and by the dashboard's "needs me" queue. */
export class QueueBroker implements HumanBroker {
  private readonly pending: HumanChallenge[] = [];

  async request(challenge: HumanChallenge): Promise<'solved' | 'skipped' | 'timeout'> {
    this.pending.push(challenge);
    return 'timeout';
  }

  drain(): HumanChallenge[] {
    return this.pending.splice(0, this.pending.length);
  }
}

/** Site adapter contract implemented once per provider. */
export interface SiteAdapter<Input, Output> {
  siteId: string;
  capability: SiteEntry['caps'][number];
  /** Pre-flight: is the profile logged in and is the UI still shaped as expected? */
  healthCheck(): Promise<boolean>;
  run(input: Input): Promise<Output>;
  /** Download generated media into the asset spine. */
  collect(output: Output, destination: string): Promise<string[]>;
}

export function profileFor(site: SiteEntry, root = '.profiles'): BrowserSessionSpec {
  return {
    siteId: site.id,
    profileDir: `${root}/${site.id}`,
    headless: true,
    locale: 'en-US',
    timezoneId: 'UTC',
  };
}
