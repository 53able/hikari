import type { ZodTypeAny } from 'zod';
import type { Capability } from './capability.js';
import { isExposedToLlm } from './policy.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCapability = Capability<any, any>;

/**
 * ケイパビリティ定義を保持するフルーエントなコンテナ。
 *
 * 実行エンジン・HTTP アダプター・Claude アダプター・CLI ツールが共有する単一の定義源として機能する。
 * 全アダプターが同じレジストリインスタンスを参照するため、ケイパビリティは一度定義するだけでどこからでも利用できる。
 */
export type Registry = {
  /**
   * ケイパビリティを登録しメソッドチェーン用に `this` を返す。
   * @throws 同名のケイパビリティがすでに登録されている場合。
   */
  readonly register: <TI extends ZodTypeAny, TO extends ZodTypeAny>(
    cap: Capability<TI, TO>,
  ) => Registry;
  /** 名前でケイパビリティを検索する。見つからない場合は `undefined` を返す。 */
  readonly get: (name: string) => AnyCapability | undefined;
  /** 登録済みの全ケイパビリティを登録順で返す。 */
  readonly getAll: () => AnyCapability[];
  /** LLM ツール定義用（`exposeToLlm: false` を除く）。 */
  readonly listForLlm: () => AnyCapability[];
  /** 登録済みのケイパビリティ名をすべて登録順で返す。 */
  readonly list: () => string[];
};

/**
 * 空のケイパビリティレジストリを生成する。
 *
 * @example
 * ```ts
 * const registry = createRegistry()
 *   .register(listBooks)
 *   .register(purchaseBook);
 * ```
 */
export function createRegistry(): Registry {
  const store = new Map<string, AnyCapability>();

  const self: Registry = {
    register(cap) {
      if (store.has(cap.name)) {
        throw new Error(`Capability '${cap.name}' is already registered`);
      }
      store.set(cap.name, cap as AnyCapability);
      return self;
    },
    get: (name) => store.get(name),
    getAll: () => [...store.values()],
    listForLlm: () => [...store.values()].filter((cap) => isExposedToLlm(cap.policy)),
    list: () => [...store.keys()],
  };

  return self;
}
