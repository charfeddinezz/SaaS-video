/** OpenAI-compatible client for WebChat2API (web-UI -> API bridge). */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ImageOptions {
  model?: string;
  n?: number;
  size?: string;
}

export interface ClientOptions {
  /** e.g. http://127.0.0.1:83 — WebChat2API is self-hosted next to the bot. */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class WebChat2ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

interface ImageResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
}

/**
 * WebChat2API exposes ChatGPT/Grok/Gemini web sessions through OpenAI-shaped
 * endpoints. That gives the scriptwriter and art-director agents a real LLM
 * without a paid key — the account pool lives inside WebChat2API, not here.
 */
export class WebChat2Api {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const payload = {
      model: options.model ?? 'auto',
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    };
    const data = await this.post<ChatCompletion>('/v1/chat/completions', payload);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new WebChat2ApiError('empty completion', 200, JSON.stringify(data));
    return content;
  }

  async image(prompt: string, options: ImageOptions = {}): Promise<string[]> {
    const payload = {
      model: options.model ?? 'gpt-image-2',
      prompt,
      n: options.n ?? 1,
      size: options.size ?? '1024x1024',
    };
    const data = await this.post<ImageResponse>('/v1/images/generations', payload);
    const urls = (data.data ?? [])
      .map((item) => item.url ?? (item.b64_json ? `data:image/png;base64,${item.b64_json}` : null))
      .filter((url): url is string => typeof url === 'string');
    if (urls.length === 0) throw new WebChat2ApiError('no image returned', 200, JSON.stringify(data));
    return urls;
  }

  /** Ask a web model to emit strict JSON and parse it; retries once on bad JSON. */
  async json<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
    const system: ChatMessage = {
      role: 'system',
      content: 'Reply with a single valid JSON object. No markdown, no prose.',
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.chat([system, ...messages], { temperature: 0.2, ...options });
      const parsed = extractJson(raw);
      if (parsed !== null) return parsed as T;
    }
    throw new WebChat2ApiError('model did not return JSON', 200, '');
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new WebChat2ApiError(`webchat2api ${response.status}`, response.status, text.slice(0, 500));
      }
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function extractJson(raw: string): unknown | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
