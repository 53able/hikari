import { z } from 'zod';
import type { ApprovalRequest, ApprovalResult } from '../core/approval.js';
import type { StoredApprovalRequest } from '../core/approval-store.js';

/** 永続化用の承認ステータス。 */
export const approvalRequestStatusSchema = z.enum(['pending', 'approved', 'rejected']);

/** ファイル / Redis 共通のシリアライズ済み承認レコード。 */
export const serializedStoredApprovalSchema = z.object({
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

/** ファイル永続化用の承認 DB スナップショット。 */
export const approvalDbSchema = z.object({
  version: z.literal(1),
  requests: z.array(serializedStoredApprovalSchema),
});

export type SerializedStoredApproval = z.infer<typeof serializedStoredApprovalSchema>;

/**
 * メモリ上の承認レコードを永続化形式へ変換する。
 */
export const serializeStoredApproval = (
  stored: StoredApprovalRequest,
): SerializedStoredApproval => ({
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

/**
 * 永続化形式からメモリ上の承認レコードへ復元する。
 */
export const deserializeStoredApproval = (
  raw: SerializedStoredApproval,
): StoredApprovalRequest => ({
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

/**
 * ストア永続化レコードを API 向け `ApprovalRequest` に変換する。
 */
export const storedApprovalToRequest = (stored: StoredApprovalRequest): ApprovalRequest => ({
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
});

/**
 * 解決済みストアレコードをゲート結果へ変換する（Redis BRPOP 等で利用）。
 */
export const storedApprovalToResult = (stored: StoredApprovalRequest): ApprovalResult => {
  if (stored.status === 'approved') {
    return {
      approved: true,
      approvedBy: stored.resolvedBy ?? 'redis',
      approvedAt: stored.resolvedAt ?? new Date(),
    };
  }
  return {
    approved: false,
    rejectedBy: stored.resolvedBy ?? 'redis',
    rejectedAt: stored.resolvedAt ?? new Date(),
    reason: stored.rejectedReason,
  };
};

/**
 * JSON 文字列から永続化レコードを検証して復元する。
 */
export const parseSerializedStoredApprovalJson = (
  raw: string,
): StoredApprovalRequest =>
  deserializeStoredApproval(serializedStoredApprovalSchema.parse(JSON.parse(raw)));
