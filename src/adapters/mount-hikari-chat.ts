import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApprovalApi } from '../core/approval-store.js';
import type { ApprovalRequest } from '../core/approval.js';
import type { RateLimitGuard } from '../core/rate-limit.js';
import { clientIpFromRequest } from '../core/rate-limit.js';
import type { SessionManager } from '../agent/session.js';
import type { ChatBackend, ChatMessage, ChatStreamEvent } from '../web/chat-stream.js';
import { renderChatHtml } from '../web/chat-ui.js';
import type { LlmChatClient } from './llm-provider.js';
import { missingLlmApiKeyMessage } from './llm-provider.js';
import type { HikariHonoEnv } from './hikari-hono-env.js';

const chatBodySchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
});

type PendingChatStream = {
  readonly iter: AsyncIterator<ChatStreamEvent>;
  readonly sessionId?: string;
};

const wantsSseStream = (req: Request): boolean => {
  const accept = req.headers.get('accept') ?? '';
  return accept.includes('text/event-stream');
};

/** `mountHikariChat` のオプション。 */
export type MountHikariChatOptions = {
  /** ストリーミング対応チャットバックエンド（Pi / Claude / OpenAI ラップ）。 */
  readonly backend?: ChatBackend;
  /** 非ストリーミング JSON チャット（`backend` 未指定時）。 */
  readonly llmChat?: LlmChatClient | undefined;
  readonly chatPath?: string;
  readonly eventsPath?: string;
  readonly uiPath?: string;
  readonly serveUi?: boolean;
  readonly missingApiKeyMessage?: string;
  readonly sessions?: SessionManager;
  readonly rateLimitGuard?: RateLimitGuard;
  readonly approvals?: ApprovalApi;
  readonly onRegisterApprovalNotifier?: (
    traceId: string,
    notify: (req: ApprovalRequest) => void,
  ) => (() => void) | void;
};

/**
 * チャット UI・JSON API・SSE ストリームを Hono にマウントする。
 * `createHikariExecutionOptionsMiddleware` をチャットルートに適用すること。
 */
export const mountHikariChat = <E extends HikariHonoEnv>(
  app: Hono<E>,
  options: MountHikariChatOptions,
): Hono<E> => {
  const chatPath = options.chatPath ?? '/api/chat';
  const eventsPath = options.eventsPath ?? '/events';
  const uiPath = options.uiPath ?? '/';
  const missingMessage = options.missingApiKeyMessage ?? missingLlmApiKeyMessage;
  const pendingStreams = new Map<string, PendingChatStream>();
  const sessionMgr = options.sessions;
  const approvals = options.approvals;

  let result = app;
  if (options.serveUi !== false) {
    result = result.get(uiPath, (c) =>
      c.html(
        renderChatHtml({
          title: 'Hikari Chat',
          endpoint: chatPath,
          eventsEndpoint: eventsPath,
        }),
      ),
    );
  }

  result.post(chatPath, async (c) => {
    const parsed = chatBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body' } }, 400);
    }

    const exec = c.get('executionOptions');

    if (options.rateLimitGuard) {
      const limited = await Promise.resolve(
        options.rateLimitGuard.check({
          ip: clientIpFromRequest(c.req.raw),
          userId: exec.userId,
        }),
      );
      if (!limited.allowed) {
        return c.json(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests',
              retryAfterSeconds: limited.retryAfterSeconds,
            },
          },
          429,
          { 'Retry-After': String(limited.retryAfterSeconds) },
        );
      }
    }

    const approveMatch = parsed.data.message.match(/^\/approve\s+(\S+)\s*$/i);
    const rejectMatch = parsed.data.message.match(/^\/reject\s+(\S+)(?:\s+(.+))?$/i);
    if (approvals && approveMatch) {
      const id = approveMatch[1];
      const ok = await Promise.resolve(approvals.approve(id, exec.userId));
      return c.json({ ok, id, action: 'approve' });
    }
    if (approvals && rejectMatch) {
      const id = rejectMatch[1];
      const reason = rejectMatch[2]?.trim();
      const ok = await Promise.resolve(approvals.reject(id, exec.userId, reason));
      return c.json({ ok, id, action: 'reject', reason });
    }

    if (options.backend) {
      const sessionId = parsed.data.sessionId ?? sessionMgr?.createSession(exec.userId).id;
      const history: ChatMessage[] =
        sessionId && sessionMgr
          ? (sessionMgr.getMessages(sessionId) as {
              role: string;
              content: string;
              timestamp: Date;
            }[])
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
                timestamp: m.timestamp,
              }))
          : [];

      if (sessionId && sessionMgr) {
        sessionMgr.appendMessage(sessionId, { role: 'user', content: parsed.data.message });
      }

      const streamOptions = { ...exec, sessionId };

      if (wantsSseStream(c.req.raw)) {
        return streamSSE(c, async (stream) => {
          let assistantText = '';
          for await (const event of options.backend!.stream(
            parsed.data.message,
            history,
            streamOptions,
          )) {
            if (event.type === 'text_delta') {
              assistantText += event.delta;
            }
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
            });
            if (event.type === 'done' && sessionId && sessionMgr) {
              sessionMgr.appendMessage(sessionId, {
                role: 'assistant',
                content: assistantText.trim() || '(completed)',
                traceIds: event.traceIds,
              });
              break;
            }
            if (event.type === 'error') {
              break;
            }
          }
        });
      }

      const requestId = randomUUID();
      const iter = options.backend.stream(
        parsed.data.message,
        history,
        streamOptions,
      )[Symbol.asyncIterator]();
      pendingStreams.set(requestId, { iter, sessionId });
      setTimeout(() => {
        const pending = pendingStreams.get(requestId);
        if (pending) {
          pendingStreams.delete(requestId);
          pending.iter.return?.();
        }
      }, 120_000);
      return c.json({ sessionId, requestId });
    }

    if (!options.llmChat) {
      return c.json(
        { error: { code: 'MISSING_API_KEY', message: missingMessage } },
        503,
      );
    }
    const chatResult = await options.llmChat.chat(
      [{ role: 'user', content: parsed.data.message }],
      {
        ...exec,
        intent: 'Hikari chat',
      },
    );
    return c.json({
      content: chatResult.content,
      traceIds: chatResult.traceIds,
      provider: options.llmChat.provider,
    });
  });

  result.get(eventsPath, async (c) => {
    const requestId = c.req.query('requestId');
    if (!requestId) {
      return c.text('Missing requestId', 400);
    }
    const pending = pendingStreams.get(requestId);
    if (!pending) {
      return c.text('Stream not found', 404);
    }
    pendingStreams.delete(requestId);
    const { iter, sessionId } = pending;

    return streamSSE(c, async (stream) => {
      let assistantText = '';
      try {
        let next = await iter.next();
        while (!next.done) {
          const event = next.value;
          if (event.type === 'text_delta') {
            assistantText += event.delta;
          }
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
          if (event.type === 'done') {
            if (sessionId && sessionMgr) {
              sessionMgr.appendMessage(sessionId, {
                role: 'assistant',
                content: assistantText.trim() || '(completed)',
                traceIds: event.traceIds,
              });
            }
            break;
          }
          if (event.type === 'error') {
            break;
          }
          next = await iter.next();
        }
      } catch (err) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          }),
        });
      }
    });
  });

  return result;
};
