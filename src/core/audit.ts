import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from './capability.js';

/** エンジンがケイパビリティのライフサイクル中に記録するイベント種別。同じ `traceId` で1回の呼び出し全体を表す。 */
export type AuditEventType =
  | 'capability_invoked'
  | 'policy_denied'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'execution_succeeded'
  | 'execution_failed';

/** 単一の不変な監査レコード。`traceId` でクエリすると1回の呼び出しの完全な履歴を再構築できる。 */
export interface AuditEntry {
  /** エントリの一意ID（UUID）。 */
  id: string;
  /** ライフサイクルイベントの種別。 */
  type: AuditEventType;
  /** 単一のケイパビリティ呼び出しに属する全エントリを束ねる相関ID。 */
  traceId: string;
  /** このエントリが属するケイパビリティ名。 */
  capabilityName: string;
  /** 呼び出しをトリガーしたユーザー。 */
  userId: string;
  /** 呼び出しのセッションコンテキスト。 */
  sessionId: string;
  /** `ExecutionOptions` から渡された任意の意図文字列。 */
  intent?: string;
  /** 入力ペイロード（`auditLevel` が `full` のとき存在）。 */
  input?: unknown;
  /** ハンドラーの出力（`execution_succeeded` かつ `auditLevel` が `full` のとき存在）。 */
  output?: unknown;
  /** エラーメッセージ（失敗系イベントのとき存在）。 */
  error?: string;
  /** このエントリが記録された日時。 */
  timestamp: Date;
  /** エンジンが付加する追加データ（例: `riskLevel`, `approvedBy`）。 */
  metadata?: Record<string, unknown>;
}

type AuditFilter = Partial<Pick<AuditEntry, 'traceId' | 'userId' | 'capabilityName'>>;

/**
 * 監査エントリの永続化レイヤー。
 * このインターフェースを実装して、DB・メッセージキュー・ログサービスなど任意のバックエンドに保存できる。
 */
export type AuditStorage = {
  /** 新しい監査エントリを永続化する。 */
  readonly append: (entry: AuditEntry) => Promise<void>;
  /** 指定フィルターに一致するエントリを取得する。空フィルターは全件を返す。 */
  readonly query: (filter: AuditFilter) => Promise<AuditEntry[]>;
};

/** `getAll()` で全エントリを直接取得できる、テスト・デモ向けのインメモリ `AuditStorage`。 */
export type InMemoryStorage = AuditStorage & {
  /** 挿入順で全エントリのスナップショットを返す。 */
  readonly getAll: () => AuditEntry[];
};

/**
 * 揮発性のインメモリ監査ストレージを生成する。
 * 開発・テスト・短期デモ向け。プロセス再起動後はデータが失われる。
 */
export function createInMemoryStorage(): InMemoryStorage {
  const entries: AuditEntry[] = [];
  return {
    async append(entry) {
      entries.push(entry);
    },
    async query(filter) {
      return entries.filter((e) => {
        if (filter.traceId && e.traceId !== filter.traceId) return false;
        if (filter.userId && e.userId !== filter.userId) return false;
        if (filter.capabilityName && e.capabilityName !== filter.capabilityName) return false;
        return true;
      });
    },
    getAll: () => [...entries],
  };
}

/**
 * 実行エンジンが使用する高レベルな監査ロガー。
 * コンテキストフィールドを `AuditEntry` に組み立てて `AuditStorage` に委譲する。
 */
export type AuditLogger = {
  /** ケイパビリティ呼び出しのライフサイクルイベントを記録する。 */
  readonly record: (
    type: AuditEventType,
    capabilityName: string,
    context: ExecutionContext,
    data?: Pick<AuditEntry, 'input' | 'output' | 'error' | 'metadata'>,
  ) => Promise<void>;
  /** `AuditStorage` と同じフィルターインターフェースで監査エントリをクエリする。 */
  readonly query: (filter: AuditFilter) => Promise<AuditEntry[]>;
};

function generateId(): string {
  return randomUUID();
}

/**
 * 指定ストレージをバックエンドとした `AuditLogger` を生成する。
 *
 * @param storage - 監査エントリの保存先。開発時は `createInMemoryStorage()` を使用する。
 */
export function createAuditLog(storage: AuditStorage): AuditLogger {
  return {
    async record(type, capabilityName, context, data) {
      await storage.append({
        id: generateId(),
        type,
        traceId: context.traceId,
        capabilityName,
        userId: context.userId,
        sessionId: context.sessionId,
        intent: context.intent,
        timestamp: new Date(),
        ...data,
      });
    },
    query: (filter) => storage.query(filter),
  };
}
