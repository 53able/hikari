import type { HikariRedis } from './redis-client.js';
import type { IdempotencyRecord, IdempotencyStore } from '../../core/idempotency-store.js';
import {
  isIdempotencyRecordFresh,
  parseStoredIdempotencyJson,
  serializeIdempotencyForRedis,
} from '../idempotency-serialization.js';

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
      const record = parseStoredIdempotencyJson(raw, ttlMs);
      if (!record) {
        await redis.del(recordKey(prefix, key));
        return undefined;
      }
      if (!isIdempotencyRecordFresh(record.createdAt, ttlMs)) {
        await redis.del(recordKey(prefix, key));
        return undefined;
      }
      return record;
    },

    async set(key, record) {
      const payload = serializeIdempotencyForRedis(record);
      await redis.set(recordKey(prefix, key), payload, { EX: ttlSeconds });
    },
  };
};
