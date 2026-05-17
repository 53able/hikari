import { z } from 'zod';
import type { HikariRedis } from './redis-client.js';
import type { ExecutionResult } from './execution.js';
import type { IdempotencyRecord, IdempotencyStore } from './idempotency-store.js';

const executionResultSchema = z.object({
  success: z.literal(true),
  output: z.unknown(),
  traceId: z.string(),
});

const storedRecordSchema = z.object({
  capabilityName: z.string(),
  inputHash: z.string(),
  result: executionResultSchema,
  createdAt: z.number(),
});

/** `createRedisIdempotencyStore` のオプション。 */
export type RedisIdempotencyStoreOptions = {
  readonly keyPrefix?: string;
  /** エントリ TTL（ミリ秒）。デフォルト 24 時間。 */
  readonly ttlMs?: number;
};

const recordKey = (prefix: string, key: string): string => `${prefix}idem:${key}`;

/**
 * Redis 上の冪等結果ストア（複数 `hikari serve` インスタンス向け）。
 * `SET` + `EX` で TTL を付与し、`GET` でキャッシュを返す。
 */
export const createRedisIdempotencyStore = (
  redis: HikariRedis,
  options: RedisIdempotencyStoreOptions = {},
): IdempotencyStore => {
  const prefix = options.keyPrefix ?? 'hikari:';
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

  return {
    async get(key) {
      const raw = await redis.get(recordKey(prefix, key));
      if (!raw) return undefined;
      try {
        const parsed = storedRecordSchema.parse(JSON.parse(raw));
        if (Date.now() - parsed.createdAt > ttlMs) {
          await redis.del(recordKey(prefix, key));
          return undefined;
        }
        const result: ExecutionResult = {
          success: true,
          output: parsed.result.output,
          traceId: parsed.result.traceId,
        };
        return {
          capabilityName: parsed.capabilityName,
          inputHash: parsed.inputHash,
          result,
          createdAt: parsed.createdAt,
        };
      } catch {
        return undefined;
      }
    },

    async set(key, record) {
      const payload = JSON.stringify({
        capabilityName: record.capabilityName,
        inputHash: record.inputHash,
        result: record.result,
        createdAt: record.createdAt,
      });
      await redis.set(recordKey(prefix, key), payload, { EX: ttlSeconds });
    },
  };
};
