/**
 * 実行: npm test -- tests/hono-bookstore-entry.test.ts
 *
 * `hikari serve --entry` が index を import しても listen しないことの回帰テスト。
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

describe('examples/hono-bookstore/index.ts entry side effects', () => {
  let probeServer: http.Server | undefined;

  afterEach(async () => {
    if (!probeServer) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      probeServer?.close((err) => (err ? reject(err) : resolve()));
    });
    probeServer = undefined;
  });

  it('does not bind PORT when imported (only when executed directly)', async () => {
    const mod = await import('../examples/hono-bookstore/index.js');
    expect(mod.registry.list().length).toBeGreaterThan(0);
    expect(mod.app).toBeDefined();

    const probePort = 31777;
    probeServer = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('probe');
    });
    await new Promise<void>((resolve, reject) => {
      probeServer?.listen(probePort, '127.0.0.1', (err?: Error) => (err ? reject(err) : resolve()));
    });
    const address = probeServer.address() as AddressInfo;
    expect(address.port).toBe(probePort);
  });
});
