import { createHash } from 'node:crypto';
import type { ExecutionResult } from './execution.js';

/** 冪等キーに紐づくキャッシュ済み実行結果。 */
export type IdempotencyRecord = {
  readonly capabilityName: string;
  readonly inputHash: string;
  readonly result: ExecutionResult;
  readonly createdAt: number;
};

/**
 * 冪等実行結果のストレージ。
 * 将来 Redis 等に差し替え可能なインターフェース。
 */
export type IdempotencyStore = {
  /** 有効なレコードがあれば返す。TTL 超過分は削除して `undefined`。 */
  readonly get: (key: string) => Promise<IdempotencyRecord | undefined>;
  /** 成功結果を保存する（同一キーは上書き）。 */
  readonly set: (key: string, record: IdempotencyRecord) => Promise<void>;
};

/** `createInMemoryIdempotencyStore` のオプション。 */
export type InMemoryIdempotencyStoreOptions = {
  /** エントリの有効期限（ミリ秒）。デフォルト: 24 時間。 */
  readonly ttlMs?: number;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
};

/**
 * ケイパビリティ入力の安定ハッシュ（SHA-256 hex）。
 * 同一論理入力は常に同一ハッシュになる。
 */
export const hashCapabilityInput = (input: unknown): string =>
  createHash('sha256').update(stableStringify(input)).digest('hex');

/**
 * 冪等ストアのキー（クライアントが送る `Idempotency-Key` / `idempotencyKey`）。
 * 同一キーで別ケイパビリティ・別入力が来た場合は `IdempotencyConflictError` とする。
 */
export const buildIdempotencyStoreKey = (idempotencyKey: string): string => idempotencyKey;

/**
 * プロセス内メモリの冪等ストア（開発・テスト・単一インスタンス向け）。
 */
export const createInMemoryIdempotencyStore = (
  options: InMemoryIdempotencyStoreOptions = {},
): IdempotencyStore => {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const entries = new Map<string, IdempotencyRecord>();

  const pruneExpired = (now: number): void => {
    for (const [key, record] of entries) {
      if (now - record.createdAt > ttlMs) {
        entries.delete(key);
      }
    }
  };

  return {
    async get(key) {
      const now = Date.now();
      pruneExpired(now);
      const record = entries.get(key);
      if (!record) return undefined;
      if (now - record.createdAt > ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return record;
    },
    async set(key, record) {
      entries.set(key, record);
    },
  };
};
