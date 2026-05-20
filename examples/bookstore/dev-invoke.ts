/**
 * 開発用 capability smoke test（API キー不要）。
 *
 * ```bash
 * npx tsx examples/bookstore/dev-invoke.ts --list
 * npx tsx examples/bookstore/dev-invoke.ts list_books
 * npx tsx examples/bookstore/dev-invoke.ts get_book '{"bookId":"1"}'
 * npx tsx examples/bookstore/dev-invoke.ts add_book '{"title":"T","author":"A","price":10,"stock":1}' admin
 * npx tsx examples/bookstore/dev-invoke.ts --entry examples/bookstore/registry.ts list_books
 * ```
 */
import { createCapabilityInvoker, runInvokeCli } from '../../src/devtools/invoker.js';
import {
  createEngine,
  createAuditLog,
  createInMemoryStorage,
  devAutoApprove,
} from '../../src/index.js';
import type { CapabilityRuntime } from '../../src/core/capability.js';
import type { Registry } from '../../src/core/registry.js';
import { loadRegistryFrom } from '../../src/cli/loader.js';
import {
  registry as bookstoreRegistry,
  runtime as bookstoreRuntime,
} from './registry.js';

const createInvokerForRegistry = (
  registry: Registry,
  runtime?: CapabilityRuntime,
) => {
  const storage = createInMemoryStorage();
  const auditLog = createAuditLog(storage);
  return createCapabilityInvoker({
    registry,
    storage,
    auditLog,
    engine: createEngine({
      registry,
      auditLog,
      approvalGate: devAutoApprove,
      ...(runtime ? { runtime } : {}),
    }),
  });
};

const DEFAULT_ENTRY = 'examples/bookstore/registry.ts';

const stripEntryFlag = (
  argv: readonly string[],
): { readonly entry?: string; readonly rest: readonly string[] } => {
  const entryIndex = argv.indexOf('--entry');
  if (entryIndex < 0 || !argv[entryIndex + 1]) {
    return { rest: argv };
  }
  const entry = argv[entryIndex + 1];
  const rest = argv.filter((_, index) => index !== entryIndex && index !== entryIndex + 1);
  return { entry, rest };
};

const resolveInvoker = async (argv: readonly string[]) => {
  const { entry, rest } = stripEntryFlag(argv);
  if (entry) {
    const { registry, runtime } = await loadRegistryFrom(entry);
    return {
      invoker: createInvokerForRegistry(registry, runtime),
      argv: rest,
    };
  }
  return {
    invoker: createInvokerForRegistry(bookstoreRegistry, bookstoreRuntime),
    argv: rest,
  };
};

const main = async (): Promise<void> => {
  const rawArgv = process.argv.slice(2);
  const { invoker, argv } = await resolveInvoker(rawArgv);
  const exitCode = await runInvokeCli(invoker, argv, {
    capabilityName: 'list_books',
    userId: 'dev',
  });
  process.exit(exitCode);
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`dev-invoke failed: ${message}\n`);
  process.stderr.write(
    `Hint: use a real entry file, e.g. --entry ${DEFAULT_ENTRY}\n`,
  );
  process.exit(1);
});
