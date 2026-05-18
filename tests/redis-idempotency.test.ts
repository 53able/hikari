import { describe, it, expect } from 'vitest';
import { createRedisIdempotencyStore } from '../src/storage/redis/redis-idempotency.js';
import { createFakeRedis } from './helpers/redis-fake.js';

describe('createRedisIdempotencyStore', () => {
  it('stores and retrieves idempotency records', async () => {
    const redis = createFakeRedis();
    const store = createRedisIdempotencyStore(redis, { ttlMs: 60_000 });

    await store.set('key-1', {
      capabilityName: 'echo',
      inputHash: 'abc',
      result: { success: true, output: { ok: true }, traceId: 't1' },
      createdAt: Date.now(),
    });

    const record = await store.get('key-1');
    expect(record?.capabilityName).toBe('echo');
    expect(record?.result.output).toEqual({ ok: true });
  });

  it('returns undefined for missing keys', async () => {
    const redis = createFakeRedis();
    const store = createRedisIdempotencyStore(redis);
    expect(await store.get('missing')).toBeUndefined();
  });
});

describe.skipIf(!process.env.REDIS_URL)('createRedisIdempotencyStore integration', () => {
  it('connects to real Redis when REDIS_URL is set', async () => {
    const { connectHikariRedis } = await import('../src/storage/redis/redis-client.js');
    const { redis, disconnect } = await connectHikariRedis();
    const store = createRedisIdempotencyStore(redis, { keyPrefix: 'hikari:test:' });
    const key = `it-${Date.now()}`;
    await store.set(key, {
      capabilityName: 'ping',
      inputHash: 'h',
      result: { success: true, output: {}, traceId: 'trace' },
      createdAt: Date.now(),
    });
    const got = await store.get(key);
    expect(got?.capabilityName).toBe('ping');
    await disconnect();
  });
});
