import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IdempotencyRecord, IdempotencyStore } from '../../core/idempotency-store.js';
import {
  isIdempotencyRecordFresh,
  parseIdempotencyLine,
  serializeIdempotencyLine,
} from '../idempotency-serialization.js';

/** `createFileIdempotencyStore` のオプション。 */
export type FileIdempotencyStoreOptions = {
  /** エントリの有効期限（ミリ秒）。デフォルト: 24 時間。 */
  readonly ttlMs?: number;
};

/**
 * JSONL ファイルへ冪等結果を追記する `IdempotencyStore`（単一ノード・再起動耐性）。
 *
 * @param filePath - 1 行 1 レコードの JSONL パス
 */
export const createFileIdempotencyStore = (
  filePath: string,
  options: FileIdempotencyStoreOptions = {},
): IdempotencyStore => {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;

  const ensureParent = async (): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
  };

  const readEntries = async (): Promise<Map<string, IdempotencyRecord>> => {
    const map = new Map<string, IdempotencyRecord>();
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return map;
      throw err;
    }
    for (const line of raw.split('\n')) {
      const parsed = parseIdempotencyLine(line, ttlMs);
      if (parsed) {
        map.set(parsed.key, parsed.record);
      }
    }
    return map;
  };

  return {
    async get(key) {
      const entries = await readEntries();
      const record = entries.get(key);
      if (!record) return undefined;
      if (!isIdempotencyRecordFresh(record.createdAt, ttlMs)) return undefined;
      return record;
    },
    async set(key, record) {
      await ensureParent();
      const line = serializeIdempotencyLine(key, record);
      await appendFile(filePath, `${line}\n`, 'utf8');
    },
  };
};
