import type { Registry } from './registry.js';

/** `buildHarnessPlan` のオプション。 */
export type HarnessPlanOptions = {
  /** プラン文の先頭句。省略時は汎用メッセージ。 */
  prefix?: string;
};

/** Pi が選択したツール呼び出しを表す構造化プランステップ。 */
export type HarnessPlanStep = {
  readonly capabilityName: string;
  readonly order: number;
  readonly toolCallId?: string;
};

/**
 * レジストリに登録されたケイパビリティ名から harness 用の動的プラン文字列を組み立てる。
 */
export const buildHarnessPlan = (
  registry: Registry,
  options: HarnessPlanOptions = {},
): string => {
  const names = registry.getAll().map((cap) => cap.name).sort();
  const prefix =
    options.prefix ?? 'Interpret user message, select capabilities, execute via Hikari engine';
  if (names.length === 0) return prefix;
  return `${prefix}: ${names.join(', ')}`;
};

/**
 * Pi の `tool_execution_start` 列から人間可読な実行プラン文字列を組み立てる。
 */
export const buildHarnessPlanFromToolCalls = (
  steps: readonly HarnessPlanStep[],
  options: HarnessPlanOptions = {},
): string => {
  const prefix =
    options.prefix ?? 'Execute selected capabilities via Hikari engine';
  if (steps.length === 0) return prefix;
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  const sequence = ordered
    .map((step, index) => `${index + 1}. ${step.capabilityName}`)
    .join('; ');
  return `${prefix}: ${sequence}`;
};

/** 監査 metadata に格納する構造化プランステップ。 */
export const harnessPlanStepsMetadata = (
  steps: readonly HarnessPlanStep[],
): Record<string, unknown> => ({
  planSteps: steps.map((step) => ({
    capabilityName: step.capabilityName,
    order: step.order,
    ...(step.toolCallId !== undefined ? { toolCallId: step.toolCallId } : {}),
  })),
});
