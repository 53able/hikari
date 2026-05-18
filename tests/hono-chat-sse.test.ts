/**
 * 実行: npm test -- tests/hono-chat-sse.test.ts
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  createHikariExecutionOptionsMiddleware,
  mountHikariChat,
} from '../src/adapters/hono.js';
import type { ChatBackend, ChatStreamEvent } from '../src/web/chat-stream.js';

const collectSseDataLines = async (response: Response): Promise<string[]> => {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length));
};

describe('mountHikariChat SSE', () => {
  const mockBackend: ChatBackend = {
    stream() {
      return (async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: 'text_delta', delta: 'hello' };
        yield {
          type: 'tool_use',
          name: 'ping',
          input: {},
          traceId: 'trace-1',
        };
        yield { type: 'tool_result', traceId: 'trace-1', output: { pong: true } };
        yield {
          type: 'approval_required',
          requestId: 'apr-1',
          capabilityName: 'danger',
          riskLevel: 'high',
          input: { x: 1 },
          traceId: 'trace-1',
        };
        yield { type: 'done', traceIds: ['trace-1'] };
      })();
    },
  };

  const buildApp = (): Hono => {
    const auth = createHikariExecutionOptionsMiddleware(() => ({
      userId: 'tester',
      permissions: [],
    }));
    const app = new Hono();
    return mountHikariChat(app.use('/chat', auth), {
      backend: mockBackend,
      chatPath: '/chat',
      serveUi: false,
    });
  };

  it('POST /chat with Accept text/event-stream streams text_delta and done', async () => {
    const app = buildApp();
    const response = await app.fetch(
      new Request('http://localhost/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ message: 'hi' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const dataLines = await collectSseDataLines(response);
    const events = dataLines.map((line) => JSON.parse(line) as ChatStreamEvent);

    expect(events.some((e) => e.type === 'text_delta' && e.delta === 'hello')).toBe(true);
    expect(events.some((e) => e.type === 'tool_use' && e.name === 'ping')).toBe(true);
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
    expect(events.some((e) => e.type === 'approval_required')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});
