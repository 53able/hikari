import type { HikariRedis } from './redis-client.js';
import type { ApprovalGate, ApprovalRequest, ApprovalResult } from '../../core/approval.js';
import type {
  ApprovalStore,
  QueueApprovalGateOptions,
  StoredApprovalRequest,
} from '../../core/approval-store.js';
import {
  serializeStoredApproval,
  parseSerializedStoredApprovalJson,
  storedApprovalToResult,
} from '../approval-serialization.js';

/** `createRedisApprovalStore` のオプション。 */
export type RedisApprovalStoreOptions = {
  readonly keyPrefix?: string;
};

const reqKey = (prefix: string, id: string): string => `${prefix}approval:req:${id}`;
const pendingKey = (prefix: string): string => `${prefix}approval:pending`;
const signalKey = (prefix: string, id: string): string => `${prefix}approval:signal:${id}`;

const loadStored = async (
  redis: HikariRedis,
  prefix: string,
  id: string,
): Promise<StoredApprovalRequest | undefined> => {
  const raw = await redis.get(reqKey(prefix, id));
  if (!raw) return undefined;
  try {
    return parseSerializedStoredApprovalJson(raw);
  } catch {
    return undefined;
  }
};

/**
 * Redis 上の承認キュー（複数 `hikari serve` インスタンス向け）。
 *
 * `--approval-file` のファイル監視に代わり、全インスタンスが同一 Redis を参照する。
 * ゲート解決は `BRPOP` シグナルリストで待機する。
 */
export const createRedisApprovalStore = (
  redis: HikariRedis,
  options: RedisApprovalStoreOptions = {},
): ApprovalStore => {
  const prefix = options.keyPrefix ?? 'hikari:';

  const savePending = async (request: ApprovalRequest): Promise<void> => {
    const stored: StoredApprovalRequest = {
      id: request.id,
      capabilityName: request.capabilityName,
      input: request.input,
      riskLevel: request.riskLevel,
      requestedAt: request.requestedAt,
      status: 'pending',
      userId: request.context.userId,
      sessionId: request.context.sessionId,
      traceId: request.context.traceId,
    };
    await redis.set(reqKey(prefix, request.id), JSON.stringify(serializeStoredApproval(stored)));
    await redis.zAdd(pendingKey(prefix), [
      { score: request.requestedAt.getTime(), value: request.id },
    ]);
  };

  const resolve = async (
    id: string,
    nextStatus: 'approved' | 'rejected',
    resolvedBy: string,
    reason?: string,
  ): Promise<boolean> => {
    const stored = await loadStored(redis, prefix, id);
    if (!stored || stored.status !== 'pending') return false;

    const resolvedAt = new Date();
    const updated: StoredApprovalRequest = {
      ...stored,
      status: nextStatus,
      resolvedBy,
      resolvedAt,
      rejectedReason: nextStatus === 'rejected' ? reason : undefined,
    };
    const payload = JSON.stringify(serializeStoredApproval(updated));
    await redis.set(reqKey(prefix, id), payload);
    await redis.zRem(pendingKey(prefix), id);
    await redis.lPush(signalKey(prefix, id), payload);
    return true;
  };

  const listPendingFromRedis = async (): Promise<readonly StoredApprovalRequest[]> => {
    const ids = await redis.zRangeByScore(pendingKey(prefix), '-inf', '+inf', { REV: true });
    const items: StoredApprovalRequest[] = [];
    for (const id of ids) {
      const stored = await loadStored(redis, prefix, id);
      if (stored?.status === 'pending') {
        items.push(stored);
      }
    }
    return items;
  };

  const waitForSignal = async (
    id: string,
    timeoutMs?: number,
  ): Promise<ApprovalResult | undefined> => {
    const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;

    const parseSignal = (raw: string): ApprovalResult | undefined => {
      try {
        const stored = parseSerializedStoredApprovalJson(raw);
        return storedApprovalToResult(stored);
      } catch {
        return undefined;
      }
    };

    while (deadline === undefined || Date.now() < deadline) {
      const sliceMs =
        deadline === undefined ? 1000 : Math.min(1000, Math.max(1, deadline - Date.now()));
      const timeoutSeconds = Math.max(1, Math.ceil(sliceMs / 1000));
      const popped = await redis.brPop(signalKey(prefix, id), timeoutSeconds);
      if (popped) {
        const fromSignal = parseSignal(popped.element);
        if (fromSignal) return fromSignal;
      }
      const stored = await loadStored(redis, prefix, id);
      if (stored && stored.status !== 'pending') {
        return storedApprovalToResult(stored);
      }
    }

    return undefined;
  };

  return {
    listPending: () => listPendingFromRedis(),

    get: (id) => loadStored(redis, prefix, id),

    approve: (id, approvedBy) => resolve(id, 'approved', approvedBy),

    reject: (id, rejectedBy, reason) => resolve(id, 'rejected', rejectedBy, reason),

    createGate: (gateOptions: QueueApprovalGateOptions = {}): ApprovalGate => {
      return async (request: ApprovalRequest): Promise<ApprovalResult> => {
        const existing = await loadStored(redis, prefix, request.id);
        if (existing && existing.status !== 'pending') {
          return storedApprovalToResult(existing);
        }

        if (!existing) {
          await savePending(request);
        }

        gateOptions.onPending?.(request);

        const fromSignal = await waitForSignal(request.id, gateOptions.timeoutMs);
        if (fromSignal) {
          return fromSignal;
        }

        if (gateOptions.timeoutMs !== undefined) {
          const timedOut = await resolve(
            request.id,
            'rejected',
            'timeout',
            `Approval timed out after ${gateOptions.timeoutMs}ms`,
          );
          if (timedOut) {
            const stored = await loadStored(redis, prefix, request.id);
            if (stored) return storedApprovalToResult(stored);
          }
          return {
            approved: false,
            rejectedBy: 'timeout',
            rejectedAt: new Date(),
            reason: `Approval timed out after ${gateOptions.timeoutMs}ms`,
          };
        }

        const stored = await loadStored(redis, prefix, request.id);
        if (stored && stored.status !== 'pending') {
          return storedApprovalToResult(stored);
        }

        return {
          approved: false,
          rejectedBy: 'redis',
          rejectedAt: new Date(),
          reason: 'Approval wait ended without resolution',
        };
      };
    },
  };
};
