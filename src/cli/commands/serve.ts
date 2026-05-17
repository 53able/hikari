import { loadRegistryFrom } from '../loader.js';
import type { CliCommand } from '../index.js';

export const serveCommand: CliCommand = async (ctx, args) => {
  let port = 3000;
  let entry = 'src/index.ts';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); }
    else if (args[i] === '--entry' && args[i + 1]) { entry = args[++i]; }
  }

  try {
    const { registry } = await loadRegistryFrom(entry);

    const { createAuditLog, createInMemoryStorage, createEngine, devAutoApprove, createHarnessTracer } =
      await import('../../core/index.js');
    const { createChatServer, backendFromPiAgent } = await import('../../web/chat-server.js');
    const { createSessionManager } = await import('../../agent/session.js');

    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const engine = createEngine({ registry, auditLog, approvalGate: devAutoApprove });
    const harness = createHarnessTracer(auditLog);
    const sessionMgr = createSessionManager();

    const backend = backendFromPiAgent({ registry, engine, harness });
    const server = createChatServer(backend, {
      port,
      sessions: sessionMgr,
      resolveExecutionOptions: (req) => {
        const userId = (req.headers['x-hikari-user-id'] as string | undefined) ?? 'anonymous';
        const permissionsHeader = req.headers['x-hikari-permissions'] as string | undefined;
        const permissions = permissionsHeader
          ? permissionsHeader.split(',').map((p) => p.trim()).filter(Boolean)
          : [];
        return { userId, permissions };
      },
    });

    const { port: actualPort, host } = await server.listen();
    ctx.stdout.write(`Hikari Chat Server running at http://${host}:${actualPort}\n`);
    ctx.stdout.write(`Press Ctrl+C to stop.\n`);

    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => {
        ctx.stdout.write('\nShutting down…\n');
        server.close().then(resolve).catch(resolve);
      });
      process.on('SIGTERM', () => {
        server.close().then(resolve).catch(resolve);
      });
    });

    return 0;
  } catch (err) {
    ctx.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
};
