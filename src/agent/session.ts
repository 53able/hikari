import { randomUUID } from 'node:crypto';

/** セッションに蓄積される単一のメッセージ。 */
export interface SessionMessage {
  /** メッセージの送信元ロール。 */
  role: 'user' | 'assistant' | 'system';
  /** メッセージ本文。 */
  content: string;
  /** メッセージが記録された日時。 */
  timestamp: Date;
  /** このメッセージに関連するケイパビリティ呼び出しのトレースID一覧（省略可）。 */
  traceIds?: string[];
}

/** 特定ユーザーのインメモリ会話セッション。 */
export interface Session {
  /** セッションの一意ID（UUID）。 */
  id: string;
  /** このセッションを所有するユーザーの識別子。 */
  userId: string;
  /** セッションが生成された日時。 */
  createdAt: Date;
  /** 最後にメッセージが追加された日時。TTL 判定に使用される。 */
  updatedAt: Date;
  /** 蓄積されたメッセージ履歴。`maxMessagesPerSession` を超えると古いものから削除される。 */
  messages: SessionMessage[];
  /** セッションに付加できる任意のメタデータ。 */
  metadata: Record<string, unknown>;
}

/** `createSessionManager` の設定オプション。 */
export interface SessionManagerOptions {
  /** セッションあたりの最大メッセージ数。超過すると古いメッセージから削除される。デフォルト: `200`。 */
  maxMessagesPerSession?: number;
  /** アイドル TTL（ミリ秒）。この期間内に更新されなかったセッションは sweep 対象になる。デフォルト: 30分。 */
  idleTtlMs?: number;
  /** テストで時刻を制御するための注入可能なクロック関数。デフォルト: `() => new Date()`。 */
  now?: () => Date;
}

/** インメモリ会話セッションを管理するファクトリが返すオブジェクト型。 */
export type SessionManager = {
  /** 新しいセッションを作成して返す。 */
  readonly createSession: (userId: string, metadata?: Record<string, unknown>) => Session;
  /** IDでセッションを取得する。アイドル TTL を超えている場合は `undefined` を返す。 */
  readonly getSession: (id: string) => Session | undefined;
  /**
   * セッションにメッセージを追加する。
   * @throws セッションが存在しない、またはTTL超過で削除済みの場合。
   */
  readonly appendMessage: (id: string, msg: Omit<SessionMessage, 'timestamp'> & { timestamp?: Date }) => Session;
  /** セッションの全メッセージを返す（読み取り専用）。 */
  readonly getMessages: (id: string) => readonly SessionMessage[];
  /** 指定ユーザーの全アクティブセッションを返す。 */
  readonly listUserSessions: (userId: string) => Session[];
  /** IDでセッションを削除する。削除できた場合は `true` を返す。 */
  readonly deleteSession: (id: string) => boolean;
  /** TTL を超えてアイドル状態のセッションをすべて削除し、削除件数を返す。 */
  readonly sweepIdle: () => number;
};

/**
 * インメモリセッションマネージャーを生成する。
 *
 * @param options - TTL・最大メッセージ数・クロック関数などの設定。
 */
export function createSessionManager(options?: SessionManagerOptions): SessionManager {
  const maxMessages = options?.maxMessagesPerSession ?? 200;
  const idleTtl = options?.idleTtlMs ?? 30 * 60 * 1000;
  const now = options?.now ?? (() => new Date());

  const sessions = new Map<string, Session>();

  const sweep = (): number => {
    const cutoff = now().getTime() - idleTtl;
    let removed = 0;
    for (const [id, session] of sessions) {
      if (session.updatedAt.getTime() < cutoff) {
        sessions.delete(id);
        removed++;
      }
    }
    return removed;
  };

  const getOrThrow = (id: string): Session => {
    sweep();
    const session = sessions.get(id);
    if (!session) throw new Error(`Session '${id}' not found`);
    return session;
  };

  return {
    createSession(userId, metadata = {}) {
      const ts = now();
      const session: Session = {
        id: randomUUID(),
        userId,
        createdAt: ts,
        updatedAt: ts,
        messages: [],
        metadata,
      };
      sessions.set(session.id, session);
      return session;
    },

    getSession(id) {
      sweep();
      return sessions.get(id);
    },

    appendMessage(id, msg) {
      const session = getOrThrow(id);
      const message: SessionMessage = { ...msg, timestamp: msg.timestamp ?? now() };
      session.messages.push(message);
      if (session.messages.length > maxMessages) {
        session.messages.splice(0, session.messages.length - maxMessages);
      }
      session.updatedAt = now();
      return session;
    },

    getMessages(id) {
      return getOrThrow(id).messages;
    },

    listUserSessions(userId) {
      sweep();
      return Array.from(sessions.values()).filter((s) => s.userId === userId);
    },

    deleteSession(id) {
      return sessions.delete(id);
    },

    sweepIdle: sweep,
  };
}
