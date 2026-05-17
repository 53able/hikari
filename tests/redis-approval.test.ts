import { describe, it, expect, vi } from 'vitest';
import { createRedisApprovalStore } from '../src/core/redis-approval.js';
import type { ApprovalRequest } from '../src/core/approval.js';
import { createFakeRedis } from './helpers/redis-fake.js';

const sampleRequest = (id: string): ApprovalRequest => ({
  id,
  capabilityName: 'pay',
  input: { amount: 10 },
  context: {
    userId: 'u1',
    sessionId: 's1',
    traceId: 't1',
    permissions: new Set(),
  },
  riskLevel: 'financial',
  requestedAt: new Date(),
});

describe('createRedisApprovalStore', () => {
  it('lists pending and resolves via approve', async () => {
    const redis = createFakeRedis();
    const store = createRedisApprovalStore(redis);
    const gate = store.createGate();
    const pendingPromise = gate(sampleRequest('redis-a1'));

    await vi.waitFor(async () => {
      const pending = await Promise.resolve(store.listPending());
      expect(pending.length).toBeGreaterThanOrEqual(1);
    });
    const pending = await Promise.resolve(store.listPending());
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('redis-a1');

    const ok = await Promise.resolve(store.approve('redis-a1', 'reviewer'));
    expect(ok).toBe(true);

    const result = await pendingPromise;
    expect(result.approved).toBe(true);
    expect((await Promise.resolve(store.listPending()))).toHaveLength(0);
  });

  it('rejects via reject()', async () => {
    const redis = createFakeRedis();
    const store = createRedisApprovalStore(redis);
    const gate = store.createGate();
    const pendingPromise = gate(sampleRequest('redis-b1'));

    await vi.waitFor(async () => {
      expect((await Promise.resolve(store.listPending())).length).toBe(1);
    });
    await Promise.resolve(store.reject('redis-b1', 'reviewer', 'nope'));
    const result = await pendingPromise;
    expect(result.approved).toBe(false);
    if (!result.approved) {
      expect(result.reason).toBe('nope');
    }
  });
});
