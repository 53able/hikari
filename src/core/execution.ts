import { z } from 'zod';
import { runCapabilityPipeline } from './capability-pipeline.js';
import type { AuditLogger } from './audit.js';
import type { CapabilityRuntime } from './capability.js';
import type { ApprovalGate } from './approval.js';
import type { Registry } from './registry.js';
import type { HarnessTracer } from './harness-trace.js';
import type { IdempotencyStore } from './idempotency-store.js';

/** エンジン呼び出し時に呼び出し元が渡すオプションの Zod スキーマ。 */
export const executionOptionsSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().optional(),
  traceId: z.string().optional(),
  intent: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  /** 同一キー・同一入力の再実行時にキャッシュ結果を返す（TTL 内）。 */
  idempotencyKey: z.string().min(1).max(256).optional(),
});

/** エンジン呼び出し時に呼び出し元が渡すオプション。 */
export type ExecutionOptions = z.infer<typeof executionOptionsSchema>;

/** `permissions` を常に配列にした実行オプション（Hono Variables 等で利用）。 */
export type NormalizedExecutionOptions = ExecutionOptions & {
  readonly permissions: readonly string[];
};

/**
 * 省略可能な `permissions` を空配列に正規化する。
 * @param options - 生の実行オプション。
 */
export const normalizeExecutionOptions = (
  options: ExecutionOptions,
): NormalizedExecutionOptions => ({
  ...options,
  permissions: options.permissions ?? [],
});

/** `Engine.execute` が成功時に返す結果オブジェクト。 */
export interface ExecutionResult<T = unknown> {
  success: true;
  /** Zod バリデーション後の型安全なハンドラー出力。 */
  output: T;
  /** この呼び出しの全監査エントリが共有するトレースID。 */
  traceId: string;
}

/** `Engine.execute` でレジストリに存在しないケイパビリティ名が指定されたときにスローされる。HTTPアダプターは HTTP 404 にマップする。 */
export class CapabilityNotFoundError extends Error {
  constructor(name: string) {
    super(`Capability '${name}' not found in registry`);
    this.name = 'CapabilityNotFoundError';
  }
}

/**
 * 同一 `idempotencyKey` が別ケイパビリティまたは別入力で再利用されたときにスローされる。
 * HTTP アダプターは HTTP 409 にマップする。
 */
export class IdempotencyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(
      `Idempotency key '${idempotencyKey}' was already used with a different capability or input`,
    );
    this.name = 'IdempotencyConflictError';
  }
}

/**
 * `write` / `financial` 副作用のケイパビリティで `idempotencyKey` が欠落しているときにスローされる。
 * HTTP アダプターは HTTP 400 にマップする。
 */
export class IdempotencyRequiredError extends Error {
  constructor(capabilityName: string) {
    super(
      `Capability '${capabilityName}' requires an Idempotency-Key for write or financial operations`,
    );
    this.name = 'IdempotencyRequiredError';
  }
}

/** 入力または出力の Zod バリデーション失敗時にスローされる。HTTPアダプターは HTTP 400 にマップする。 */
export class ValidationError extends Error {
  constructor(
    /** フィールドパスとメッセージを含む Zod のバリデーションエラー詳細。 */
    public readonly issues: { message: string; path: (string | number)[] }[],
    /** バリデーションに失敗したケイパビリティ名。 */
    capabilityName: string,
    /** 失敗した段階。省略時は `input`。 */
    public readonly phase: 'input' | 'output' = 'input',
  ) {
    super(
      phase === 'output'
        ? `Output validation failed for '${capabilityName}'`
        : `Input validation failed for '${capabilityName}'`,
    );
    this.name = 'ValidationError';
  }
}

/**
 * ケイパビリティ実行エンジン。
 * 入力バリデーション→ポリシーチェック→承認ゲート→ハンドラー実行→監査記録を1回の `execute` 呼び出しで処理する。
 */
export type Engine = {
  /**
   * 名前でケイパビリティを実行する。
   * @param capabilityName - 登録済みケイパビリティの `name` と一致する必要がある。
   * @param input - 未検証の生入力。エンジンがケイパビリティの `inputSchema` でパースする。
   * @param options - 呼び出し元の識別情報と権限。
   * @throws {CapabilityNotFoundError} `capabilityName` が登録されていない場合。
   * @throws {ValidationError} `input` がケイパビリティの Zod スキーマに不適合な場合。
   * @throws {PolicyViolationError} 呼び出し元が必要な権限を持っていない場合。
   * @throws {ApprovalDeniedError} 承認ゲートがリクエストを拒否した場合。
   */
  readonly execute: <T = unknown>(
    capabilityName: string,
    input: unknown,
    options: ExecutionOptions,
  ) => Promise<ExecutionResult<T>>;
};

/** harness 監査の記録範囲。`tool-only` は Pi harness 層と併用する。 */
export type HarnessMode = 'full' | 'tool-only';

type EngineConfig = {
  registry: Registry;
  auditLog: AuditLogger;
  approvalGate?: ApprovalGate;
  idempotencyStore?: IdempotencyStore;
  /** ハンドラーに渡す決定論的ランタイム依存。 */
  runtime?: CapabilityRuntime;
  /** 指定時は `execute` 内で harness 監査イベントを記録する。 */
  harness?: HarnessTracer;
  /**
   * harness 記録モード。`full` は intent / plan / tool すべて。`tool-only` は `tool_selected` のみ。
   * @defaultValue `'full'`
   */
  harnessMode?: HarnessMode;
};

/**
 * ケイパビリティ実行エンジンを生成する。
 *
 * @param config.registry - ケイパビリティ定義のソース。
 * @param config.auditLog - 各ライフサイクルステップで監査イベントを受け取る。
 * @param config.approvalGate - `requiresApproval: true` のケイパビリティが存在する場合に必須。
 */
export function createEngine(config: EngineConfig): Engine {
  return {
    execute: <T>(name: string, input: unknown, options: ExecutionOptions) =>
      runCapabilityPipeline<T>(name, input, options, config),
  };
}
