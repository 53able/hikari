import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ExecutionResult } from '../../core/execution.js';
import type { IdempotencyRecord, IdempotencyStore } from '../../core/idempotency-store.js';

const executionResultSchema = z.object({
  success: z.literal(true),
  output: z.unknown(),
  traceId: z.string(),
});

const idempotencyLineSchema = z.object({
  key: z.string(),
  capabilityName: z.string(),
  inputHash: z.string(),
  result: executionResultSchema,
  createdAt: z.number(),
});

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
    const now = Date.now();
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
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = idempotencyLineSchema.parse(JSON.parse(trimmed));
        if (now - parsed.createdAt > ttlMs) continue;
        const result: ExecutionResult = {
          success: true,
          output: parsed.result.output,
          traceId: parsed.result.traceId,
        };
        map.set(parsed.key, {
          capabilityName: parsed.capabilityName,
          inputHash: parsed.inputHash,
          result,
          createdAt: parsed.createdAt,
        });
      } catch {
        // 破損行はスキップ
      }
    }
    return map;
  };

  return {
    async get(key) {
      const entries = await readEntries();
      const record = entries.get(key);
      if (!record) return undefined;
      if (Date.now() - record.createdAt > ttlMs) return undefined;
      return record;
    },
    async set(key, record) {
      await ensureParent();
      const line = JSON.stringify({
        key,
        capabilityName: record.capabilityName,
        inputHash: record.inputHash,
        result: record.result,
        createdAt: record.createdAt,
      });
      await appendFile(filePath, `${line}\n`, 'utf8');
    },
  };
};
