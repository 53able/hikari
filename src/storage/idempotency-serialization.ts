import { z } from 'zod';
import type { ExecutionResult } from '../core/execution.js';
import type { IdempotencyRecord } from '../core/idempotency-store.js';

/** 冪等キャッシュに保存する実行結果の Zod スキーマ。 */
export const executionResultSchema = z.object({
  success: z.literal(true),
  output: z.unknown(),
  traceId: z.string(),
});

/** JSONL 1 行分の冪等レコード。 */
export const idempotencyLineSchema = z.object({
  key: z.string(),
  capabilityName: z.string(),
  inputHash: z.string(),
  result: executionResultSchema,
  createdAt: z.number(),
});

/** Redis に保存する冪等レコード（キーは Redis キー側で保持）。 */
export const storedIdempotencyRecordSchema = z.object({
  capabilityName: z.string(),
  inputHash: z.string(),
  result: executionResultSchema,
  createdAt: z.number(),
});

export type StoredIdempotencyPayload = z.infer<typeof storedIdempotencyRecordSchema>;

/**
 * 永続化ペイロードから `IdempotencyRecord` を構築する。
 */
export const idempotencyRecordFromPayload = (
  payload: StoredIdempotencyPayload,
): IdempotencyRecord => {
  const result: ExecutionResult = {
    success: true,
    output: payload.result.output,
    traceId: payload.result.traceId,
  };
  return {
    capabilityName: payload.capabilityName,
    inputHash: payload.inputHash,
    result,
    createdAt: payload.createdAt,
  };
};

/**
 * TTL 内のレコードかどうかを判定する。
 */
export const isIdempotencyRecordFresh = (
  createdAt: number,
  ttlMs: number,
  now: number = Date.now(),
): boolean => now - createdAt <= ttlMs;

/**
 * JSONL 行文字列から冪等レコードをパースする（破損行は undefined）。
 */
export const parseIdempotencyLine = (
  line: string,
  ttlMs: number,
): { key: string; record: IdempotencyRecord } | undefined => {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = idempotencyLineSchema.parse(JSON.parse(trimmed));
    if (!isIdempotencyRecordFresh(parsed.createdAt, ttlMs)) return undefined;
    return {
      key: parsed.key,
      record: idempotencyRecordFromPayload(parsed),
    };
  } catch {
    return undefined;
  }
};

/**
 * Redis 保存用 JSON 文字列からレコードをパースする（破損は undefined）。
 */
export const parseStoredIdempotencyJson = (
  raw: string,
  ttlMs: number,
): IdempotencyRecord | undefined => {
  try {
    const parsed = storedIdempotencyRecordSchema.parse(JSON.parse(raw));
    if (!isIdempotencyRecordFresh(parsed.createdAt, ttlMs)) return undefined;
    return idempotencyRecordFromPayload(parsed);
  } catch {
    return undefined;
  }
};

/**
 * `IdempotencyRecord` を Redis 保存用 JSON へシリアライズする。
 */
export const serializeIdempotencyForRedis = (record: IdempotencyRecord): string =>
  JSON.stringify({
    capabilityName: record.capabilityName,
    inputHash: record.inputHash,
    result: record.result,
    createdAt: record.createdAt,
  });

/**
 * JSONL 追記用の 1 行 JSON を生成する。
 */
export const serializeIdempotencyLine = (
  key: string,
  record: IdempotencyRecord,
): string =>
  JSON.stringify({
    key,
    capabilityName: record.capabilityName,
    inputHash: record.inputHash,
    result: record.result,
    createdAt: record.createdAt,
  });
