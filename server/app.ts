import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { Store } from './store';
import { generateChallenge, scenarioOptions, GENERATOR_VERSION } from './generator';
import { modes, difficulties, type GenerateOptions } from '../shared/types';
import { research, toolIdeas } from '../shared/research';

function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
export function validateOptions(raw: unknown): GenerateOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Expected generation options');
  const x = raw as Record<string, unknown>;
  if (!modes.includes(x.mode as never)) fail('Choose a valid focus');
  if (!difficulties.includes(x.difficulty as never)) fail('Choose a valid difficulty');
  if (!Number.isInteger(x.minutes) || Number(x.minutes) < 15 || Number(x.minutes) > 420) fail('Time limit must be an integer between 15 and 420 minutes');
  if (x.seed !== undefined && (typeof x.seed !== 'string' || x.seed.length > 80)) fail('Seed must be a string of at most 80 characters');
  if (x.scenario !== undefined && x.scenario !== 'random' && !scenarioOptions.some(s => s.id === x.scenario)) fail('Choose a valid scenario');
  return {
    mode: x.mode as GenerateOptions['mode'], difficulty: x.difficulty as GenerateOptions['difficulty'], minutes: x.minutes as number,
    seed: typeof x.seed === 'string' && x.seed.trim() ? x.seed.trim() : randomUUID().slice(0, 8),
    ...(x.scenario && x.scenario !== 'random' ? { scenario: x.scenario as string } : {}),
  };
}
async function readJson(req: IncomingMessage) {
  if (!req.headers['content-type']?.includes('application/json')) fail('Content-Type must be application/json', 415);
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32000) fail('Request body too large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('Invalid JSON'); }
}
export function createApp(dbPath: string, staticDirectory = resolve('dist')) {
  const store = new Store(dbPath);
  const server = createServer(async (req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    try {
      const path = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      if (path.startsWith('/api/')) {
        if (req.headers.origin) {
          const origin = new URL(req.headers.origin);
          if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || !['5173', '3001', process.env.PORT || '3001'].includes(origin.port)) fail('Origin not allowed', 403);
        }
        if (req.method === 'GET' && path === '/api/health') return json(200, { ok: true, storage: 'sqlite', generatorVersion: GENERATOR_VERSION });
        if (req.method === 'GET' && path === '/api/catalog') return json(200, { scenarios: scenarioOptions, research, toolIdeas });
        if (req.method === 'POST' && path === '/api/challenges') return json(201, generateChallenge(validateOptions(await readJson(req))));
        if (req.method === 'POST' && path === '/api/kits') {
          const challenge = generateChallenge(validateOptions(await readJson(req)));
          const zip = new JSZip();
          for (const file of challenge.files) zip.file(file.name, file.content, { date: new Date('2026-01-01T00:00:00Z') });
          const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="deadline-forge-${challenge.scenario}-${challenge.id}.zip"`, 'Cache-Control': 'no-store' });
          return res.end(buffer);
        }
        const savedKit = /^\/api\/kits\/([a-zA-Z0-9-]+)$/.exec(path);
        if (req.method === 'GET' && savedKit) {
          const challenge = store.get(savedKit[1]).challenge;
          const zip = new JSZip();
          for (const file of challenge.files) zip.file(file.name, file.content, { date: new Date('2026-01-01T00:00:00Z') });
          const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="deadline-forge-${challenge.scenario}-${challenge.id}.zip"`, 'Cache-Control': 'no-store' });
          return res.end(buffer);
        }
        if (req.method === 'GET' && path === '/api/sessions') return json(200, store.list());
        if (req.method === 'POST' && path === '/api/sessions') {
          const body = await readJson(req);
          if (!body || typeof body.strict !== 'boolean') fail('Choose practice or exam mode');
          return json(201, store.start(generateChallenge(validateOptions(body.options)), body.strict));
        }
        const match = /^\/api\/sessions\/([a-zA-Z0-9-]+)$/.exec(path);
        if (match && req.method === 'GET') return json(200, store.get(match[1]));
        if (match && req.method === 'PATCH') {
          const body = await readJson(req);
          if (!body || typeof body.action !== 'string') fail('Choose a session action');
          return json(200, store.update(match[1], body));
        }
        return json(404, { error: 'API route not found' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'Method not allowed' });
      return serveStatic(path, req, res, staticDirectory);
    } catch (error) {
      const err = error as Error & { status?: number };
      if (!res.headersSent) json(err.status || 500, { error: err.status ? err.message : 'The local server encountered an error.' });
    }
  });
  return { server, store };
}

function serveStatic(path: string, req: IncomingMessage, res: ServerResponse, root: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { res.writeHead(400); return res.end('Invalid path'); }
  const resolved = resolve(root, '.' + decoded);
  if (resolved !== root && !resolved.startsWith(root + sep)) { res.writeHead(403); return res.end('Forbidden'); }
  let file = resolved;
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (extname(decoded)) { res.writeHead(404); return res.end('Not found'); }
    file = resolve(root, 'index.html');
  }
  if (!existsSync(file)) { res.writeHead(503); return res.end('Run npm run build, then npm start. For development use npm run dev and open port 5173.'); }
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}
