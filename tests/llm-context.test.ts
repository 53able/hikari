import { describe, it, expect } from 'vitest';
import { buildLlmChatHistory } from '../src/agent/context.js';

describe('buildLlmChatHistory', () => {
  const message = (role: 'user' | 'assistant', content: string, index: number) => ({
    role,
    content,
    timestamp: new Date(index),
  });

  it('keeps only the most recent messages up to maxMessages', () => {
    const history = Array.from({ length: 50 }, (_, index) =>
      message('user', `m${index}`, index),
    );
    const result = buildLlmChatHistory(history, { maxMessages: 10 });
    expect(result).toHaveLength(10);
    expect(result[0]?.content).toBe('m40');
    expect(result[9]?.content).toBe('m49');
  });

  it('truncates long content with ellipsis', () => {
    const long = 'x'.repeat(100);
    const result = buildLlmChatHistory([message('user', long, 0)], {
      maxCharsPerMessage: 20,
    });
    expect(result[0]?.content).toHaveLength(21);
    expect(result[0]?.content.endsWith('…')).toBe(true);
  });

  it('maps roles to user or assistant only', () => {
    const result = buildLlmChatHistory([
      { role: 'user', content: 'hi', timestamp: new Date() },
      { role: 'assistant', content: 'yo', timestamp: new Date() },
    ]);
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});
