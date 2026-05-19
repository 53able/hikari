import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuditLog } from '../src/index.js';
import { createJsonlAuditStorage } from '../src/file.js';

describe('createJsonlAuditStorage', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('appends and queries entries round-trip', async () => {
    dir = await mkdtemp(join(tmpdir(), 'hikari-audit-'));
    const filePath = join(dir, 'audit.jsonl');
    const storage = createJsonlAuditStorage(filePath);
    const auditLog = createAuditLog(storage);

    await auditLog.record(
      'capability_invoked',
      'echo',
      {
        userId: 'user-a',
        sessionId: 'sess-1',
        traceId: 'trace-99',
        permissions: new Set(),
      },
      { input: { x: 1 } },
    );
    await auditLog.record(
      'execution_succeeded',
      'echo',
      {
        userId: 'user-a',
        sessionId: 'sess-1',
        traceId: 'trace-99',
        permissions: new Set(),
      },
      { output: { y: 2 } },
    );

    const byTrace = await storage.query({ traceId: 'trace-99' });
    expect(byTrace).toHaveLength(2);
    expect(byTrace[0]?.type).toBe('capability_invoked');
    expect(byTrace[1]?.type).toBe('execution_succeeded');
    expect(byTrace[0]?.timestamp).toBeInstanceOf(Date);

    const byUser = await storage.query({ userId: 'user-a' });
    expect(byUser).toHaveLength(2);

    const empty = await storage.query({ traceId: 'missing' });
    expect(empty).toHaveLength(0);
  });
});
