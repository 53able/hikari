import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createApprovalWebhookNotifier,
  createSlackApprovalWebhookNotifier,
  approvalNotifiersFromEnv,
} from '../src/core/approval-webhook.js';
import type { ApprovalRequest } from '../src/core/approval.js';

const sampleRequest = (): ApprovalRequest => ({
  id: 'req-wh',
  capabilityName: 'pay',
  input: { amount: 1 },
  context: {
    userId: 'u1',
    sessionId: 's1',
    traceId: 't1',
    permissions: new Set(),
  },
  riskLevel: 'financial',
  requestedAt: new Date('2026-05-17T00:00:00.000Z'),
});

describe('approval webhooks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.HIKARI_APPROVAL_WEBHOOK_URL;
    delete process.env.HIKARI_SLACK_WEBHOOK_URL;
  });

  it('POSTs approval.pending payload to configured URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const logError = vi.fn();

    const notify = createApprovalWebhookNotifier({
      url: 'https://example.test/hook',
      fetchFn: fetchMock,
      logError,
    });
    notify(sampleRequest());

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/hook');
    const body = JSON.parse(String(init.body)) as { type: string; id: string };
    expect(body.type).toBe('approval.pending');
    expect(body.id).toBe('req-wh');
    expect(logError).not.toHaveBeenCalled();
  });

  it('POSTs Slack blocks when slack URL is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const notify = createSlackApprovalWebhookNotifier({
      url: 'https://hooks.slack.com/services/x',
      fetchFn: fetchMock,
    });

    notify(sampleRequest());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      type: string;
      blocks: unknown[];
    };
    expect(body.type).toBe('approval.pending');
    expect(body.blocks.length).toBeGreaterThan(0);
  });

  it('logs and does not throw when webhook fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const logError = vi.fn();
    const notify = createApprovalWebhookNotifier({
      url: 'https://example.test/hook',
      fetchFn: fetchMock,
      logError,
    });

    expect(() => notify(sampleRequest())).not.toThrow();
    await vi.waitFor(() => expect(logError).toHaveBeenCalledOnce());
  });

  it('builds notifiers from env', () => {
    process.env.HIKARI_APPROVAL_WEBHOOK_URL = 'https://example.test/a';
    process.env.HIKARI_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/b';
    expect(approvalNotifiersFromEnv()).toHaveLength(2);
  });
});
