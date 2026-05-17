import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
  createEngine,
  createAuditLog,
  createInMemoryStorage,
  autoApprove,
  createFileIdempotencyStore,
} from '../src/index.js';

const echo = defineCapability({
  name: 'echo',
  description: 'echo',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ value: z.string() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  handler: async ({ value }) => ({ value }),
});

describe('createFileIdempotencyStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hikari-idem-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists and reloads idempotent results across store instances', async () => {
    const filePath = join(dir, 'idem.jsonl');
    const registry = createRegistry().register(echo);
    const auditLog = createAuditLog(createInMemoryStorage());

    const store1 = createFileIdempotencyStore(filePath);
    const engine1 = createEngine({
      registry,
      auditLog,
      approvalGate: autoApprove,
      idempotencyStore: store1,
    });

    await engine1.execute('echo', { value: 'persist' }, { userId: 'u1', idempotencyKey: 'k-persist' });

    const raw = await readFile(filePath, 'utf8');
    expect(raw).toContain('k-persist');

    const store2 = createFileIdempotencyStore(filePath);
    const engine2 = createEngine({
      registry,
      auditLog,
      approvalGate: autoApprove,
      idempotencyStore: store2,
    });

    const second = await engine2.execute(
      'echo',
      { value: 'persist' },
      { userId: 'u1', idempotencyKey: 'k-persist' },
    );
    expect(second.output).toEqual({ value: 'persist' });
  });
});
