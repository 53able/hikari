import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  defineCapability,
  autoApprove,
  createInMemoryIdempotencyStore,
  IdempotencyConflictError,
  IdempotencyRequiredError,
} from '../src/index.js';

const createCounterCap = () =>
  defineCapability({
    name: 'counter',
    description: 'Increments',
    inputSchema: z.object({}),
    outputSchema: z.object({ n: z.number() }),
    policy: { requiredPermissions: [], sideEffects: ['write'], auditLevel: 'basic' },
    handler: (() => {
      let n = 0;
      return async () => {
        n += 1;
        return { n };
      };
    })(),
  });

describe('idempotency', () => {
  it('returns cached result for same key, capability, and input', async () => {
    const registry = createRegistry().register(createCounterCap());
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const idempotencyStore = createInMemoryIdempotencyStore();
    const engine = createEngine({
      registry,
      auditLog,
      approvalGate: autoApprove,
      idempotencyStore,
    });

    const opts = { userId: 'u1', idempotencyKey: 'req-1' };
    const first = await engine.execute('counter', {}, opts);
    const second = await engine.execute('counter', {}, opts);

    expect(first.output).toEqual({ n: 1 });
    expect(second.output).toEqual({ n: 1 });
    expect(second.traceId).toBe(first.traceId);
  });

  it('throws IdempotencyRequiredError when write capability omits idempotency key', async () => {
    const registry = createRegistry().register(createCounterCap());
    const engine = createEngine({
      registry,
      auditLog: createAuditLog(createInMemoryStorage()),
      approvalGate: autoApprove,
      idempotencyStore: createInMemoryIdempotencyStore(),
    });

    await expect(engine.execute('counter', {}, { userId: 'u1' })).rejects.toThrow(
      IdempotencyRequiredError,
    );
  });

  it('executes write capability when idempotency key is provided', async () => {
    const registry = createRegistry().register(createCounterCap());
    const engine = createEngine({
      registry,
      auditLog: createAuditLog(createInMemoryStorage()),
      approvalGate: autoApprove,
      idempotencyStore: createInMemoryIdempotencyStore(),
    });

    const a = await engine.execute('counter', {}, { userId: 'u1', idempotencyKey: 'k-a' });
    const b = await engine.execute('counter', {}, { userId: 'u1', idempotencyKey: 'k-b' });
    expect(a.output).toEqual({ n: 1 });
    expect(b.output).toEqual({ n: 2 });
  });

  it('throws IdempotencyConflictError when same key is reused with different input', async () => {
    const echo = defineCapability({
      name: 'echo',
      description: 'Echo',
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
      async handler({ value }) {
        return { value };
      },
    });
    const registry = createRegistry().register(echo);
    const idempotencyStore = createInMemoryIdempotencyStore();
    const engine = createEngine({
      registry,
      auditLog: createAuditLog(createInMemoryStorage()),
      approvalGate: autoApprove,
      idempotencyStore,
    });

    await engine.execute('echo', { value: 'a' }, { userId: 'u1', idempotencyKey: 'k1' });
    await expect(
      engine.execute('echo', { value: 'b' }, { userId: 'u1', idempotencyKey: 'k1' }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it('expires entries after TTL', async () => {
    vi.useFakeTimers();
    const registry = createRegistry().register(createCounterCap());
    const idempotencyStore = createInMemoryIdempotencyStore({ ttlMs: 1000 });
    const engine = createEngine({
      registry,
      auditLog: createAuditLog(createInMemoryStorage()),
      approvalGate: autoApprove,
      idempotencyStore,
    });

    const opts = { userId: 'u1', idempotencyKey: 'ttl-key' };
    await engine.execute('counter', {}, opts);
    vi.advanceTimersByTime(1500);
    const again = await engine.execute('counter', {}, opts);
    expect(again.output).toEqual({ n: 2 });
    vi.useRealTimers();
  });
});
