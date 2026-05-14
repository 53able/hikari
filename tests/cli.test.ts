import { describe, it, expect } from 'vitest';
import { renderChatHtml } from '../src/web/chat-ui.js';
import { renderCapabilityTemplate, renderTestTemplate, toPascalCase } from '../src/cli/templates.js';

describe('renderChatHtml', () => {
  it('returns a valid HTML document', () => {
    const html = renderChatHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('/chat');
    expect(html).toContain('/events');
  });

  it('injects custom title and endpoints', () => {
    const html = renderChatHtml({ title: 'My App', endpoint: '/api/chat', eventsEndpoint: '/api/events' });
    expect(html).toContain('My App');
    expect(html).toContain('/api/chat');
    expect(html).toContain('/api/events');
  });
});

describe('toPascalCase', () => {
  it('converts snake_case to PascalCase', () => {
    expect(toPascalCase('send_email')).toBe('SendEmail');
    expect(toPascalCase('list_books')).toBe('ListBooks');
    expect(toPascalCase('foo')).toBe('Foo');
  });
});

describe('renderCapabilityTemplate', () => {
  it('generates a TypeScript capability file', () => {
    const src = renderCapabilityTemplate({
      name: 'send_email',
      pascalName: 'SendEmail',
      sideEffects: "['external']",
      requiredPermissions: "['admin']",
      auditLevel: 'full',
    });
    expect(src).toContain("name: 'send_email'");
    expect(src).toContain('defineCapability');
    expect(src).toContain("['external']");
  });
});

describe('renderTestTemplate', () => {
  it('generates a vitest test file', () => {
    const src = renderTestTemplate({ name: 'send_email', importPath: '../src/capabilities/send_email.ts' });
    expect(src).toContain("describe('send_email'");
    expect(src).toContain("'send_email'");
    expect(src).toContain('createEngine');
  });
});
