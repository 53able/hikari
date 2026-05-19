import type { ApprovalGate, ApprovalRequest, ApprovalResult } from './approval.js';

/** 承認リクエストのライフサイクル状態。 */
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected';

/** ストアに保持される承認リクエストのスナップショット。 */
export interface StoredApprovalRequest {
  readonly id: string;
  readonly capabilityName: string;
  readonly input: unknown;
  readonly riskLevel: string;
  readonly requestedAt: Date;
  readonly status: ApprovalRequestStatus;
  readonly userId: string;
  readonly sessionId: string;
  readonly traceId: string;
  readonly rejectedReason?: string;
  readonly resolvedBy?: string;
  readonly resolvedAt?: Date;
}

/** `createQueueApprovalGate` のオプション。 */
export interface QueueApprovalGateOptions {
  /**
   * リクエストが pending になった直後に呼ばれる。
   * チャット SSE の `approval_required` イベント送出などに使う。
   */
  readonly onPending?: (request: ApprovalRequest) => void;
  /** pending のままこの時間を超えたら自動拒否する。省略時はタイムアウトなし。 */
  readonly timeoutMs?: number;
}

type PendingSlot = {
  readonly request: ApprovalRequest;
  status: ApprovalRequestStatus;
  rejectedReason?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  readonly waiters: Array<(result: ApprovalResult) => void>;
  timeoutHandle?: ReturnType<typeof setTimeout>;
};

const toStored = (slot: PendingSlot): StoredApprovalRequest => ({
  id: slot.request.id,
  capabilityName: slot.request.capabilityName,
  input: slot.request.input,
  riskLevel: slot.request.riskLevel,
  requestedAt: slot.request.requestedAt,
  status: slot.status,
  userId: slot.request.context.userId,
  sessionId: slot.request.context.sessionId,
  traceId: slot.request.context.traceId,
  rejectedReason: slot.rejectedReason,
  resolvedBy: slot.resolvedBy,
  resolvedAt: slot.resolvedAt,
});

/** ファイル永続化用の読み書きフック。 */
export type ApprovalStorePersistence = {
  readonly load: () => Promise<readonly StoredApprovalRequest[]>;
  readonly save: (requests: readonly StoredApprovalRequest[]) => Promise<void>;
  readonly toApprovalRequest: (stored: StoredApprovalRequest) => ApprovalRequest;
};

/**
 * 承認待ちリクエストを保持し、非同期に解決するストア。
 * HTTP 管理 API やチャット UI から `approve` / `reject` を呼ぶ前提。
 */
export type ApprovalStore = {
  /** pending 状態のリクエスト一覧（新しい順）。 */
  readonly listPending: () => readonly StoredApprovalRequest[] | Promise<readonly StoredApprovalRequest[]>;
  /** ID で保存済みリクエストを取得する。見つからなければ `undefined`。 */
  readonly get: (id: string) => StoredApprovalRequest | undefined | Promise<StoredApprovalRequest | undefined>;
  /**
   * リクエストを承認し、待機中のゲートを解決する。
   * @returns 解決できた場合 `true`（既に解決済み・存在しない場合は `false`）。
   */
  readonly approve: (id: string, approvedBy: string) => boolean | Promise<boolean>;
  /**
   * リクエストを拒否し、待機中のゲートを解決する。
   * @returns 解決できた場合 `true`。
   */
  readonly reject: (id: string, rejectedBy: string, reason?: string) => boolean | Promise<boolean>;
  /**
   * 承認ゲート関数を生成する。呼び出しは pending 登録後、人間が解決するまでブロックする。
   */
  readonly createGate: (options?: QueueApprovalGateOptions) => ApprovalGate;
  /** 永続化が有効なとき、直近のディスク書き込み完了を待つ（テスト用）。 */
  readonly whenPersisted?: () => Promise<void>;
  /**
   * 外部プロセスが更新したスナップショットを取り込み、pending ゲートの待機を解決する。
   * ファイル永続化ストアの watch / poll から呼ぶ。
   */
  readonly syncFromSnapshot?: (requests: readonly StoredApprovalRequest[]) => void;
};

/** @deprecated 互換エイリアス。`ApprovalStore` を使用してください。 */
export type InMemoryApprovalStore = ApprovalStore;

const slotFromStored = (
  stored: StoredApprovalRequest,
  toRequest: ApprovalStorePersistence['toApprovalRequest'],
): PendingSlot => ({
  request: toRequest(stored),
  status: stored.status,
  rejectedReason: stored.rejectedReason,
  resolvedBy: stored.resolvedBy,
  resolvedAt: stored.resolvedAt,
  waiters: [],
});

/** `createApprovalStore` のオプション。 */
export type ApprovalStoreOptions = {
  readonly persistence?: ApprovalStorePersistence;
  /** 起動時にメモリへ読み込むスナップショット（ファイルストア向け）。 */
  readonly initial?: readonly StoredApprovalRequest[];
};

/**
 * 承認ストアを生成する。`persistence` を渡すと変更のたびにディスクへ同期する。
 */
export const createApprovalStore = (
  options: ApprovalStoreOptions = {},
): ApprovalStore => {
  const { persistence, initial = [] } = options;
  const slots = new Map<string, PendingSlot>();

  const toRequest = persistence?.toApprovalRequest ?? ((stored: StoredApprovalRequest): ApprovalRequest => ({
    id: stored.id,
    capabilityName: stored.capabilityName,
    input: stored.input,
    context: {
      userId: stored.userId,
      sessionId: stored.sessionId,
      traceId: stored.traceId,
      permissions: new Set(),
      runtime: {},
    },
    riskLevel: stored.riskLevel,
    requestedAt: stored.requestedAt,
  }));

  for (const item of initial) {
    slots.set(item.id, slotFromStored(item, toRequest));
  }

  const snapshotAll = (): StoredApprovalRequest[] =>
    [...slots.values()].map(toStored);

  let persistChain: Promise<void> = Promise.resolve();

  const persist = (): void => {
    if (!persistence) return;
    persistChain = persistChain
      .then(() => persistence.save(snapshotAll()))
      .catch((err) => {
        console.error(
          '[hikari] approval store persist failed:',
          err instanceof Error ? err.message : String(err),
        );
      });
  };

  const settle = (slot: PendingSlot, result: ApprovalResult): void => {
    if (slot.timeoutHandle !== undefined) {
      clearTimeout(slot.timeoutHandle);
      slot.timeoutHandle = undefined;
    }
    const waiters = [...slot.waiters];
    slot.waiters.length = 0;
    for (const resolve of waiters) {
      resolve(result);
    }
  };

  const resolvePending = (
    id: string,
    result: ApprovalResult,
  ): boolean => {
    const slot = slots.get(id);
    if (!slot || slot.status !== 'pending') return false;

    if (result.approved) {
      slot.status = 'approved';
      slot.resolvedBy = result.approvedBy;
      slot.resolvedAt = result.approvedAt;
    } else {
      slot.status = 'rejected';
      slot.resolvedBy = result.rejectedBy;
      slot.resolvedAt = result.rejectedAt;
      slot.rejectedReason = result.reason;
    }

    settle(slot, result);
    persist();
    return true;
  };

  const whenPersisted = (): Promise<void> => persistChain;

  const syncFromSnapshot = (requests: readonly StoredApprovalRequest[]): void => {
    for (const incoming of requests) {
      const slot = slots.get(incoming.id);
      if (!slot) {
        if (incoming.status !== 'pending') {
          slots.set(
            incoming.id,
            slotFromStored(incoming, toRequest),
          );
        }
        continue;
      }
      if (slot.status !== 'pending' || incoming.status === 'pending') {
        continue;
      }
      if (incoming.status === 'approved') {
        resolvePending(incoming.id, {
          approved: true,
          approvedBy: incoming.resolvedBy ?? 'external',
          approvedAt: incoming.resolvedAt ?? new Date(),
        });
        continue;
      }
      resolvePending(incoming.id, {
        approved: false,
        rejectedBy: incoming.resolvedBy ?? 'external',
        rejectedAt: incoming.resolvedAt ?? new Date(),
        reason: incoming.rejectedReason,
      });
    }
  };

  const store: ApprovalStore = {
    listPending: () =>
      [...slots.values()]
        .filter((s) => s.status === 'pending')
        .map(toStored)
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()),

    get: (id) => {
      const slot = slots.get(id);
      return slot ? toStored(slot) : undefined;
    },

    approve: (id, approvedBy) =>
      resolvePending(id, {
        approved: true,
        approvedBy,
        approvedAt: new Date(),
      }),

    reject: (id, rejectedBy, reason) =>
      resolvePending(id, {
        approved: false,
        rejectedBy,
        rejectedAt: new Date(),
        reason,
      }),

    createGate: (options = {}) => (request): Promise<ApprovalResult> => {
      const existing = slots.get(request.id);
      if (existing && existing.status !== 'pending') {
        if (existing.status === 'approved') {
          return Promise.resolve({
            approved: true,
            approvedBy: existing.resolvedBy ?? 'store',
            approvedAt: existing.resolvedAt ?? new Date(),
          });
        }
        return Promise.resolve({
          approved: false,
          rejectedBy: existing.resolvedBy ?? 'store',
          rejectedAt: existing.resolvedAt ?? new Date(),
          reason: existing.rejectedReason,
        });
      }

      const slot: PendingSlot = existing ?? {
        request,
        status: 'pending',
        waiters: [],
      };
      if (!existing) {
        slots.set(request.id, slot);
        persist();
      }

      options.onPending?.(request);

      if (options.timeoutMs !== undefined && slot.timeoutHandle === undefined) {
        slot.timeoutHandle = setTimeout(() => {
          resolvePending(request.id, {
            approved: false,
            rejectedBy: 'timeout',
            rejectedAt: new Date(),
            reason: `Approval timed out after ${options.timeoutMs}ms`,
          });
        }, options.timeoutMs);
      }

      return new Promise<ApprovalResult>((resolve) => {
        if (slot.status === 'approved' && slot.resolvedBy && slot.resolvedAt) {
          resolve({
            approved: true,
            approvedBy: slot.resolvedBy,
            approvedAt: slot.resolvedAt,
          });
          return;
        }
        if (slot.status === 'rejected' && slot.resolvedBy && slot.resolvedAt) {
          resolve({
            approved: false,
            rejectedBy: slot.resolvedBy,
            rejectedAt: slot.resolvedAt,
            reason: slot.rejectedReason,
          });
          return;
        }
        slot.waiters.push(resolve);
      });
    },
    ...(persistence ? { whenPersisted, syncFromSnapshot } : {}),
  };

  return store;
};

/**
 * インメモリ承認キューを生成する。
 */
export const createInMemoryApprovalStore = (): ApprovalStore => createApprovalStore();

/** HTTP / チャットから承認操作するための薄い API ファサード。 */
export type ApprovalApi = {
  readonly listPending: () => ReturnType<ApprovalStore['listPending']>;
  readonly get: (id: string) => ReturnType<ApprovalStore['get']>;
  readonly approve: (id: string, by: string) => ReturnType<ApprovalStore['approve']>;
  readonly reject: (id: string, by: string, reason?: string) => ReturnType<ApprovalStore['reject']>;
};

/**
 * 承認ストアに対する REST 風 JSON ハンドラー用の API を生成する。
 */
export const createApprovalApi = (store: ApprovalStore): ApprovalApi => ({
  listPending: () => Promise.resolve(store.listPending()),
  get: (id) => Promise.resolve(store.get(id)),
  approve: (id, by) => Promise.resolve(store.approve(id, by)),
  reject: (id, by, reason) => Promise.resolve(store.reject(id, by, reason)),
});
