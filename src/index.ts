export * from './core/index.js';
export { createClaudeAdapter } from './adapters/claude.js';
export type { ClaudeAdapter, ChatOptions, ChatResult } from './adapters/claude.js';
export {
  createHikariAgent,
  createHikariAgentWithOptions,
  toAgentTools,
  chatHistoryToAgentMessages,
  intentSnippetFromMessage,
  traceIdFromPiToolResult,
} from './adapters/pi.js';
export type {
  HikariAgent,
  HikariAgentOptions,
  PiToolBindings,
  PiToolExecutionContext,
  PiToolResultDetails,
} from './adapters/pi.js';
export type { PiChatBackendDeps } from './web/chat-server.js';
export { createHttpAdapter } from './adapters/http.js';
export type { HttpAdapter, HttpAdapterOptions, CapabilityMeta } from './adapters/http.js';
export { createSessionManager } from './agent/session.js';
export type { Session, SessionMessage, SessionManager, SessionManagerOptions } from './agent/session.js';
export { createChatServer, backendFromClaude, backendFromPiAgent } from './web/chat-server.js';
export type { ChatServer, ChatServerOptions, ChatBackend, ChatMessage, ChatStreamEvent } from './web/chat-server.js';
export { renderChatHtml } from './web/chat-ui.js';
export type { ChatUiOptions } from './web/chat-ui.js';
export { createTraceViewer } from './devtools/trace-viewer.js';
export type { TraceViewer, TraceSpan, TraceStatus, FormatOptions } from './devtools/trace-viewer.js';
export { renderTraceHtml } from './devtools/trace-html.js';
export { createCapabilityExplorer } from './devtools/cap-explorer.js';
export type { CapabilityExplorer } from './devtools/cap-explorer.js';
