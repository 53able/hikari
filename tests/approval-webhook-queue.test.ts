import { describe, it, expect, vi } from 'vitest';
import { createQueuedApprovalNotifier } from '../src/core/approval-webhook-queue.js';
import type { ApprovalRequest } from '../src/core/approval.js';

const sampleRequest = (): ApprovalRequest => ({
  id: 'q1',
  capabilityName: 'pay',
  input: {},
  context: {
    userId: 'u',
    sessionId: 's',
    traceId: 't',
    permissions: new Set(),
  },
  riskLevel: 'financial',
  requestedAt: new Date(),
});

describe('createQueuedApprovalNotifier', () => {
  it('invokes inner notifier without throwing', async () => {
    const inner = vi.fn();
    const queued = createQueuedApprovalNotifier(inner);
    expect(() => queued(sampleRequest())).not.toThrow();
    await vi.waitFor(() => expect(inner).toHaveBeenCalledOnce());
  });

  it('retries when inner throws synchronously', async () => {
    const inner = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('fail once');
      })
      .mockImplementation(() => undefined);

    const queued = createQueuedApprovalNotifier(inner, { maxRetries: 2, retryDelayMs: 10 });
    queued(sampleRequest());

    await vi.waitFor(() => expect(inner.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
