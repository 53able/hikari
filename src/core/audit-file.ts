import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEntry, AuditStorage } from './audit.js';

type AuditFilter = Parameters<AuditStorage['query']>[0];

type SerializedAuditEntry = Omit<AuditEntry, 'timestamp'> & { timestamp: string };

const serializeEntry = (entry: AuditEntry): string =>
  JSON.stringify({
    ...entry,
    timestamp: entry.timestamp.toISOString(),
  } satisfies SerializedAuditEntry);

const deserializeEntry = (line: string): AuditEntry | undefined => {
  try {
    const raw = JSON.parse(line) as SerializedAuditEntry;
    return {
      ...raw,
      timestamp: new Date(raw.timestamp),
    };
  } catch {
    return undefined;
  }
};

const matchesFilter = (entry: AuditEntry, filter: AuditFilter): boolean => {
  if (filter.traceId && entry.traceId !== filter.traceId) return false;
  if (filter.userId && entry.userId !== filter.userId) return false;
  if (filter.capabilityName && entry.capabilityName !== filter.capabilityName) return false;
  return true;
};

/**
 * JSONL ファイルへ追記する `AuditStorage` を生成する。
 * 1 行 1 エントリ。プロセス再起動後も監査ログを保持できる。
 *
 * @param filePath - 追記先ファイルパス（親ディレクトリが無ければ作成する）
 */
export const createJsonlAuditStorage = (filePath: string): AuditStorage => {
  const ensureParent = async (): Promise<void> => {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
  };

  return {
    async append(entry: AuditEntry): Promise<void> {
      await ensureParent();
      await appendFile(filePath, `${serializeEntry(entry)}\n`, 'utf8');
    },
    async query(filter: AuditFilter): Promise<AuditEntry[]> {
      let raw: string;
      try {
        raw = await readFile(filePath, 'utf8');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return [];
        throw err;
      }
      const entries: AuditEntry[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const entry = deserializeEntry(trimmed);
        if (entry && matchesFilter(entry, filter)) {
          entries.push(entry);
        }
      }
      return entries;
    },
  };
};
