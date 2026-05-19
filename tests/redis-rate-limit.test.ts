import { describe, it, expect } from 'vitest';
import {
  createRedisSlidingWindowRateLimiter,
  createRedisRateLimitGuard,
} from '../src/storage/redis/redis-rate-limit.js';
import { createFakeRedis } from './helpers/redis-fake.js';

describe('createRedisSlidingWindowRateLimiter', () => {
  it('blocks after maxRequests in window', async () => {
    const redis = createFakeRedis();
    const limiter = createRedisSlidingWindowRateLimiter(redis, {
      windowMs: 60_000,
      maxRequests: 2,
    });

    expect((await limiter.check('k1')).allowed).toBe(true);
    expect((await limiter.check('k1')).allowed).toBe(true);
    const third = await limiter.check('k1');
    expect(third.allowed).toBe(false);
    if (!third.allowed) {
      expect(third.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});

describe('createRedisRateLimitGuard', () => {
  it('evaluates rules in order', async () => {
    const redis = createFakeRedis();
    const guard = createRedisRateLimitGuard({
      rules: [
        {
          name: 'ip',
          key: () => '1.2.3.4',
          limiter: createRedisSlidingWindowRateLimiter(redis, {
            windowMs: 60_000,
            maxRequests: 1,
          }),
        },
      ],
    });

    expect((await guard.check({ ip: '1.2.3.4' })).allowed).toBe(true);
    expect((await guard.check({ ip: '1.2.3.4' })).allowed).toBe(false);
  });
});
