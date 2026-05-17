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
export { createTraceViewer, isHarnessAuditEntry, partitionTraceEvents } from './devtools/trace-viewer.js';
export type { TraceViewer, TraceSpan, TraceStatus, FormatOptions } from './devtools/trace-viewer.js';
export { createHarnessTracer } from './core/harness-trace.js';
export { buildHarnessPlan } from './core/harness-plan.js';
export type { HarnessPlanOptions } from './core/harness-plan.js';
export type { AuditLevel } from './core/audit-scrub.js';
export { scrubAuditPayload } from './core/audit-scrub.js';
export type { HarnessTracerOptions } from './core/harness-trace.js';
export { renderTraceHtml } from './devtools/trace-html.js';
export { createCapabilityExplorer } from './devtools/cap-explorer.js';
export type { CapabilityExplorer } from './devtools/cap-explorer.js';
export {
  createCapabilityInvoker,
  parseInvokeCliArgs,
  formatInvokeReport,
  runInvokeCli,
  invokeRequestSchema,
  invokeReportSchema,
} from './devtools/invoker.js';
export type {
  CapabilityInvoker,
  CapabilityInvokerOptions,
  InvokeRequest,
  InvokeReport,
  InvokeCliDefaults,
  ParsedInvokeCli,
} from './devtools/invoker.js';
export {
  createInMemoryApprovalStore,
  createApprovalStore,
  createApprovalApi,
} from './core/approval-store.js';
export { createFileApprovalStore } from './core/approval-file-store.js';
export type { FileApprovalStore, FileApprovalStoreOptions } from './core/approval-file-store.js';
export {
  createApprovalFileLogger,
  wrapApprovalApiWithFileLog,
} from './core/approval-file.js';
export type { ApprovalFileEvent, ApprovalFileLogger } from './core/approval-file.js';
export type {
  ApprovalStore,
  InMemoryApprovalStore,
  ApprovalApi,
  StoredApprovalRequest,
  ApprovalRequestStatus,
  QueueApprovalGateOptions,
  ApprovalStorePersistence,
  ApprovalStoreOptions,
} from './core/approval-store.js';
export {
  createHeaderExecutionOptionsResolver,
  createHmacJwtExecutionOptionsResolver,
  executionOptionsFromJwtPayload,
  jwtExecutionPayloadSchema,
} from './web/auth.js';
export {
  executionOptionsSchema,
  IdempotencyConflictError,
} from './core/execution.js';
export {
  createInMemoryIdempotencyStore,
  hashCapabilityInput,
  buildIdempotencyStoreKey,
} from './core/idempotency-store.js';
export type { IdempotencyStore, IdempotencyRecord } from './core/idempotency-store.js';
export {
  createSlidingWindowRateLimiter,
  createRateLimitGuard,
  createDefaultRateLimitGuard,
  clientIpFromRequest,
} from './core/rate-limit.js';
export type {
  RateLimiter,
  RateLimitGuard,
  RateLimitContext,
  RateLimitResult,
} from './core/rate-limit.js';
export {
  connectHikariRedis,
  createHikariRedisClient,
  resolveRedisUrl,
} from './core/redis-client.js';
export type { HikariRedis, ConnectHikariRedisOptions } from './core/redis-client.js';
export { createRedisIdempotencyStore } from './core/redis-idempotency.js';
export type { RedisIdempotencyStoreOptions } from './core/redis-idempotency.js';
export { createRedisApprovalStore } from './core/redis-approval.js';
export type { RedisApprovalStoreOptions } from './core/redis-approval.js';
export {
  createRedisSlidingWindowRateLimiter,
  createRedisRateLimitGuard,
} from './core/redis-rate-limit.js';
export { createDefaultRedisRateLimitGuard, createServeRateLimitGuard } from './core/redis-serve.js';
export { createQueuedApprovalNotifier } from './core/approval-webhook-queue.js';
export type { QueuedApprovalNotifierOptions } from './core/approval-webhook-queue.js';
export { createJsonlAuditStorage } from './core/audit-file.js';
export type {
  JwtExecutionPayload,
  HeaderAuthResolverOptions,
  HmacJwtAuthResolverOptions,
} from './web/auth.js';
