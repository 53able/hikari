import type { IncomingMessage } from 'node:http';

/** レート制限チェックの結果。 */
export type RateLimitResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

/**
 * 単一キーに対するレート制限。
 * スライディングウィンドウ: 直近 `windowMs` 内のリクエスト数をカウントする。
 */
export type RateLimiter = {
  readonly check: (key: string) => RateLimitResult | Promise<RateLimitResult>;
};

/** `createSlidingWindowRateLimiter` のオプション。 */
export type SlidingWindowRateLimiterOptions = {
  /** ウィンドウ幅（ミリ秒）。 */
  readonly windowMs: number;
  /** ウィンドウ内の最大リクエスト数。 */
  readonly maxRequests: number;
};

/**
 * スライディングウィンドウ型レートリミッタを生成する。
 */
export const createSlidingWindowRateLimiter = (
  options: SlidingWindowRateLimiterOptions,
): RateLimiter => {
  const { windowMs, maxRequests } = options;
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const windowStart = now - windowMs;
      const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

      if (timestamps.length >= maxRequests) {
        const oldest = timestamps[0] ?? now;
        const retryAfterMs = Math.max(1, oldest + windowMs - now);
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        };
      }

      timestamps.push(now);
      hits.set(key, timestamps);
      return { allowed: true };
    },
  };
};

/** レート制限判定に使うコンテキスト。 */
export type RateLimitContext = {
  readonly ip?: string;
  readonly userId?: string;
  readonly capabilityName?: string;
};

/** 1 次元の制限ルール。 */
export type RateLimitRule = {
  readonly name: string;
  readonly key: (ctx: RateLimitContext) => string | undefined;
  readonly limiter: RateLimiter;
};

/** `createRateLimitGuard` のオプション。 */
export type RateLimitGuardOptions = {
  readonly rules: readonly RateLimitRule[];
};

/**
 * 複数ルールを順に評価するレート制限ガード。
 * 最初に超過したルールの `retryAfterSeconds` を返す。
 */
export type RateLimitGuard = {
  readonly check: (ctx: RateLimitContext) => RateLimitResult | Promise<RateLimitResult>;
};

export const createRateLimitGuard = (options: RateLimitGuardOptions): RateLimitGuard => ({
  check(ctx: RateLimitContext): RateLimitResult | Promise<RateLimitResult> {
    const run = async (): Promise<RateLimitResult> => {
      for (const rule of options.rules) {
        const keyPart = rule.key(ctx);
        if (!keyPart) continue;
        const key = `${rule.name}:${keyPart}`;
        const result = await Promise.resolve(rule.limiter.check(key));
        if (!result.allowed) {
          return result;
        }
      }
      return { allowed: true };
    };
    return run();
  },
});

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * 環境変数またはデフォルトから HTTP/チャット用レート制限ガードを構築する。
 *
 * - `HIKARI_RATE_LIMIT_IP_WINDOW_MS` / `HIKARI_RATE_LIMIT_IP_MAX` — クライアント IP（デフォルト 60s / 120）
 * - `HIKARI_RATE_LIMIT_USER_WINDOW_MS` / `HIKARI_RATE_LIMIT_USER_MAX` — userId（60s / 60）
 * - `HIKARI_RATE_LIMIT_CAPABILITY_WINDOW_MS` / `HIKARI_RATE_LIMIT_CAPABILITY_MAX` — ケイパビリティ名（60s / 30）
 */
export const createDefaultRateLimitGuard = (): RateLimitGuard => {
  const ipWindowMs = envInt('HIKARI_RATE_LIMIT_IP_WINDOW_MS', 60_000);
  const ipMax = envInt('HIKARI_RATE_LIMIT_IP_MAX', 120);
  const userWindowMs = envInt('HIKARI_RATE_LIMIT_USER_WINDOW_MS', 60_000);
  const userMax = envInt('HIKARI_RATE_LIMIT_USER_MAX', 60);
  const capWindowMs = envInt('HIKARI_RATE_LIMIT_CAPABILITY_WINDOW_MS', 60_000);
  const capMax = envInt('HIKARI_RATE_LIMIT_CAPABILITY_MAX', 30);

  return createRateLimitGuard({
    rules: [
      {
        name: 'ip',
        key: (ctx) => ctx.ip,
        limiter: createSlidingWindowRateLimiter({ windowMs: ipWindowMs, maxRequests: ipMax }),
      },
      {
        name: 'user',
        key: (ctx) => ctx.userId,
        limiter: createSlidingWindowRateLimiter({ windowMs: userWindowMs, maxRequests: userMax }),
      },
      {
        name: 'capability',
        key: (ctx) => ctx.capabilityName,
        limiter: createSlidingWindowRateLimiter({ windowMs: capWindowMs, maxRequests: capMax }),
      },
    ],
  });
};

/**
 * `IncomingMessage` からクライアント IP を推定する。
 * `X-Forwarded-For` の先頭を優先し、なければソケットアドレスを使う。
 */
export const clientIpFromRequest = (req: IncomingMessage): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
};
