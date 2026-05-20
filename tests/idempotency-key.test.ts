import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
  buildToolIdempotencyKey,
  buildInvokerIdempotencyKey,
  enrichExecutionOptionsWithIdempotency,
} from '../src/index.js';

const writeCap = defineCapability({
  name: 'w',
  description: 'w',
  inputSchema: z.object({ n: z.number() }),
  outputSchema: z.object({ ok: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['write'], auditLevel: 'basic' },
  async handler() {
    return { ok: true };
  },
});

const readCap = defineCapability({
  name: 'r',
  description: 'r',
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler() {
    return { ok: true };
  },
});

describe('idempotency-key helpers', () => {
  it('buildToolIdempotencyKey joins traceId and toolCallId', () => {
    expect(
      buildToolIdempotencyKey({ traceId: 'trace-1', toolCallId: 'tool-9' }),
    ).toBe('trace-1:tool-9');
    expect(buildToolIdempotencyKey({ toolCallId: 'only-tool' })).toBe('only-tool');
  });

  it('buildInvokerIdempotencyKey is stable for same input', () => {
    const a = buildInvokerIdempotencyKey({
      userId: 'u1',
      capabilityName: 'w',
      input: { n: 1 },
    });
    const b = buildInvokerIdempotencyKey({
      userId: 'u1',
      capabilityName: 'w',
      input: { n: 1 },
    });
    expect(a).toBe(b);
    expect(a.startsWith('devtools:u1:w:')).toBe(true);
  });

  it('enrich adds key only for write/financial when missing', () => {
    const registry = createRegistry().register(writeCap).register(readCap);
    const base = { userId: 'u1', traceId: 't1' };

    const enriched = enrichExecutionOptionsWithIdempotency(registry, 'w', base, {
      toolCallId: 'tc-1',
    });
    expect(enriched.idempotencyKey).toBe('t1:tc-1');

    const readOpts = enrichExecutionOptionsWithIdempotency(registry, 'r', base, {
      toolCallId: 'tc-2',
    });
    expect(readOpts.idempotencyKey).toBeUndefined();
  });
});
