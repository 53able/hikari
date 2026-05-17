import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createInMemoryApprovalStore,
  createApprovalApi,
  createApprovalFileLogger,
  wrapApprovalApiWithFileLog,
  createFileApprovalStore,
} from '../src/index.js';
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
  requestedAt: new Date('2026-05-17T10:00:00.000Z'),
});

describe('createFileApprovalStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hikari-approval-store-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists pending across store restarts', async () => {
    const filePath = join(dir, 'approvals.json');

    const storeA = await createFileApprovalStore(filePath);
    const gateA = storeA.createGate();
    void gateA(sampleRequest('persist-1'));

    expect(storeA.listPending()).toHaveLength(1);
    await storeA.whenPersisted?.();

    const storeB = await createFileApprovalStore(filePath);
    expect(storeB.listPending()).toHaveLength(1);
    expect(storeB.listPending()[0]?.id).toBe('persist-1');

    expect(storeB.approve('persist-1', 'reviewer')).toBe(true);
    expect(storeB.listPending()).toHaveLength(0);
    await storeB.whenPersisted?.();

    const raw = await readFile(filePath, 'utf8');
    expect(raw).toContain('"status": "approved"');
  });

  it('unblocks waiting gate when another store approves the same file', async () => {
    const filePath = join(dir, 'cross-process.json');

    const storeA = await createFileApprovalStore(filePath, { pollMs: 200 });
    const gateA = storeA.createGate();
    const resultPromise = gateA(sampleRequest('cross-1'));
    await storeA.whenPersisted?.();

    const storeB = await createFileApprovalStore(filePath, { pollMs: 200 });
    expect(storeB.approve('cross-1', 'reviewer-tab')).toBe(true);
    await storeB.whenPersisted?.();

    const result = await Promise.race([
      resultPromise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('gate did not unblock')), 3000);
      }),
    ]);

    expect(result.approved).toBe(true);
    expect(result.approvedBy).toBe('reviewer-tab');

    storeA.dispose();
    storeB.dispose();
  });
});

describe('approval file logger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hikari-approval-log-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends pending and resolved events to JSONL', async () => {
    const filePath = join(dir, 'approvals.jsonl');
    const store = createInMemoryApprovalStore();
    const logger = createApprovalFileLogger(filePath);
    const api = wrapApprovalApiWithFileLog(createApprovalApi(store), store, logger);

    let pendingLog: Promise<void> = Promise.resolve();
    const gate = store.createGate({
      onPending: (req) => {
        pendingLog = logger.logPending(req);
      },
    });
    const pending = gate(sampleRequest('file-1'));
    await pendingLog;
    expect(await Promise.resolve(api.listPending())).toHaveLength(1);

    api.approve('file-1', 'reviewer');
    await pending;
    const stored = store.get('file-1');
    if (stored) await logger.logResolved(stored);

    const raw = await readFile(filePath, 'utf8');
    expect(raw).toContain('"event":"pending"');
    expect(raw).toContain('"event":"approved"');
  });
});
