/**
 * tracelens review app — a thin server (zero dependencies, Node's native http).
 *
 * Holds the Langfuse credentials and renders the conversation HTML server-side
 * (the secret key never reaches the browser).
 * Endpoints: GET / (shell), GET /client.js, GET /api/config, GET /api/traces,
 *            GET /api/traces/:id (→ rendered viewHtml + scores), POST /api/judgments.
 *
 * Run: node apps/review-server/src/server.ts   (no env → demo mode)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { Judgment } from '../../../packages/core/src/index.ts';
import { renderConversationView, renderCalibrationDashboard, renderCalibrationDrilldown } from '../../../packages/review-ui/src/html.ts';
import { computeDashboard, computeDrilldown } from './calibration-data.ts';
import { loadConfig } from './config.ts';
import { renderShell } from './shell.ts';

const cfg = loadConfig();
const PORT = Number(process.env.PORT ?? 4317);
const CLIENT_JS = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

function json(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderShell(cfg));
      return;
    }
    if (method === 'GET' && path === '/client.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(CLIENT_JS);
      return;
    }
    if (method === 'GET' && path === '/api/config') {
      json(res, 200, { rubric: cfg.rubric, mode: cfg.mode, sourceName: cfg.sourceName, searchMode: cfg.searchMode, searchHint: cfg.searchHint ?? null, calDims: cfg.calDims });
      return;
    }
    if (method === 'GET' && path === '/api/traces') {
      const q = url.searchParams;
      const tags = q.get('tags');
      const filter = {
        tags: tags ? tags.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        userId: q.get('userId') || undefined,
        search: q.get('search') || undefined,
        from: q.get('from') || undefined,
        to: q.get('to') || undefined,
      };
      const page = { page: Number(q.get('page') ?? 1), limit: Number(q.get('limit') ?? 20) };
      const r = await cfg.source.listTraces(filter, page);
      json(res, 200, {
        items: r.items.map((t) => ({ id: t.id, sessionId: t.sessionId, userId: t.userId, timestamp: t.timestamp, tags: t.tags })),
        total: r.total, page: r.page, limit: r.limit,
      });
      return;
    }
    const m = path.match(/^\/api\/traces\/(.+)$/);
    if (method === 'GET' && m) {
      const id = decodeURIComponent(m[1] ?? '');
      const trace = await cfg.source.getTrace(id);
      const view = cfg.renderer.render(trace);
      const scores = cfg.source.getScores ? await cfg.source.getScores(id) : [];
      json(res, 200, { viewHtml: renderConversationView(view), scores, meta: view.meta ?? {} });
      return;
    }
    if (method === 'POST' && path === '/api/judgments') {
      const j = JSON.parse(await readBody(req)) as Judgment;
      if (!j.at) j.at = new Date().toISOString();
      await cfg.sink.submit(j);
      json(res, 200, { ok: true, sink: cfg.sink.name });
      return;
    }
    if (method === 'GET' && path === '/api/calibration') {
      const data = await computeDashboard(cfg.source, cfg.calDims, { mapping: cfg.calMapping });
      json(res, 200, { ...data, html: renderCalibrationDashboard({ ...data }) });
      return;
    }
    const cm = path.match(/^\/api\/calibration\/trace\/(.+)$/);
    if (method === 'GET' && cm) {
      const id = decodeURIComponent(cm[1] ?? '');
      const trace = await cfg.source.getTrace(id);
      const view = cfg.renderer.render(trace);
      const drill = await computeDrilldown(cfg.source, id, cfg.calDims, { mapping: cfg.calMapping });
      json(res, 200, { viewHtml: renderConversationView(view), drillHtml: renderCalibrationDrilldown(drill), pairs: drill.pairs });
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String((e as Error)?.message ?? e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  tracelens review app → http://localhost:${PORT}`);
  console.log(`  mode: ${cfg.mode}  ·  source: ${cfg.sourceName}`);
  if (cfg.mode === 'demo') {
    console.log('  (demo data — set LANGFUSE_HOST / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY for live data)\n');
  } else {
    console.log('');
  }
});
