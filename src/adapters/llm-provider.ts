import { z } from 'zod';
import type { ChatOptions, ChatResult } from './claude.js';
import { createClaudeAdapter } from './claude.js';
import { createOpenAiAdapter } from './openai.js';
import type { Engine } from '../core/execution.js';
import type { Registry } from '../core/registry.js';
import {
  backendFromClaude,
  backendFromOpenAi,
  backendFromPiAgent,
  type PiChatBackendDeps,
} from '../web/chat-backends.js';
import type { ChatBackend } from '../web/chat-stream.js';

/** チャット API 向け `LLM_PROVIDER` の許容値。 */
export const chatLlmProviderSchema = z.enum(['anthropic', 'openai', 'auto']);

/** `hikari serve` 向け `LLM_PROVIDER` の許容値。 */
export const serveLlmProviderSchema = z.enum(['pi', 'anthropic', 'openai', 'auto']);

/** 解決済みチャット LLM プロバイダ（`auto` は解決後に消える）。 */
export type ResolvedChatLlmProvider = 'anthropic' | 'openai';

/** 解決済み serve バックエンドのプロバイダ。 */
export type ResolvedServeLlmProvider = 'pi' | 'anthropic' | 'openai';

/** 単純なテキスト会話メッセージ。 */
export type LlmChatMessage = {
  readonly role: 'user' | 'assistant';
  readonly content: string;
};

/** 環境変数から解決した LLM チャットクライアント。 */
export type LlmChatClient = {
  readonly provider: ResolvedChatLlmProvider;
  readonly chat: (
    messages: readonly LlmChatMessage[],
    options: ChatOptions,
  ) => Promise<ChatResult>;
};

const missingChatKeyMessage =
  'Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY to enable LLM chat. ' +
  'Optional LLM_PROVIDER=anthropic|openai|auto (default auto: single key, or anthropic when both are set).';

/** API キー未設定時にチャット API が返す説明文。 */
export const missingLlmApiKeyMessage = missingChatKeyMessage;

const hasNonEmptyKey = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const parseChatLlmProviderEnv = (): z.infer<typeof chatLlmProviderSchema> => {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (!raw || raw === 'pi') {
    return 'auto';
  }
  const parsed = chatLlmProviderSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid LLM_PROVIDER="${process.env.LLM_PROVIDER}". Use anthropic, openai, or auto for chat APIs.`,
    );
  }
  return parsed.data;
};

const parseServeLlmProviderEnv = (): z.infer<typeof serveLlmProviderSchema> => {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (!raw) {
    return 'pi';
  }
  const parsed = serveLlmProviderSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid LLM_PROVIDER="${process.env.LLM_PROVIDER}". Use pi, anthropic, openai, or auto.`,
    );
  }
  return parsed.data;
};

const wrapClaude = (
  registry: Registry,
  engine: Engine,
  apiKey: string,
): LlmChatClient => {
  const adapter = createClaudeAdapter(registry, engine, apiKey);
  return {
    provider: 'anthropic',
    chat: (messages, options) =>
      adapter.chat(
        messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        options,
      ),
  };
};

const wrapOpenAi = (
  registry: Registry,
  engine: Engine,
  apiKey: string,
): LlmChatClient => {
  const adapter = createOpenAiAdapter(registry, engine, apiKey);
  return {
    provider: 'openai',
    chat: (messages, options) => adapter.chat(messages, options),
  };
};

/**
 * 環境変数から LLM チャットクライアントを解決する（REST チャット API 向け）。
 *
 * - `LLM_PROVIDER=anthropic` → `ANTHROPIC_API_KEY` 必須
 * - `LLM_PROVIDER=openai` → `OPENAI_API_KEY` 必須
 * - `LLM_PROVIDER=auto` または未設定 → 設定されているキーから選択（両方ある場合は anthropic）
 */
export const resolveLlmFromEnv = (
  registry: Registry,
  engine: Engine,
): LlmChatClient | undefined => {
  const mode = parseChatLlmProviderEnv();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const hasAnthropic = hasNonEmptyKey(anthropicKey);
  const hasOpenai = hasNonEmptyKey(openaiKey);

  if (mode === 'anthropic') {
    return hasAnthropic ? wrapClaude(registry, engine, anthropicKey) : undefined;
  }
  if (mode === 'openai') {
    return hasOpenai ? wrapOpenAi(registry, engine, openaiKey) : undefined;
  }

  if (hasAnthropic) {
    return wrapClaude(registry, engine, anthropicKey);
  }
  if (hasOpenai) {
    return wrapOpenAi(registry, engine, openaiKey);
  }
  return undefined;
};

/** `resolveServeChatBackend` の依存関係。 */
export type ServeChatBackendDeps = PiChatBackendDeps;

/** `resolveServeChatBackend` の戻り値。 */
export type ResolvedServeChatBackend = {
  readonly backend: ChatBackend;
  readonly provider: ResolvedServeLlmProvider;
};

/**
 * `hikari serve` 用の `ChatBackend` を環境変数から解決する。
 *
 * - `LLM_PROVIDER=pi`（既定）→ Pi harness + Hikari エンジン
 * - `LLM_PROVIDER=anthropic` → `createClaudeAdapter`
 * - `LLM_PROVIDER=openai` → `createOpenAiAdapter`
 * - `LLM_PROVIDER=auto` → Anthropic キーがあれば Pi、なければ OpenAI
 */
export const resolveServeChatBackend = (
  deps: ServeChatBackendDeps,
): ResolvedServeChatBackend => {
  const mode = parseServeLlmProviderEnv();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const hasAnthropic = hasNonEmptyKey(anthropicKey);
  const hasOpenai = hasNonEmptyKey(openaiKey);

  const piBackend = (): ResolvedServeChatBackend => ({
    backend: backendFromPiAgent(deps),
    provider: 'pi',
  });

  if (mode === 'pi') {
    return piBackend();
  }
  if (mode === 'anthropic') {
    if (!hasAnthropic) {
      throw new Error('LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY.');
    }
    return {
      backend: backendFromClaude(createClaudeAdapter(deps.registry, deps.engine, anthropicKey)),
      provider: 'anthropic',
    };
  }
  if (mode === 'openai') {
    if (!hasOpenai) {
      throw new Error('LLM_PROVIDER=openai requires OPENAI_API_KEY.');
    }
    return {
      backend: backendFromOpenAi(createOpenAiAdapter(deps.registry, deps.engine, openaiKey)),
      provider: 'openai',
    };
  }

  if (hasAnthropic) {
    return piBackend();
  }
  if (hasOpenai) {
    return {
      backend: backendFromOpenAi(createOpenAiAdapter(deps.registry, deps.engine, openaiKey)),
      provider: 'openai',
    };
  }
  return piBackend();
};
