import { randomUUID } from 'node:crypto';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { buildLlmChatHistory, type LlmContextOptions } from '../agent/context.js';
import type { HarnessTracer } from '../core/harness-trace.js';
import {
  buildHarnessPlanFromToolCalls,
  harnessPlanStepsMetadata,
  type HarnessPlanStep,
} from '../core/harness-plan.js';
import type { Engine } from '../core/execution.js';
import type { Registry } from '../core/registry.js';
import { createAsyncEventQueue } from '../core/async-queue.js';
import type { ApprovalRequest } from '../core/approval.js';
import type { ChatStreamEvent, ChatMessage } from '../web/chat-stream.js';
import {
  createHikariAgent,
  chatHistoryToAgentMessages,
  intentSnippetFromMessage,
  traceIdFromPiToolResult,
  type HikariAgent,
  type HikariAgentOptions,
  type PiToolExecutionContext,
} from './pi-agent.js';

/** `runPiAgentTurn` に渡す会話履歴の 1 行。 */
export type PiTurnHistoryMessage = {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly timestamp: Date;
};

/** `runPiAgentTurn` の入力。 */
export type RunPiAgentTurnInput = {
  readonly registry: Registry;
  readonly engine: Engine;
  readonly message: string;
  readonly context: PiToolExecutionContext;
  readonly history?: readonly PiTurnHistoryMessage[];
  readonly harness?: HarnessTracer;
  readonly planPrefix?: string;
  readonly agentOptions?: HikariAgentOptions;
  readonly contextOptions?: LlmContextOptions;
  /** ストリーミング用。Pi ライフサイクルイベントをチャット SSE 形式で受け取る。 */
  readonly onEvent?: (event: ChatStreamEvent) => void;
  /** ターン専用 Agent 生成直後に呼ばれる（SDK のイベント購読用）。 */
  readonly onAgentReady?: (agent: HikariAgent) => void;
  /** 承認待ちをストリームへ流すためのコールバック登録。 */
  readonly onRegisterApprovalNotifier?: (
    traceId: string,
    notify: (req: ApprovalRequest) => void,
  ) => (() => void) | void;
};

/** `runPiAgentTurn` の戻り値。 */
export type RunPiAgentTurnResult = {
  readonly traceId: string;
  readonly traceIds: readonly string[];
  readonly agent: HikariAgent;
};

type PiAgentEvent = {
  readonly type: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly isError?: boolean;
  readonly assistantMessageEvent?: { readonly type: string; readonly delta?: string };
};

const piHistoryToChatMessages = (
  history: readonly PiTurnHistoryMessage[],
): ChatMessage[] =>
  history.map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }));

const trackPlanStep = (
  steps: HarnessPlanStep[],
  orderRef: { value: number },
  toolName: string | undefined,
  toolCallId: string | undefined,
): void => {
  if (!toolName) return;
  steps.push({
    capabilityName: toolName,
    order: orderRef.value,
    ...(toolCallId !== undefined ? { toolCallId } : {}),
  });
  orderRef.value += 1;
};

const emitFromAgentEvent = (
  agentEvent: PiAgentEvent,
  traceId: string,
  traceIds: Set<string>,
  planSteps: HarnessPlanStep[],
  planOrderRef: { value: number },
  onEvent?: (event: ChatStreamEvent) => void,
): void => {
  if (!onEvent) return;

  if (agentEvent.type === 'message_update' && agentEvent.assistantMessageEvent) {
    const ae = agentEvent.assistantMessageEvent;
    if (ae.type === 'text_delta' && ae.delta) {
      onEvent({ type: 'text_delta', delta: ae.delta });
    }
    return;
  }

  if (agentEvent.type === 'tool_execution_start') {
    trackPlanStep(planSteps, planOrderRef, agentEvent.toolName, agentEvent.toolCallId);
    onEvent({
      type: 'tool_use',
      name: agentEvent.toolName ?? '',
      input: agentEvent.args,
      traceId,
    });
    return;
  }

  if (agentEvent.type === 'tool_execution_end') {
    const toolTraceId = traceIdFromPiToolResult(agentEvent.result) ?? traceId;
    traceIds.add(toolTraceId);
    onEvent({
      type: 'tool_result',
      traceId: toolTraceId,
      output: agentEvent.isError ? { error: agentEvent.result } : agentEvent.result,
    });
    return;
  }

  if (agentEvent.type === 'agent_end') {
    onEvent({ type: 'done', traceIds: [...traceIds] });
  }
};

/**
 * Pi Agent で 1 チャットターンを実行する共通コア。
 * serve ストリームと `createHikariHarness.runTurn` の両方から利用する。
 */
export const runPiAgentTurn = async (
  input: RunPiAgentTurnInput,
): Promise<RunPiAgentTurnResult> => {
  const traceId = input.context.traceId ?? randomUUID();
  const intent = input.context.intent ?? intentSnippetFromMessage(input.message);
  const executionContext: PiToolExecutionContext = {
    ...input.context,
    traceId,
    intent,
  };

  const planSteps: HarnessPlanStep[] = [];
  const planOrderRef = { value: 0 };
  const traceIds = new Set<string>([traceId]);

  if (input.harness) {
    await input.harness.recordIntent({
      traceId,
      userId: executionContext.userId,
      sessionId: executionContext.sessionId,
      intent,
    });
  }

  const contextRef = { current: executionContext };
  const agent = createHikariAgent(input.registry, input.engine, () => contextRef.current, {
    ...input.agentOptions,
    harness: undefined,
    sessionId: executionContext.sessionId,
  });

  input.onAgentReady?.(agent);

  const historyMessages = input.history ?? [];
  if (historyMessages.length > 0) {
    const trimmed = buildLlmChatHistory(piHistoryToChatMessages(historyMessages), input.contextOptions);
    agent.state.messages = chatHistoryToAgentMessages(trimmed, agent.state.model);
  }

  const unsub = agent.subscribe((event) => {
    emitFromAgentEvent(
      event as PiAgentEvent,
      traceId,
      traceIds,
      planSteps,
      planOrderRef,
      input.onEvent,
    );
  });

  const unregisterApproval = input.onRegisterApprovalNotifier?.(traceId, (req) => {
    input.onEvent?.({
      type: 'approval_required',
      requestId: req.id,
      capabilityName: req.capabilityName,
      riskLevel: req.riskLevel,
      input: req.input,
      traceId: req.context.traceId,
    });
  });

  try {
    await agent.prompt(input.message);
    await agent.waitForIdle();
  } catch (err: unknown) {
    input.onEvent?.({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    unregisterApproval?.();
    unsub();
    agent.reset();
  }

  if (input.harness) {
    const steps = [...planSteps];
    await input.harness.recordPlan({
      traceId,
      userId: executionContext.userId,
      sessionId: executionContext.sessionId,
      intent,
      plan: buildHarnessPlanFromToolCalls(steps, { prefix: input.planPrefix }),
      metadata: harnessPlanStepsMetadata(steps),
    });
  }

  return { traceId, traceIds: [...traceIds], agent };
};

/**
 * `runPiAgentTurn` を非同期イテレータでラップする（チャット SSE 用）。
 */
export const streamPiAgentTurn = (
  input: RunPiAgentTurnInput,
): AsyncIterable<ChatStreamEvent> => ({
  async *[Symbol.asyncIterator]() {
    const queue = createAsyncEventQueue<ChatStreamEvent>();
    const turnPromise = runPiAgentTurn({
      ...input,
      onEvent: (event) => {
        queue.push(event);
        if (event.type === 'done' || event.type === 'error') {
          queue.close();
        }
      },
    })
      .catch((err: unknown) => {
        queue.push({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
        queue.close();
      });

    try {
      yield* queue;
    } finally {
      await turnPromise;
    }
  },
});
