import { watch } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { z } from 'zod';
import type { ApprovalRequest } from './approval.js';
import {
  createApprovalStore,
  type ApprovalStore,
  type ApprovalStorePersistence,
  type StoredApprovalRequest,
} from './approval-store.js';

const approvalRequestStatusSchema = z.enum(['pending', 'approved', 'rejected']);

const serializedStoredApprovalSchema = z.object({
  id: z.string(),
  capabilityName: z.string(),
  input: z.unknown(),
  riskLevel: z.string(),
  requestedAt: z.string(),
  status: approvalRequestStatusSchema,
  userId: z.string(),
  sessionId: z.string(),
  traceId: z.string(),
  rejectedReason: z.string().optional(),
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),
});

const approvalDbSchema = z.object({
  version: z.literal(1),
  requests: z.array(serializedStoredApprovalSchema),
});

type SerializedStoredApproval = z.infer<typeof serializedStoredApprovalSchema>;

/** `createFileApprovalStore` のオプション。 */
export type FileApprovalStoreOptions = {
  /** ファイル変更のポーリング間隔（ms）。デフォルト 2000。 */
  readonly pollMs?: number;
};

/** ファイル監視付き承認ストア。`dispose` で watch / poll を停止する。 */
export type FileApprovalStore = ApprovalStore & {
  readonly dispose: () => void;
};

const serializeStored = (stored: StoredApprovalRequest): SerializedStoredApproval => ({
  id: stored.id,
  capabilityName: stored.capabilityName,
  input: stored.input,
  riskLevel: stored.riskLevel,
  requestedAt: stored.requestedAt.toISOString(),
  status: stored.status,
  userId: stored.userId,
  sessionId: stored.sessionId,
  traceId: stored.traceId,
  rejectedReason: stored.rejectedReason,
  resolvedBy: stored.resolvedBy,
  resolvedAt: stored.resolvedAt?.toISOString(),
});

const deserializeStored = (raw: SerializedStoredApproval): StoredApprovalRequest => ({
  id: raw.id,
  capabilityName: raw.capabilityName,
  input: raw.input,
  riskLevel: raw.riskLevel,
  requestedAt: new Date(raw.requestedAt),
  status: raw.status,
  userId: raw.userId,
  sessionId: raw.sessionId,
  traceId: raw.traceId,
  rejectedReason: raw.rejectedReason,
  resolvedBy: raw.resolvedBy,
  resolvedAt: raw.resolvedAt ? new Date(raw.resolvedAt) : undefined,
});

const toApprovalRequest = (stored: StoredApprovalRequest): ApprovalRequest => ({
  id: stored.id,
  capabilityName: stored.capabilityName,
  input: stored.input,
  context: {
    userId: stored.userId,
    sessionId: stored.sessionId,
    traceId: stored.traceId,
    permissions: new Set(),
  },
  riskLevel: stored.riskLevel,
  requestedAt: stored.requestedAt,
});

const createFilePersistence = (filePath: string): ApprovalStorePersistence => {
  const ensureParent = async (): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
  };

  const flush = async (requests: readonly StoredApprovalRequest[]): Promise<void> => {
    await ensureParent();
    const body = JSON.stringify(
      {
        version: 1,
        requests: requests.map(serializeStored),
      },
      null,
      2,
    );
    await writeFile(filePath, body, 'utf8');
  };

  return {
    async load() {
      let raw: string;
      try {
        raw = await readFile(filePath, 'utf8');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return [];
        throw err;
      }
      const trimmed = raw.trim();
      if (!trimmed) return [];
      const parsed = approvalDbSchema.parse(JSON.parse(trimmed));
      return parsed.requests.map(deserializeStored);
    },
    async save(requests) {
      await flush(requests);
    },
    toApprovalRequest,
  };
};

const attachFileWatcher = (
  filePath: string,
  store: ApprovalStore,
  pollMs: number,
): (() => void) => {
  const syncFromDisk = async (): Promise<void> => {
    if (!store.syncFromSnapshot) return;
    try {
      const persistence = createFilePersistence(filePath);
      const loaded = await persistence.load();
      store.syncFromSnapshot(loaded);
    } catch (err) {
      console.error(
        '[hikari] approval file sync failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const scheduleSync = (): void => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      void syncFromDisk();
    }, 100);
  };

  const baseName = basename(filePath);
  const parentDir = dirname(filePath);
  let watcher: ReturnType<typeof watch> | undefined;
  try {
    watcher = watch(filePath, scheduleSync);
  } catch {
    watcher = watch(parentDir, (_event, filename) => {
      if (filename && filename !== baseName) return;
      scheduleSync();
    });
  }

  const poll = setInterval(() => {
    void syncFromDisk();
  }, pollMs);

  return () => {
    watcher?.close();
    clearInterval(poll);
    if (debounce !== undefined) clearTimeout(debounce);
  };
};

/**
 * JSON ファイルへ承認キューを永続化する `ApprovalStore`。
 * ファイル変更を watch / poll し、他プロセス・タブからの承認で待機中ゲートを解決する。
 *
 * @param filePath - 例: `./approvals.json`
 */
export const createFileApprovalStore = async (
  filePath: string,
  options: FileApprovalStoreOptions = {},
): Promise<FileApprovalStore> => {
  await mkdir(dirname(filePath), { recursive: true });
  const persistence = createFilePersistence(filePath);
  const initial = await persistence.load();
  const store = createApprovalStore({ persistence, initial });
  const pollMs = options.pollMs ?? 2000;
  const dispose = attachFileWatcher(filePath, store, pollMs);
  return Object.assign(store, { dispose });
};
