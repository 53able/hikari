import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const promptNameSchema = z.string().regex(/^[a-z0-9-]+$/);

const promptsDir = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

/** 同梱プロンプトファイルが見つからないときにスローされる。 */
export class PromptNotFoundError extends Error {
  constructor(name: string) {
    super(`Prompt '${name}' not found`);
    this.name = 'PromptNotFoundError';
  }
}

/**
 * `src/prompts/{name}.md`（ビルド後は `dist/prompts/{name}.md`）を読み込む。
 *
 * @param name - 小文字英数字とハイフンのみ（例: `default-agent`）。
 * @returns 末尾改行を正規化したプロンプト本文。
 * @throws {PromptNotFoundError} 名前が不正、またはファイルが存在しない場合。
 */
export const loadPrompt = (name: string): string => {
  const parsed = promptNameSchema.safeParse(name);
  if (!parsed.success) {
    throw new PromptNotFoundError(name);
  }
  const path = join(promptsDir(), `${parsed.data}.md`);
  try {
    const raw = readFileSync(path, 'utf8');
    return `${raw.replace(/\s+$/, '')}\n`;
  } catch {
    throw new PromptNotFoundError(name);
  }
};
