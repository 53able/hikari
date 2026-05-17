import { describe, it, expect, vi, afterEach } from 'vitest';
import { devAutoApprove } from '../src/core/approval.js';
import { createInMemoryApprovalStore } from '../src/core/approval-store.js';
import type { ApprovalRequest } from '../src/core/approval.js';

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

describe('devAutoApprove', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('auto-approves when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    const result = await devAutoApprove(sampleRequest('r1'));
    expect(result.approved).toBe(true);
  });

  it('throws when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(devAutoApprove(sampleRequest('r1'))).rejects.toThrow(
      'devAutoApprove must not be used in production',
    );
  });
});

describe('createInMemoryApprovalStore', () => {
  it('lists pending until resolved', async () => {
    const store = createInMemoryApprovalStore();
    const gate = store.createGate();
    const pendingPromise = gate(sampleRequest('a1'));

    expect(store.listPending()).toHaveLength(1);
    expect(store.listPending()[0]?.id).toBe('a1');

    store.approve('a1', 'reviewer');
    const result = await pendingPromise;
    expect(result.approved).toBe(true);
    expect(store.listPending()).toHaveLength(0);
  });

  it('rejects via reject()', async () => {
    const store = createInMemoryApprovalStore();
    const gate = store.createGate();
    const pendingPromise = gate(sampleRequest('b1'));

    store.reject('b1', 'reviewer', 'too risky');
    const result = await pendingPromise;
    expect(result.approved).toBe(false);
    if (!result.approved) {
      expect(result.reason).toBe('too risky');
    }
  });

  it('calls onPending when enqueued', async () => {
    const store = createInMemoryApprovalStore();
    const onPending = vi.fn();
    const gate = store.createGate({ onPending });
    const pendingPromise = gate(sampleRequest('c1'));

    expect(onPending).toHaveBeenCalledOnce();
    store.approve('c1', 'ui');
    await pendingPromise;
  });

  it('times out when timeoutMs is set', async () => {
    vi.useFakeTimers();
    const store = createInMemoryApprovalStore();
    const gate = store.createGate({ timeoutMs: 5_000 });
    const pendingPromise = gate(sampleRequest('d1'));

    vi.advanceTimersByTime(5_001);
    const result = await pendingPromise;
    expect(result.approved).toBe(false);
    vi.useRealTimers();
  });
});
