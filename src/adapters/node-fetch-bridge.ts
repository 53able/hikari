import type { IncomingMessage, ServerResponse } from 'node:http';

const readNodeBody = async (req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

/** ヘッダーのみを Web `Request` に載せる（ボディは既に消費済みのとき用）。 */
export const toWebRequestHeadersOnly = (
  req: IncomingMessage,
  baseUrl = 'http://localhost',
): Request => {
  const url = new URL(req.url ?? '/', baseUrl);
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => headers.append(key, v));
    } else {
      headers.set(key, value);
    }
  }
  return new Request(url, { method, headers });
};

/**
 * Node.js `IncomingMessage` を Web Standard `Request` に変換する（移行期間用）。
 * POST/PUT 等はボディを読み込んでから `Request` を構築する。
 */
export const toWebRequest = async (
  req: IncomingMessage,
  baseUrl = 'http://localhost',
): Promise<Request> => {
  const url = new URL(req.url ?? '/', baseUrl);
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => headers.append(key, v));
    } else {
      headers.set(key, value);
    }
  }
  const needsBody = method !== 'GET' && method !== 'HEAD';
  const body = needsBody ? await readNodeBody(req) : undefined;
  return new Request(url, { method, headers, body: body || undefined });
};

/**
 * Web Standard `Response` を Node.js `ServerResponse` に書き込む。
 */
export const sendWebResponse = async (
  res: ServerResponse,
  response: Response,
): Promise<void> => {
  res.statusCode = response.status;
  response.headers.forEach((value: string, key: string) => {
    res.setHeader(key, value);
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
};
