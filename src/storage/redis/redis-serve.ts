import type { HikariRedis } from './redis-client.js';
import { createDefaultRateLimitGuard, type RateLimitGuard } from '../../core/rate-limit.js';
import { createRedisSlidingWindowRateLimiter, createRedisRateLimitGuard } from './redis-rate-limit.js';

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * 環境変数と同一デフォルトで Redis 版レート制限ガードを構築する。
 */
export const createDefaultRedisRateLimitGuard = (redis: HikariRedis): RateLimitGuard => {
  const ipWindowMs = envInt('HIKARI_RATE_LIMIT_IP_WINDOW_MS', 60_000);
  const ipMax = envInt('HIKARI_RATE_LIMIT_IP_MAX', 120);
  const userWindowMs = envInt('HIKARI_RATE_LIMIT_USER_WINDOW_MS', 60_000);
  const userMax = envInt('HIKARI_RATE_LIMIT_USER_MAX', 60);
  const capWindowMs = envInt('HIKARI_RATE_LIMIT_CAPABILITY_WINDOW_MS', 60_000);
  const capMax = envInt('HIKARI_RATE_LIMIT_CAPABILITY_MAX', 30);

  return createRedisRateLimitGuard({
    rules: [
      {
        name: 'ip',
        key: (ctx) => ctx.ip,
        limiter: createRedisSlidingWindowRateLimiter(redis, { windowMs: ipWindowMs, maxRequests: ipMax }),
      },
      {
        name: 'user',
        key: (ctx) => ctx.userId,
        limiter: createRedisSlidingWindowRateLimiter(redis, { windowMs: userWindowMs, maxRequests: userMax }),
      },
      {
        name: 'capability',
        key: (ctx) => ctx.capabilityName,
        limiter: createRedisSlidingWindowRateLimiter(redis, { windowMs: capWindowMs, maxRequests: capMax }),
      },
    ],
  });
};

/** ローカル / Redis のどちらかでデフォルトガードを返す。 */
export const createServeRateLimitGuard = (
  redis: HikariRedis | undefined,
  useRedis: boolean,
): RateLimitGuard =>
  useRedis && redis ? createDefaultRedisRateLimitGuard(redis) : createDefaultRateLimitGuard();
