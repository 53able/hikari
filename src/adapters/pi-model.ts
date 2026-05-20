import { getEnvApiKey, getModel, type KnownProvider, type Model, type Api } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { loadPrompt, PromptNotFoundError } from '../agent/load-prompt.js';

const DEFAULT_PI_PROVIDER = 'anthropic' as const;
const DEFAULT_PI_MODEL_ID = 'claude-sonnet-4-6';

const piProviderSchema = z.string().min(1);

/** `resolvePiModelFromEnv` の戻り値。 */
export type ResolvedPiModel = {
  readonly provider: KnownProvider;
  readonly modelId: string;
  readonly model: Model<Api>;
};

/**
 * 環境変数から Pi 用プロバイダとモデルを解決する。
 *
 * - `HIKARI_PI_PROVIDER` — 省略時 `anthropic`
 * - `HIKARI_PI_MODEL` — 省略時 `claude-sonnet-4-6`
 */
export const resolvePiModelFromEnv = (
  overrides: { readonly provider?: string; readonly modelId?: string } = {},
): ResolvedPiModel => {
  const providerRaw =
    overrides.provider ?? process.env.HIKARI_PI_PROVIDER?.trim() ?? DEFAULT_PI_PROVIDER;
  const modelId = overrides.modelId ?? process.env.HIKARI_PI_MODEL?.trim() ?? DEFAULT_PI_MODEL_ID;
  const providerParsed = piProviderSchema.safeParse(providerRaw);
  if (!providerParsed.success) {
    throw new Error(`Invalid HIKARI_PI_PROVIDER="${providerRaw}"`);
  }
  const provider = providerParsed.data as KnownProvider;
  const model = getModel(provider, modelId as never);
  return { provider, modelId, model };
};

/**
 * Pi Agent 向け API キー解決。`getEnvApiKey` を優先し、Anthropic では `ANTHROPIC_API_KEY` にフォールバックする。
 */
export const resolvePiGetApiKey = (
  explicitApiKey?: string,
): ((provider: string) => string | undefined) => {
  const trimmedExplicit =
    typeof explicitApiKey === 'string' && explicitApiKey.trim().length > 0
      ? explicitApiKey.trim()
      : undefined;
  return (provider: string) => {
    const fromEnv = getEnvApiKey(provider);
    if (fromEnv) return fromEnv;
    if (trimmedExplicit && provider === 'anthropic') return trimmedExplicit;
    if (provider === 'anthropic') {
      const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
      return anthropic && anthropic.length > 0 ? anthropic : undefined;
    }
    return undefined;
  };
};

/**
 * システムプロンプト名を環境変数から解決する。`HIKARI_AGENT_PROMPT` が無効な場合は `default-agent`。
 */
export const resolveAgentPromptFromEnv = (explicit?: string): string => {
  const name = explicit ?? process.env.HIKARI_AGENT_PROMPT?.trim() ?? 'default-agent';
  try {
    return loadPrompt(name);
  } catch (err) {
    if (err instanceof PromptNotFoundError && name !== 'default-agent') {
      return loadPrompt('default-agent');
    }
    throw err;
  }
};
