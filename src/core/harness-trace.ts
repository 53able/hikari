import { randomUUID } from 'node:crypto';
import type { AuditLogger } from './audit.js';
import type { ExecutionContext } from './capability.js';
import type { AuditLevel } from './audit-scrub.js';
import { scrubAuditPayload } from './audit-scrub.js';
import type { Registry } from './registry.js';

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

/** `createHarnessTracer` のオプション。 */
export type HarnessTracerOptions = {
  /** harness イベントのデフォルト監査レベル。ケイパビリティ名がレジストリにある場合はその `auditLevel` を優先する。 */
  auditLevel?: AuditLevel;
  /** `recordToolSelected` 時にケイパビリティ別 `auditLevel` を解決するレジストリ。 */
  registry?: Registry;
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
  runtime: {},
});

const resolveHarnessAuditLevel = (
  capabilityName: string | undefined,
  options: HarnessTracerOptions,
): AuditLevel => {
  if (capabilityName && capabilityName !== '_harness' && options.registry) {
    const cap = options.registry.get(capabilityName);
    if (cap) return cap.policy.auditLevel;
  }
  return options.auditLevel ?? 'basic';
};

const recordHarness = async (
  auditLog: AuditLogger,
  options: HarnessTracerOptions,
  type: HarnessTraceEvent,
  input: HarnessRecordInput,
): Promise<void> => {
  const capabilityName = input.capabilityName ?? '_harness';
  const level = resolveHarnessAuditLevel(capabilityName, options);
  if (level === 'none') return;

  const context = baseContext(input);
  const rawPayload = {
    input: input.plan ?? input.toolInput,
    metadata: {
      ...input.metadata,
      harness: true,
      plan: input.plan,
    },
  };
  const scrubbed = scrubAuditPayload(level, rawPayload);
  await auditLog.record(type, capabilityName, context, scrubbed);
};

/**
 * `AuditLogger` に harness イベントを書き込むトレーサーを生成する。
 */
export const createHarnessTracer = (
  auditLog: AuditLogger,
  options: HarnessTracerOptions = {},
): HarnessTracer => ({
  recordIntent: (input) => recordHarness(auditLog, options, 'intent_recorded', input),
  recordPlan: (input) => recordHarness(auditLog, options, 'plan_recorded', input),
  recordToolSelected: (input) =>
    recordHarness(auditLog, options, 'tool_selected', {
      ...input,
      capabilityName: input.capabilityName,
    }),
});
