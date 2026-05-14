import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CliContext {
  cwd: string;
  argv: string[];
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export type CliCommand = (ctx: CliContext, args: string[]) => Promise<number>;

export type CliRouter = {
  readonly register: (name: string, command: CliCommand) => CliRouter;
  readonly run: (ctx: CliContext) => Promise<number>;
};

export function createCliRouter(): CliRouter {
  const commands = new Map<string, CliCommand>();
  const router: CliRouter = {
    register(name, command) {
      commands.set(name, command);
      return router;
    },
    async run(ctx) {
      const [cmd, ...args] = ctx.argv;

      if (!cmd || cmd === '--help' || cmd === '-h') {
        ctx.stdout.write(usage());
        return 0;
      }
      if (cmd === '--version' || cmd === '-v') {
        ctx.stdout.write(getVersion() + '\n');
        return 0;
      }

      const command = commands.get(cmd);
      if (!command) {
        ctx.stderr.write(`Error: Unknown command '${cmd}'. Run 'hikari --help' for usage.\n`);
        return 1;
      }

      return command(ctx, args);
    },
  };
  return router;
}

function getVersion(): string {
  try {
    const pkgPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../package.json',
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function usage(): string {
  return `hikari v${getVersion()} — AI-native application layer CLI

Usage:
  hikari generate capability <name> [options]   Generate a capability scaffold
  hikari list [--entry <file>] [--format table|json]  List registered capabilities
  hikari serve [--port 3000] [--entry <file>]   Start the chat server

Options:
  --help, -h       Show this help
  --version, -v    Print version

generate capability options:
  --side-effects <list>   Comma-separated side effects (default: read)
  --permissions <list>    Comma-separated required permissions
  --out-dir <path>        Output directory (default: src/capabilities)
  --force                 Overwrite existing files
`;
}

export async function runCli(ctx?: Partial<CliContext>): Promise<number> {
  const context: CliContext = {
    cwd: ctx?.cwd ?? process.cwd(),
    argv: ctx?.argv ?? process.argv.slice(2),
    stdout: ctx?.stdout ?? process.stdout,
    stderr: ctx?.stderr ?? process.stderr,
  };

  const { generateCommand } = await import('./commands/generate.js');
  const { listCommand } = await import('./commands/list.js');
  const { serveCommand } = await import('./commands/serve.js');

  const router = createCliRouter()
    .register('generate', generateCommand)
    .register('list', listCommand)
    .register('serve', serveCommand);

  return router.run(context);
}
