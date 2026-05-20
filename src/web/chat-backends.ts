import type { ClaudeAdapter } from '../adapters/claude.js';
import type { OpenAiAdapter } from '../adapters/openai.js';
import type { HikariAgentOptions, HikariHarness } from '../adapters/pi.js';
import { streamPiAgentTurn } from '../adapters/pi-turn.js';
import type { Engine } from '../core/execution.js';
import type { Registry } from '../core/registry.js';
import type { ExecutionOptions } from '../core/execution.js';
import type { ApprovalRequest } from '../core/approval.js';
import { createLlmChatBackend } from './llm-chat-backend.js';
import type { ChatBackend, ChatStreamEvent } from './chat-stream.js';

/**
 * `ClaudeAdapter` を `ChatBackend` としてラップする。
 */
export const backendFromClaude = (adapter: ClaudeAdapter): ChatBackend =>
  createLlmChatBackend((messages, options) => adapter.chat([...messages], options));

/**
 * `OpenAiAdapter` を `ChatBackend` としてラップする。
 */
export const backendFromOpenAi = (adapter: OpenAiAdapter): ChatBackend =>
  createLlmChatBackend((messages, options) => adapter.chat([...messages], options));

/** `backendFromPiAgent` の依存関係。リクエストごとに Agent を生成しコンテキスト漏洩を防ぐ。 */
export interface PiChatBackendDeps {
  readonly registry: Registry;
  readonly engine: Engine;
  /**
   * `createHikariHarness` の戻り値。指定時は intent / plan をチャットターン単位で記録し、
   * engine は `tool-only` harness モードで動作する。
   */
  readonly harnessApi?: HikariHarness;
  readonly agentOptions?: HikariAgentOptions;
  /**
   * ストリーム単位で承認待ち通知を登録する。
   * @returns ストリーム終了時に呼ぶ解除関数。
   */
  readonly onRegisterApprovalNotifier?: (
    traceId: string,
    notify: (req: ApprovalRequest) => void,
  ) => (() => void) | void;
}

/**
 * Pi harness + Hikari エンジンから `ChatBackend` を生成する。
 * 各ストリームで `runPiAgentTurn` により専用 Agent を起動する。
 */
export const backendFromPiAgent = (deps: PiChatBackendDeps): ChatBackend => ({
  stream(message, history, options) {
    const harness = deps.harnessApi?.harness;
    const engine = deps.harnessApi?.engine ?? deps.engine;

    return streamPiAgentTurn({
      registry: deps.registry,
      engine,
      message,
      context: options,
      history,
      harness,
      agentOptions: deps.agentOptions,
      onRegisterApprovalNotifier: deps.onRegisterApprovalNotifier,
    });
  },
});
