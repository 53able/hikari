import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ExecutionResult } from '../../core/execution.js';
import {
  createInMemoryIdempotencyStore,
  type IdempotencyRecord,
  type IdempotencyStore,
  type InMemoryIdempotencyStoreOptions,
} from '../../core/idempotency-store.js';

type SerializedIdempotencyLine = {
  readonly key: string;
  readonly capabilityName: string;
  readonly inputHash: string;
  readonly result: ExecutionResult;
  readonly createdAt: number;
};

const serializeLine = (key: string, record: IdempotencyRecord): string =>
  JSON.stringify({
    key,
    capabilityName: record.capabilityName,
    inputHash: record.inputHash,
    result: record.result,
    createdAt: record.createdAt,
  } satisfies SerializedIdempotencyLine);

const parseLine = (line: string): { key: string; record: IdempotencyRecord } | undefined => {
  try {
    const raw = JSON.parse(line) as SerializedIdempotencyLine;
    if (!raw.key || !raw.capabilityName) return undefined;
    return {
      key: raw.key,
      record: {
        capabilityName: raw.capabilityName,
        inputHash: raw.inputHash,
        result: raw.result,
        createdAt: raw.createdAt,
      },
    };
  } catch {
    return undefined;
  }
};

/**
 * JSONL ファイルへ冪等結果を追記し、起動時に既存行をメモリへ読み込む `IdempotencyStore`。
 *
 * @param filePath - 追記先 JSONL パス（親ディレクトリが無ければ作成する）
 * @param options - インメモリ層と同じ TTL 設定
 */
export const createJsonlIdempotencyStore = (
  filePath: string,
  options: InMemoryIdempotencyStoreOptions = {},
): IdempotencyStore => {
  const memory = createInMemoryIdempotencyStore(options);
  let hydrated = false;

  const ensureParent = async (): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
  };

  const hydrateFromFile = async (): Promise<void> => {
    if (hydrated) return;
    hydrated = true;
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw err;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = parseLine(trimmed);
      if (parsed) {
        await memory.set(parsed.key, parsed.record);
      }
    }
  };

  return {
    async get(key) {
      await hydrateFromFile();
      return memory.get(key);
    },
    async set(key, record) {
      await hydrateFromFile();
      await memory.set(key, record);
      await ensureParent();
      await appendFile(filePath, `${serializeLine(key, record)}\n`, 'utf8');
    },
  };
};

/** `createJsonlIdempotencyStore` のエイリアス（CLI `--idempotency-file` 向け）。 */
export const createFileIdempotencyStore = createJsonlIdempotencyStore;
