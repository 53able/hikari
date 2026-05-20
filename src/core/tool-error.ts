import { z } from 'zod';
import { resolveExecutionError } from './error-mapping.js';

/** LLM ツール結果に載せる構造化エラーペイロード。 */
export const toolExecutionErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export type ToolExecutionErrorPayload = z.infer<typeof toolExecutionErrorPayloadSchema>;

/**
 * エンジン実行エラーを LLM 向けの短い JSON ペイロードに変換する。
 */
export const formatToolExecutionError = (err: unknown): ToolExecutionErrorPayload =>
  resolveExecutionError(err).toolPayload;

/** ペイロードを tool_result 用 JSON 文字列にする。 */
export const serializeToolExecutionError = (err: unknown): string =>
  JSON.stringify(formatToolExecutionError(err));
