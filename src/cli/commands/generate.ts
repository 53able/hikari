import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { toPascalCase, renderCapabilityTemplate, renderTestTemplate } from '../templates.js';
import type { CliCommand } from '../index.js';

export const generateCommand: CliCommand = async (ctx, args) => {
  if (args[0] !== 'capability') {
    ctx.stderr.write(`Usage: hikari generate capability <name> [options]\n`);
    return 1;
  }

  const name = args[1];
  if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
    ctx.stderr.write(`Error: capability name must match [a-z][a-z0-9_]* (got: ${name ?? '(none)'})\n`);
    return 1;
  }

  let outDir = 'src/capabilities';
  let testDir = 'tests';
  const sideEffects: string[] = ['read'];
  const permissions: string[] = [];
  let force = false;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--out-dir' && args[i + 1]) { outDir = args[++i]; }
    else if (args[i] === '--test-dir' && args[i + 1]) { testDir = args[++i]; }
    else if (args[i] === '--side-effects' && args[i + 1]) {
      sideEffects.splice(0, sideEffects.length, ...args[++i].split(',').map((s) => s.trim()));
    }
    else if (args[i] === '--permissions' && args[i + 1]) {
      permissions.push(...args[++i].split(',').map((s) => s.trim()));
    }
    else if (args[i] === '--force') { force = true; }
  }

  const capFile = resolve(ctx.cwd, outDir, `${name}.ts`);
  const testFile = resolve(ctx.cwd, testDir, `${name}.test.ts`);

  if (!capFile.startsWith(ctx.cwd) || !testFile.startsWith(ctx.cwd)) {
    ctx.stderr.write(`Error: Output paths must be within the project directory.\n`);
    return 1;
  }

  if (!force && existsSync(capFile)) {
    ctx.stderr.write(`Error: '${capFile}' already exists. Use --force to overwrite.\n`);
    return 1;
  }

  const needsApproval = sideEffects.some((s) => ['financial', 'irreversible'].includes(s));
  const auditLevel = sideEffects.includes('financial') || sideEffects.includes('irreversible')
    ? 'full'
    : sideEffects.includes('write') ? 'basic' : 'none';

  const vars = {
    name,
    pascalName: toPascalCase(name),
    sideEffects: JSON.stringify(sideEffects),
    requiredPermissions: JSON.stringify(permissions),
    auditLevel: auditLevel as 'none' | 'basic' | 'full',
  };
  if (needsApproval) {
    // injected inline into template via requiresApproval field
  }

  mkdirSync(dirname(capFile), { recursive: true });
  writeFileSync(capFile, renderCapabilityTemplate(vars), 'utf8');
  ctx.stdout.write(`✓ Created ${join(outDir, name + '.ts')}\n`);

  if (!existsSync(testFile) || force) {
    mkdirSync(dirname(testFile), { recursive: true });
    const importPath = './' + relative(dirname(testFile), capFile).replace(/\\/g, '/');
    writeFileSync(testFile, renderTestTemplate({ name, importPath }), 'utf8');
    ctx.stdout.write(`✓ Created ${join(testDir, name + '.test.ts')}\n`);
  }

  return 0;
};
