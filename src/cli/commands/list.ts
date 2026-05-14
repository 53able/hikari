import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRegistryFrom } from '../loader.js';
import type { CliCommand } from '../index.js';

export const listCommand: CliCommand = async (ctx, args) => {
  let entry = '';
  let format: 'table' | 'json' = 'table';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--entry' && args[i + 1]) { entry = args[++i]; }
    else if (args[i] === '--format' && args[i + 1]) {
      const f = args[++i];
      if (f !== 'table' && f !== 'json') {
        ctx.stderr.write(`Error: --format must be 'table' or 'json'\n`);
        return 1;
      }
      format = f;
    }
  }

  if (!entry) {
    const candidates = [
      'src/capabilities/index.ts',
      'src/capabilities/index.js',
      'src/index.ts',
      'src/index.js',
    ];
    entry = candidates.find((c) => existsSync(resolve(ctx.cwd, c))) ?? '';
    if (!entry) {
      ctx.stderr.write(
        `Error: Could not find registry file. Use --entry <path> to specify.\n`,
      );
      return 1;
    }
  }

  try {
    const { registry } = await loadRegistryFrom(entry);
    const caps = registry.getAll();

    if (format === 'json') {
      ctx.stdout.write(
        JSON.stringify(
          caps.map((c) => ({
            name: c.name,
            description: c.description,
            sideEffects: c.policy.sideEffects,
            requiresApproval: c.policy.requiresApproval ?? false,
          })),
          null,
          2,
        ) + '\n',
      );
      return 0;
    }

    // table format
    const maxName = Math.max(4, ...caps.map((c) => c.name.length));
    const maxDesc = Math.max(11, ...caps.map((c) => Math.min(c.description.length, 50)));
    const sep = '-'.repeat(maxName + maxDesc + 24);
    ctx.stdout.write(
      `${'Name'.padEnd(maxName)}  ${'Description'.padEnd(maxDesc)}  ${'SideEffects'.padEnd(20)}\n`,
    );
    ctx.stdout.write(sep + '\n');
    for (const cap of caps) {
      const desc = cap.description.length > 50
        ? cap.description.slice(0, 47) + '...'
        : cap.description;
      ctx.stdout.write(
        `${cap.name.padEnd(maxName)}  ${desc.padEnd(maxDesc)}  ${cap.policy.sideEffects.join(',')}\n`,
      );
    }
    ctx.stdout.write(`\n${caps.length} ${caps.length !== 1 ? 'capabilities' : 'capability'} registered.\n`);
    return 0;
  } catch (err) {
    ctx.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
};
