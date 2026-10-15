/** Roteador mínimo sobre node:http — o suficiente para uma API local. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { HttpError } from './errors.ts';

export interface RequestContext {
  params: Record<string, string>;
  body: unknown;
  url: URL;
}

type Handler = (ctx: RequestContext) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  maxBody?: number;
}

const MAX_BODY_BYTES = 64 * 1024;

export class Router {
  private routes: Route[] = [];

  on(method: string, pathPattern: string, handler: Handler, maxBody?: number): this {
    const keys: string[] = [];
    const source = pathPattern.replace(/:(\w+)/g, (_, key: string) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler, maxBody });
    return this;
  }

  get(p: string, h: Handler) { return this.on('GET', p, h); }
  post(p: string, h: Handler, maxBody?: number) { return this.on('POST', p, h, maxBody); }
  patch(p: string, h: Handler) { return this.on('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.on('DELETE', p, h); }

  /** Retorna true se alguma rota respondeu. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(match[i + 1] ?? '')]));
      try {
        const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await readJson(req, route.maxBody ?? MAX_BODY_BYTES);
        const result = await route.handler({ params, body, url });
        if (result === undefined) {
          res.writeHead(204).end();
        } else {
          sendJson(res, req.method === 'POST' ? 201 : 200, result);
        }
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message });
        } else {
          console.error(error);
          sendJson(res, 500, { error: 'Erro interno no servidor do jogo.' });
        }
      }
      return true;
    }
    return false;
  }
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Requisição grande demais.');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/** Serve um arquivo de `root`, recusando caminhos que saiam da pasta. */
export function serveFile(res: ServerResponse, root: string, relative: string, cache = 'public, max-age=86400'): boolean {
  const file = path.resolve(root, `.${path.posix.normalize(`/${relative}`)}`);
  if (!file.startsWith(path.resolve(root) + path.sep)) return false;
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': cache });
  createReadStream(file).pipe(res);
  return true;
}
