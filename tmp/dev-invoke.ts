/**
 * 開発用 capability smoke test（API キー不要）。
 *
 * ```bash
 * npx tsx tmp/dev-invoke.ts --list
 * npx tsx tmp/dev-invoke.ts list_books
 * npx tsx tmp/dev-invoke.ts purchase_book '{"bookId":"1","quantity":1}' purchase
 * npx tsx tmp/dev-invoke.ts --entry examples/bookstore/registry.ts list_books
 * ```
 */
import { createCapabilityInvoker, runInvokeCli } from '../src/devtools/invoker.js';
import { loadRegistryFrom } from '../src/cli/loader.js';
import { registry as bookstoreRegistry } from '../examples/bookstore/registry.js';

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
    const { registry } = await loadRegistryFrom(entry);
    return { invoker: createCapabilityInvoker({ registry }), argv: rest };
  }
  return {
    invoker: createCapabilityInvoker({ registry: bookstoreRegistry }),
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
