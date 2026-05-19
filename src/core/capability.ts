import type { ZodTypeAny, z } from 'zod';

/** ケイパビリティが持つ副作用の種類。承認・監査レベルの自動判定に使われる。 */
export type SideEffectType = 'read' | 'write' | 'financial' | 'irreversible' | 'external';

/** 入力値に応じて承認要否を判定する述語。Zod パース後の入力が渡される。 */
export type ApprovalPredicate<T = unknown> = (input: T) => boolean;

/**
 * ケイパビリティハンドラーに注入する決定論的ランタイム。
 * `createEngine({ runtime })` で登録し、handler から `context.runtime` 経由で参照する。
 */
export type CapabilityRuntime = Readonly<Record<string, unknown>>;

/** 実行エンジンがケイパビリティを扱う方針を定義する。権限要件・副作用・承認要否・監査詳細度を含む。 */
export interface Policy {
  /** 呼び出し元が保持すべき権限文字列のリスト。`ExecutionContext.permissions` と照合される。 */
  requiredPermissions: string[];
  /** ケイパビリティが生じさせる可能性のある副作用。`financial` と `irreversible` は自動的に human approval を要求する。 */
  sideEffects: SideEffectType[];
  /** 承認要否の明示的な上書き。`sideEffects` に `financial` または `irreversible` が含まれる場合は自動で `true` になる。 */
  requiresApproval?: boolean;
  /**
   * 入力に応じた条件付き承認（記事の `requiresApprovalWhen` に相当）。
   * バリデーション済み入力で `true` を返した場合、human approval が必要になる。
   */
  requiresApprovalWhen?: ApprovalPredicate;
  /** 監査ログへの記録詳細度。`none`: 記録なし、`basic`: イベントのみ、`full`: 入出力ペイロードを含む。 */
  auditLevel: 'none' | 'basic' | 'full';
}

/** ケイパビリティハンドラーに注入されるランタイムコンテキスト。エンジンが `ExecutionOptions` から生成する。 */
export interface ExecutionContext {
  /** 認証済みユーザーの識別子。 */
  userId: string;
  /** この呼び出しが属するセッションID。 */
  sessionId: string;
  /** 単一の呼び出しに属するすべての監査エントリを束ねる UUID。 */
  traceId: string;
  /** 呼び出し理由を示す人間可読の文字列。監査ログに保存される。 */
  intent?: string;
  /** この実行で呼び出し元に付与されている権限セット。 */
  permissions: Set<string>;
  /** ハンドラーが副作用を実行するための決定論的依存（DB クライアント等）。 */
  runtime: CapabilityRuntime;
}

/**
 * Hikari の AI ネイティブアプリケーション層の基本単位。
 *
 * 入力スキーマ（Zod）・出力スキーマ・ポリシー・ハンドラーを 1 つのオブジェクトにまとめる。
 * HTTP レイヤーと LLM ツール定義の両方で同じ定義を共有する。
 */
export interface Capability<
  TInput extends ZodTypeAny = ZodTypeAny,
  TOutput extends ZodTypeAny = ZodTypeAny,
> {
  /** レジストリ内で一意のキー。規約: 小文字スネークケース（例: `list_books`）。 */
  name: string;
  /** LLM ツール定義にそのまま渡される人間可読の説明文。 */
  description: string;
  /** ハンドラー呼び出し前に入力値のバリデーションと型変換に使われる Zod スキーマ。 */
  inputSchema: TInput;
  /** ハンドラーの戻り値の型を定義する Zod スキーマ。 */
  outputSchema: TOutput;
  /** このケイパビリティの権限・副作用・承認・監査レベルを定義するポリシー。 */
  policy: Policy;
  /** ケイパビリティを実装する純粋な非同期関数。バリデーション済み入力とランタイムコンテキストを受け取る。 */
  handler: (
    input: z.infer<TInput>,
    context: ExecutionContext,
  ) => Promise<z.infer<TOutput>>;
}

/**
 * ケイパビリティ定義に完全な TypeScript 型推論を付与するアイデンティティ関数。
 *
 * `defineCapability({...})` でラップすることで、明示的なジェネリック引数なしに
 * Zod スキーマから `TInput` と `TOutput` が推論される。
 *
 * @param definition - ケイパビリティの定義オブジェクト。
 * @returns 推論されたジェネリック型付きの同一オブジェクト。
 *
 * @example
 * ```ts
 * export const getBook = defineCapability({
 *   name: 'get_book',
 *   description: '書籍IDで詳細を取得する',
 *   inputSchema: z.object({ id: z.string() }),
 *   outputSchema: BookSchema,
 *   policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
 *   async handler({ id }) { ... },
 * });
 * ```
 */
export function defineCapability<
  TInput extends ZodTypeAny,
  TOutput extends ZodTypeAny,
>(definition: Capability<TInput, TOutput>): Capability<TInput, TOutput> {
  return definition;
}

/** `defineCapability` のエイリアス。記事の `capability()` DSL 命名に合わせる。 */
export const capability = defineCapability;
