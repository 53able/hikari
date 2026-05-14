import { resolve } from 'node:path';
import type { Registry } from '../core/registry.js';

export interface LoadedModule {
  registry: Registry;
  modulePath: string;
}

export async function loadRegistryFrom(
  entry: string,
  exportName = 'registry',
): Promise<LoadedModule> {
  const modulePath = resolve(process.cwd(), entry);

  if (modulePath.endsWith('.ts')) {
    try {
      // @ts-ignore — tsx may not be in types
      const tsxApi = await import('tsx/esm/api');
      tsxApi.register?.();
    } catch {
      throw new Error(
        `Cannot import TypeScript file '${entry}': tsx is not installed. ` +
          `Run: npm install --save-dev tsx`,
      );
    }
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(modulePath)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to import '${modulePath}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const registry = mod[exportName] as Registry | undefined;
  if (!registry || typeof registry.getAll !== 'function') {
    throw new Error(
      `Module '${modulePath}' does not export a Registry as '${exportName}'. ` +
        `Make sure you export: export const ${exportName} = createRegistry()...`,
    );
  }

  return { registry, modulePath };
}
