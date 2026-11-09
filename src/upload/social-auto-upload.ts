/** Publisher adapter for social-auto-upload (sau CLI, browser automation). */

export type Visibility = 'public' | 'unlisted' | 'private';

export interface YouTubeUploadRequest {
  account: string;
  file: string;
  title: string;
  description: string;
  tags?: string[];
  playlist?: string;
  visibility?: Visibility;
  thumbnail?: string;
  /** ISO-8601, interpreted by the uploader in its own timezone. */
  publishAt?: string;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[]): Promise<CommandResult>;
}

export class UploadValidationError extends Error {}

const YOUTUBE_TITLE_MAX = 100;
const YOUTUBE_DESCRIPTION_MAX = 5000;
const YOUTUBE_TAGS_TOTAL_MAX = 500;

export function buildYouTubeArgs(request: YouTubeUploadRequest): string[] {
  const title = request.title.trim();
  if (title.length === 0 || title.length > YOUTUBE_TITLE_MAX) {
    throw new UploadValidationError(`title must be 1..${YOUTUBE_TITLE_MAX} characters`);
  }
  if (request.description.length > YOUTUBE_DESCRIPTION_MAX) {
    throw new UploadValidationError(`description exceeds ${YOUTUBE_DESCRIPTION_MAX} characters`);
  }
  const tags = request.tags ?? [];
  const tagsLength = tags.join(',').length;
  if (tagsLength > YOUTUBE_TAGS_TOTAL_MAX) {
    throw new UploadValidationError(`tags exceed ${YOUTUBE_TAGS_TOTAL_MAX} characters`);
  }
  // Shorts are vertical and <= 3 minutes; the file itself is validated upstream.
  const args = [
    'youtube',
    'upload-video',
    '--account',
    request.account,
    '--file',
    request.file,
    '--title',
    title,
    '--desc',
    request.description,
    '--visibility',
    request.visibility ?? 'public',
  ];
  if (tags.length > 0) args.push('--tags', tags.join(','));
  if (request.playlist) args.push('--playlist', request.playlist);
  if (request.publishAt) args.push('--publish-at', request.publishAt);
  if (request.thumbnail) args.push('--thumbnail', request.thumbnail);
  return args;
}

export interface PublishOutcome {
  ok: boolean;
  videoId: string | null;
  url: string | null;
  raw: CommandResult;
  idempotencyKey: string;
}

/**
 * Thin wrapper around the `sau` CLI. The adapter is deliberately dumb: the
 * orchestrator owns idempotency and retry policy, this class owns argument
 * construction, validation and result parsing.
 */
export class SocialAutoUpload {
  constructor(
    private readonly runner: CommandRunner,
    private readonly binary = 'sau',
    private readonly dryRun = false,
  ) {}

  async uploadYouTube(request: YouTubeUploadRequest): Promise<PublishOutcome> {
    const args = buildYouTubeArgs(request);
    const idempotencyKey = `${request.account}:${request.file}:${request.title}`;
    if (this.dryRun) {
      return {
        ok: true,
        videoId: null,
        url: null,
        raw: { code: 0, stdout: `${this.binary} ${args.join(' ')}`, stderr: '' },
        idempotencyKey,
      };
    }
    const raw = await this.runner.run(this.binary, args);
    const videoId =
      raw.stdout.match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]{11})/)?.[1] ??
      raw.stdout.match(/"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/)?.[1] ??
      null;
    return {
      ok: raw.code === 0,
      videoId,
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
      raw,
      idempotencyKey,
    };
  }
}

/** Result of a login/health check (`sau youtube check --account <name>`). */
export async function checkYouTubeAccount(
  runner: CommandRunner,
  account: string,
  binary = 'sau',
): Promise<boolean> {
  const result = await runner.run(binary, ['youtube', 'check', '--account', account]);
  return result.code === 0;
}
