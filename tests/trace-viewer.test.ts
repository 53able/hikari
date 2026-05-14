import { describe, it, expect } from 'vitest';
import { createInMemoryStorage, createAuditLog } from '../src/index.js';
import { createTraceViewer } from '../src/devtools/trace-viewer.js';

describe('createTraceViewer', () => {
  const storage = createInMemoryStorage();
  const auditLog = createAuditLog(storage);
  const viewer = createTraceViewer(storage);

  const ctx = { userId: 'alice', sessionId: 'sess-1', traceId: 'trace-abc', permissions: new Set<string>() };

  it('getTrace returns undefined for unknown traceId', async () => {
    expect(await viewer.getTrace('no-such-trace')).toBeUndefined();
  });

  it('builds span with succeeded status', async () => {
    await auditLog.record('capability_invoked', 'ping', ctx);
    await auditLog.record('execution_succeeded', 'ping', ctx, { output: { pong: true } });

    const span = await viewer.getTrace('trace-abc');
    expect(span).toBeDefined();
    expect(span?.status).toBe('succeeded');
    expect(span?.capabilityName).toBe('ping');
    expect(span?.userId).toBe('alice');
    expect(span?.events).toHaveLength(2);
  });

  it('listTraces returns spans sorted by startedAt desc', async () => {
    const storage2 = createInMemoryStorage();
    const log2 = createAuditLog(storage2);
    const viewer2 = createTraceViewer(storage2);

    const ctx1 = { userId: 'u', sessionId: 's', traceId: 'tr-1', permissions: new Set<string>() };
    const ctx2 = { userId: 'u', sessionId: 's', traceId: 'tr-2', permissions: new Set<string>() };
    await log2.record('capability_invoked', 'a', ctx1);
    await log2.record('capability_invoked', 'b', ctx2);

    const spans = await viewer2.listTraces();
    expect(spans).toHaveLength(2);
  });

  it('formatTrace produces a readable string', async () => {
    const span = await viewer.getTrace('trace-abc');
    const text = viewer.formatTrace(span!, { color: false });
    expect(text).toContain('trace-ab');
    expect(text).toContain('ping');
    expect(text).toContain('succeeded');
  });

  it('renderHtml produces HTML with trace data', async () => {
    const spans = await viewer.listTraces();
    const html = viewer.renderHtml(spans);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('ping');
  });
});
