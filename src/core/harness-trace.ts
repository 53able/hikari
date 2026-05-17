import { randomUUID } from 'node:crypto';
import type { AuditLogger } from './audit.js';
import type { ExecutionContext } from './capability.js';

/** エージェント harness が記録する高レベルイベント（意図・計画・ツール選択）。 */
export type HarnessTraceEvent =
  | 'intent_recorded'
  | 'plan_recorded'
  | 'tool_selected';

type HarnessRecordInput = {
  traceId: string;
  userId: string;
  sessionId?: string;
  capabilityName?: string;
  intent?: string;
  plan?: string;
  toolInput?: unknown;
  metadata?: Record<string, unknown>;
};

/**
 * LLM harness 層の trace を監査ログに書き込む。
 * 記事の `intent / plan / tool calls` を capability 実行ログと同一 `traceId` で相関する。
 */
export type HarnessTracer = {
  readonly recordIntent: (input: Omit<HarnessRecordInput, 'plan' | 'toolInput'>) => Promise<void>;
  readonly recordPlan: (input: HarnessRecordInput & { plan: string }) => Promise<void>;
  readonly recordToolSelected: (
    input: HarnessRecordInput & { capabilityName: string; toolInput?: unknown },
  ) => Promise<void>;
};

const baseContext = (input: HarnessRecordInput): ExecutionContext => ({
  userId: input.userId,
  sessionId: input.sessionId ?? randomUUID(),
  traceId: input.traceId,
  intent: input.intent,
  permissions: new Set(),
});

const recordHarness = async (
  auditLog: AuditLogger,
  type: HarnessTraceEvent,
  input: HarnessRecordInput,
): Promise<void> => {
  const context = baseContext(input);
  const capabilityName = input.capabilityName ?? '_harness';
  await auditLog.record(type, capabilityName, context, {
    input: input.plan ?? input.toolInput,
    metadata: {
      ...input.metadata,
      harness: true,
      plan: input.plan,
    },
  });
};

/**
 * `AuditLogger` に harness イベントを書き込むトレーサーを生成する。
 */
export const createHarnessTracer = (auditLog: AuditLogger): HarnessTracer => ({
  recordIntent: (input) => recordHarness(auditLog, 'intent_recorded', input),
  recordPlan: (input) => recordHarness(auditLog, 'plan_recorded', input),
  recordToolSelected: (input) =>
    recordHarness(auditLog, 'tool_selected', {
      ...input,
      capabilityName: input.capabilityName,
    }),
});
