import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@53able/hikari/redis': path.join(rootDir, 'src/redis.ts'),
      '@53able/hikari/file': path.join(rootDir, 'src/file.ts'),
      '@53able/hikari/hono': path.join(rootDir, 'src/hono.ts'),
      '@53able/hikari/pi': path.join(rootDir, 'src/pi.ts'),
      '@53able/hikari': path.join(rootDir, 'src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
