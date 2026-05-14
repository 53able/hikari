import type { AuditStorage, AuditEntry } from '../core/audit.js';
import { renderTraceHtml } from './trace-html.js';

/** 監査イベントから導出されるケイパビリティ呼び出しの終端状態。 */
export type TraceStatus = 'succeeded' | 'failed' | 'denied' | 'pending';

/** 単一の `traceId` に属する全監査イベントをまとめたビュー。 */
export interface TraceSpan {
  /** 全イベントを束ねる相関ID。 */
  traceId: string;
  /** 実行されたケイパビリティ名。 */
  capabilityName: string;
  /** 呼び出しをトリガーしたユーザーの識別子。 */
  userId: string;
  /** 呼び出しのセッションID。 */
  sessionId: string;
  /** 最初のイベントのタイムスタンプ（呼び出し開始日時）。 */
  startedAt: Date;
  /** 終端イベント（成功・失敗・拒否）のタイムスタンプ。実行中は `undefined`。 */
  endedAt?: Date;
  /** 呼び出しに要したミリ秒数。実行中は `undefined`。 */
  durationMs?: number;
  /** 監査イベントから導出した終端状態。 */
  status: TraceStatus;
  /** タイムスタンプ昇順でソートされた全監査イベント。 */
  events: AuditEntry[];
}

/** `TraceViewer.formatTrace` のオプション。 */
export interface FormatOptions {
  /** タイムスタンプ文字列の表示幅（文字数）。デフォルト: `12`。 */
  timestampWidth?: number;
  /** 入出力ペイロードを出力に含めるか。デフォルト: `true`。 */
  includePayload?: boolean;
  /** ANSI カラーコードを使用するか。デフォルト: TTY 接続時に `true`。 */
  color?: boolean;
}

/**
 * `AuditStorage` のイベントを `traceId` 単位でグループ化して `TraceSpan` として閲覧できる読み取り専用ビュー。
 */
export type TraceViewer = {
  /** 指定 `traceId` の `TraceSpan` を返す。存在しない場合は `undefined`。 */
  readonly getTrace: (traceId: string) => Promise<TraceSpan | undefined>;
  /** 全トレースを開始日時の新しい順で返す。`userId` や `capabilityName` でフィルタリング可能。 */
  readonly listTraces: (filter?: { userId?: string; capabilityName?: string }) => Promise<TraceSpan[]>;
  /** `TraceSpan` をターミナル表示向けのテキスト形式にフォーマットする。 */
  readonly formatTrace: (span: TraceSpan, options?: FormatOptions) => string;
  /** 複数の `TraceSpan` を静的 HTML ページとしてレンダリングする。 */
  readonly renderHtml: (spans: TraceSpan[]) => string;
};

function deriveStatus(events: AuditEntry[]): TraceStatus {
  for (const e of events) {
    if (e.type === 'execution_succeeded') return 'succeeded';
    if (e.type === 'execution_failed') return 'failed';
    if (e.type === 'policy_denied' || e.type === 'approval_denied') return 'denied';
  }
  return 'pending';
}

function buildSpan(traceId: string, entries: AuditEntry[]): TraceSpan {
  const sorted = [...entries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const first = sorted[0];
  const terminal = sorted.find((e) =>
    ['execution_succeeded', 'execution_failed', 'policy_denied', 'approval_denied'].includes(e.type),
  );
  const durationMs = terminal
    ? terminal.timestamp.getTime() - first.timestamp.getTime()
    : undefined;

  return {
    traceId,
    capabilityName: first?.capabilityName ?? '',
    userId: first?.userId ?? '',
    sessionId: first?.sessionId ?? '',
    startedAt: first?.timestamp ?? new Date(),
    endedAt: terminal?.timestamp,
    durationMs,
    status: deriveStatus(sorted),
    events: sorted,
  };
}

function groupByTrace(entries: AuditEntry[]): Map<string, AuditEntry[]> {
  const map = new Map<string, AuditEntry[]>();
  for (const entry of entries) {
    const list = map.get(entry.traceId) ?? [];
    list.push(entry);
    map.set(entry.traceId, list);
  }
  return map;
}

/**
 * 指定された監査ストレージをバックエンドとした `TraceViewer` を生成する。
 *
 * @param storage - `createAuditLog` に渡したのと同じストレージインスタンスを渡す。
 */
export function createTraceViewer(storage: AuditStorage): TraceViewer {

  return {
    async getTrace(traceId) {
      const entries = await storage.query({ traceId });
      if (entries.length === 0) return undefined;
      return buildSpan(traceId, entries);
    },

    async listTraces(filter) {
      const entries = await storage.query(filter ?? {});
      const grouped = groupByTrace(entries);
      const spans = Array.from(grouped.entries()).map(([id, evts]) => buildSpan(id, evts));
      return spans.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    },

    formatTrace(span, options = {}) {
      const tsWidth = options.timestampWidth ?? 12;
      const includePayload = options.includePayload ?? true;
      const useColor = options.color ?? process.stdout.isTTY;

      const statusColors: Record<TraceStatus, string> = {
        succeeded: '\x1b[32m',
        failed: '\x1b[31m',
        denied: '\x1b[33m',
        pending: '\x1b[90m',
      };
      const reset = '\x1b[0m';

      const colorize = (text: string, color: string): string =>
        useColor ? `${color}${text}${reset}` : text;

      const statusLabel = colorize(`●${span.status}`, statusColors[span.status]);
      const duration = span.durationMs !== undefined ? `  ${span.durationMs}ms` : '';
      let out = `[${span.traceId.slice(0, 8)}] ${span.capabilityName}  ${span.userId}  ${statusLabel}${duration}\n`;

      for (const evt of span.events) {
        const ts = evt.timestamp.toISOString().slice(11, 11 + tsWidth);
        const payload =
          includePayload && (evt.input !== undefined || evt.output !== undefined)
            ? `  ${evt.input !== undefined ? `input=${JSON.stringify(evt.input).slice(0, 80)}` : ''}${evt.output !== undefined ? ` output=${JSON.stringify(evt.output).slice(0, 80)}` : ''}`
            : '';
        out += `  ${evt.type.padEnd(28)}${ts}${payload}\n`;
      }
      return out;
    },

    renderHtml: renderTraceHtml,
  };
}
