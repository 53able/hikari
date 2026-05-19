import { randomUUID } from 'node:crypto';
import type { ClaudeAdapter } from '../adapters/claude.js';
import type { OpenAiAdapter, OpenAiChatMessage } from '../adapters/openai.js';
import {
  createHikariAgent,
  chatHistoryToAgentMessages,
  intentSnippetFromMessage,
  traceIdFromPiToolResult,
  type HikariAgentOptions,
  type HikariHarness,
} from '../adapters/pi.js';
import {
  buildHarnessPlanFromToolCalls,
  harnessPlanStepsMetadata,
  type HarnessPlanStep,
} from '../core/harness-plan.js';
import type { Engine } from '../core/execution.js';
import type { Registry } from '../core/registry.js';
import type { ExecutionOptions } from '../core/execution.js';
import type { ApprovalRequest } from '../core/approval.js';
import { createAsyncEventQueue } from '../core/async-queue.js';
import type { ChatBackend, ChatMessage, ChatStreamEvent } from './chat-stream.js';

/**
 * `ClaudeAdapter` を `ChatBackend` としてラップする。
 * 非ストリーミングの `chat()` を呼び出し、全テキストを単一の `text_delta` イベントとして emit する。
 */
export const backendFromClaude = (adapter: ClaudeAdapter): ChatBackend => ({
  stream(message, history, options) {
    return (async function* () {
      const messages = [
        ...history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: message },
      ];
      try {
        const result = await adapter.chat(messages, {
          userId: options.userId,
          sessionId: options.sessionId,
          traceId: options.traceId,
          intent: options.intent,
          permissions: options.permissions,
        });
        if (result.content) {
          yield { type: 'text_delta' as const, delta: result.content };
        }
        yield { type: 'done' as const, traceIds: result.traceIds };
      } catch (err) {
        yield {
          type: 'error' as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    })();
  },
});

/**
 * `OpenAiAdapter` を `ChatBackend` としてラップする。
 * 非ストリーミングの `chat()` を呼び出し、全テキストを単一の `text_delta` イベントとして emit する。
 */
export const backendFromOpenAi = (adapter: OpenAiAdapter): ChatBackend => ({
  stream(message, history, options) {
    return (async function* () {
      const messages: OpenAiChatMessage[] = [
        ...history.map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
        { role: 'user', content: message },
      ];
      try {
        const result = await adapter.chat(messages, {
          userId: options.userId,
          sessionId: options.sessionId,
          traceId: options.traceId,
          intent: options.intent,
          permissions: options.permissions,
        });
        if (result.content) {
          yield { type: 'text_delta' as const, delta: result.content };
        }
        yield { type: 'done' as const, traceIds: result.traceIds };
      } catch (err) {
        yield {
          type: 'error' as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    })();
  },
});

/** `backendFromPiAgent` の依存関係。リクエストごとに Agent を生成しコンテキスト漏洩を防ぐ。 */
export interface PiChatBackendDeps {
  registry: Registry;
  engine: Engine;
  /**
   * `createHikariHarness` の戻り値。指定時は intent / plan をチャットターン単位で記録し、
   * engine は `tool-only` harness モードで動作する。
   */
  harnessApi?: HikariHarness;
  agentOptions?: HikariAgentOptions;
  /**
   * ストリーム単位で承認待ち通知を登録する。
   * @returns ストリーム終了時に呼ぶ解除関数。
   */
  onRegisterApprovalNotifier?: (
    traceId: string,
    notify: (req: ApprovalRequest) => void,
  ) => (() => void) | void;
}

/**
 * Pi harness + Hikari エンジンから `ChatBackend` を生成する。
 * 各ストリームで専用 Agent を起動し、履歴・`ExecutionOptions`・harness trace をターン単位で適用する。
 */
export const backendFromPiAgent = (deps: PiChatBackendDeps): ChatBackend => ({
  stream(message, history, options) {
    return (async function* () {
      const traceId = options.traceId ?? randomUUID();
      const intent = options.intent ?? intentSnippetFromMessage(message);
      let unregisterApproval: (() => void) | undefined;
      const executionContext: ExecutionOptions = {
        userId: options.userId,
        sessionId: options.sessionId,
        traceId,
        intent,
        permissions: options.permissions,
      };

      const harness = deps.harnessApi?.harness;
      const engine = deps.harnessApi?.engine ?? deps.engine;
      const planSteps: HarnessPlanStep[] = [];
      let planStepOrder = 0;

      if (harness) {
        await harness.recordIntent({
          traceId,
          userId: options.userId,
          sessionId: options.sessionId,
          intent,
        });
      }

      const contextRef = { current: executionContext };
      const agent = createHikariAgent(
        deps.registry,
        engine,
        () => contextRef.current,
        { ...deps.agentOptions, harness: undefined },
      );

      agent.state.messages = chatHistoryToAgentMessages(history, agent.state.model);

      const queue = createAsyncEventQueue<ChatStreamEvent>();
      const traceIds = new Set<string>([traceId]);

      unregisterApproval = deps.onRegisterApprovalNotifier?.(traceId, (req) => {
        queue.push({
          type: 'approval_required',
          requestId: req.id,
          capabilityName: req.capabilityName,
          riskLevel: req.riskLevel,
          input: req.input,
          traceId: req.context.traceId,
        });
      }) ?? undefined;

      const unsub = agent.subscribe((event) => {
        const agentEvent = event as {
          type: string;
          message?: { role?: string; content?: { type: string; text?: string }[] };
          toolName?: string;
          args?: unknown;
          result?: unknown;
          isError?: boolean;
          assistantMessageEvent?: { type: string; delta?: string };
        };

        if (agentEvent.type === 'message_update' && agentEvent.assistantMessageEvent) {
          const ae = agentEvent.assistantMessageEvent;
          if (ae.type === 'text_delta' && ae.delta) {
            queue.push({ type: 'text_delta', delta: ae.delta });
          }
        } else if (agentEvent.type === 'tool_execution_start') {
          if (agentEvent.toolName) {
            planSteps.push({
              capabilityName: agentEvent.toolName,
              order: planStepOrder,
              ...((agentEvent as { toolCallId?: string }).toolCallId !== undefined
                ? { toolCallId: (agentEvent as { toolCallId?: string }).toolCallId }
                : {}),
            });
            planStepOrder += 1;
          }
          queue.push({
            type: 'tool_use',
            name: agentEvent.toolName ?? '',
            input: agentEvent.args,
            traceId,
          });
        } else if (agentEvent.type === 'tool_execution_end') {
          const toolTraceId = traceIdFromPiToolResult(agentEvent.result) ?? traceId;
          traceIds.add(toolTraceId);
          queue.push({
            type: 'tool_result',
            traceId: toolTraceId,
            output: agentEvent.isError ? { error: agentEvent.result } : agentEvent.result,
          });
        } else if (agentEvent.type === 'agent_end') {
          queue.push({ type: 'done', traceIds: [...traceIds] });
          queue.close();
        }
      });

      const promptPromise = agent.prompt(message).catch((err: unknown) => {
        queue.push({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
        queue.close();
      });

      try {
        yield* queue;
      } finally {
        unregisterApproval?.();
        unsub();
        if (harness) {
          const steps = [...planSteps];
          await harness.recordPlan({
            traceId,
            userId: options.userId,
            sessionId: options.sessionId,
            intent,
            plan: buildHarnessPlanFromToolCalls(steps),
            metadata: harnessPlanStepsMetadata(steps),
          });
        }
        agent.reset();
        await promptPromise;
      }
    })();
  },
});
