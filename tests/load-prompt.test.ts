import { describe, it, expect } from 'vitest';
import { loadPrompt, PromptNotFoundError } from '../src/agent/load-prompt.js';

describe('loadPrompt', () => {
  it('loads default-agent prompt from src/prompts', () => {
    const text = loadPrompt('default-agent');
    expect(text).toContain('helpful assistant');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('loads bookstore-assistant prompt', () => {
    const text = loadPrompt('bookstore-assistant');
    expect(text).toContain('bookstore assistant');
  });

  it('throws PromptNotFoundError for unknown name', () => {
    expect(() => loadPrompt('does-not-exist')).toThrow(PromptNotFoundError);
  });

  it('throws PromptNotFoundError for invalid slug', () => {
    expect(() => loadPrompt('Bad_Name')).toThrow(PromptNotFoundError);
  });
});
