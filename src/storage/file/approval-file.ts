import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ApprovalRequest } from '../../core/approval.js';
import type { ApprovalApi, ApprovalStore, StoredApprovalRequest } from '../../core/approval-store.js';

/** JSONL 1 行分の承認イベント。 */
export type ApprovalFileEvent = {
  readonly event: 'pending' | 'approved' | 'rejected';
  readonly at: string;
  readonly request: StoredApprovalRequest;
};

/**
 * 承認キューの状態変化を JSONL へ追記するロガー。
 * プロセス再起動後の pending 復元は行わない（監査・外部連携向け）。
 */
export type ApprovalFileLogger = {
  readonly logPending: (request: ApprovalRequest) => Promise<void>;
  readonly logResolved: (stored: StoredApprovalRequest) => Promise<void>;
};

/**
 * 承認イベント JSONL ログを生成する（`--approval-log-file` 等のプログラム利用向け）。
 *
 * @param filePath - 追記先ファイルパス
 */
export const createApprovalFileLogger = (filePath: string): ApprovalFileLogger => {
  const ensureParent = async (): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
  };

  const append = async (event: ApprovalFileEvent): Promise<void> => {
    await ensureParent();
    await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  };

  const toStored = (request: ApprovalRequest): StoredApprovalRequest => ({
    id: request.id,
    capabilityName: request.capabilityName,
    input: request.input,
    riskLevel: request.riskLevel,
    requestedAt: request.requestedAt,
    status: 'pending',
    userId: request.context.userId,
    sessionId: request.context.sessionId,
    traceId: request.context.traceId,
  });

  return {
    logPending: async (request) => {
      await append({
        event: 'pending',
        at: new Date().toISOString(),
        request: toStored(request),
      });
    },
    logResolved: async (stored) => {
      await append({
        event: stored.status === 'approved' ? 'approved' : 'rejected',
        at: (stored.resolvedAt ?? new Date()).toISOString(),
        request: stored,
      });
    },
  };
};

/**
 * 承認 API の解決操作を JSONL へ追記するラッパー。
 */
const logResolvedIfPresent = (
  store: ApprovalStore,
  logger: ApprovalFileLogger,
  id: string,
): void => {
  const stored = store.get(id);
  if (stored instanceof Promise) {
    void stored.then((value) => {
      if (value) void logger.logResolved(value);
    });
    return;
  }
  if (stored) void logger.logResolved(stored);
};

export const wrapApprovalApiWithFileLog = (
  api: ApprovalApi,
  store: ApprovalStore,
  logger: ApprovalFileLogger,
): ApprovalApi => ({
  listPending: () => api.listPending(),
  get: (id) => api.get(id),
  approve: (id, by) => {
    const outcome = api.approve(id, by);
    const after = (ok: boolean) => {
      if (ok) logResolvedIfPresent(store, logger, id);
      return ok;
    };
    return outcome instanceof Promise ? outcome.then(after) : after(outcome);
  },
  reject: (id, by, reason) => {
    const outcome = api.reject(id, by, reason);
    const after = (ok: boolean) => {
      if (ok) logResolvedIfPresent(store, logger, id);
      return ok;
    };
    return outcome instanceof Promise ? outcome.then(after) : after(outcome);
  },
});
