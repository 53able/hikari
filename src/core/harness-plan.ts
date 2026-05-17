import type { Registry } from './registry.js';

/** `buildHarnessPlan` のオプション。 */
export type HarnessPlanOptions = {
  /** プラン文の先頭句。省略時は汎用メッセージ。 */
  prefix?: string;
};

/**
 * レジストリに登録されたケイパビリティ名から harness 用の動的プラン文字列を組み立てる。
 */
export const buildHarnessPlan = (
  registry: Registry,
  options: HarnessPlanOptions = {},
): string => {
  const names = registry.getAll().map((cap) => cap.name).sort();
  const prefix =
    options.prefix ?? 'Interpret user message, select capabilities, execute via Hikari engine';
  if (names.length === 0) return prefix;
  return `${prefix}: ${names.join(', ')}`;
};
