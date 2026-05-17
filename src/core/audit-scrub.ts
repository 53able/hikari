import type { Capability } from './capability.js';

/** 監査ログに記録する詳細度。ケイパビリティ `policy.auditLevel` と harness 設定で共有する。 */
export type AuditLevel = Capability['policy']['auditLevel'];

type AuditPayload = {
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
};

/**
 * `auditLevel` に応じて監査ペイロードをマスクする。
 * `execution.ts` と harness トレーサーで共有する。
 */
export const scrubAuditPayload = (
  level: AuditLevel,
  data?: AuditPayload,
): AuditPayload | undefined => {
  if (!data) return undefined;
  if (level === 'full') return data;
  if (level === 'basic') {
    return {
      error: data.error,
      metadata: data.metadata,
    };
  }
  return undefined;
};
