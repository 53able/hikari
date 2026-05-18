import type { HikariRedis } from './redis-client.js';
import type {
  RateLimitContext,
  RateLimitGuard,
  RateLimitResult,
  RateLimitRule,
  RateLimiter,
  SlidingWindowRateLimiterOptions,
} from '../../core/rate-limit.js';

/** `createRedisSlidingWindowRateLimiter` のオプション。 */
export type RedisSlidingWindowRateLimiterOptions = SlidingWindowRateLimiterOptions & {
  readonly keyPrefix?: string;
};

const windowKey = (prefix: string, key: string): string => `${prefix}rl:${key}`;

/**
 * Redis ソート済み集合による分散スライディングウィンドウレートリミッタ。
 */
export const createRedisSlidingWindowRateLimiter = (
  redis: HikariRedis,
  options: RedisSlidingWindowRateLimiterOptions,
): RateLimiter => {
  const { windowMs, maxRequests, keyPrefix = 'hikari:' } = options;

  return {
    async check(key: string): Promise<RateLimitResult> {
      const now = Date.now();
      const windowStart = now - windowMs;
      const redisKey = windowKey(keyPrefix, key);
      const member = `${now}:${Math.random().toString(36).slice(2)}`;

      await redis.zRemRangeByScore(redisKey, 0, windowStart);
      const count = await redis.zCard(redisKey);

      if (count >= maxRequests) {
        const oldest = await redis.zRangeByScore(redisKey, windowStart, now);
        const oldestTs = oldest[0] ? Number.parseInt(oldest[0].split(':')[0] ?? '', 10) : now;
        const retryAfterMs = Math.max(1, oldestTs + windowMs - now);
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        };
      }

      await redis.zAdd(redisKey, [{ score: now, value: member }]);
      return { allowed: true };
    },
  };
};

/** `createRedisRateLimitGuard` のオプション。 */
export type RedisRateLimitGuardOptions = {
  readonly rules: readonly RateLimitRule[];
};

/**
 * 複数ルールを順に評価する Redis 版レート制限ガード（非同期 `check`）。
 */
export const createRedisRateLimitGuard = (
  options: RedisRateLimitGuardOptions,
): RateLimitGuard => ({
  async check(ctx: RateLimitContext): Promise<RateLimitResult> {
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
  },
});
