/**
 * adapter-langfuse self-check (offline): filter translation + fallback renderer + DataSource contract (mock fetch).
 * Run: node packages/adapter-langfuse/verify.ts
 */
import type { RawTrace, Block } from '../core/src/index.ts';
import { buildTraceQuery } from './src/query.ts';
import { langfuseDefaultRenderer } from './src/default-renderer.ts';
import { langfuseDataSource, buildObservationTurns, extractToolCalls } from './src/index.ts';

let fail = 0;
function ok(cond: boolean, name: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail++;
}

// ── filter translation ──
const q = buildTraceQuery(
  { userId: 'u1', sessionId: 's1', tags: ['a', 'b'], from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z', metadata: { entry_scene: 'home', lang: 'en' } },
  { page: 2, limit: 50 },
);
ok(q.get('userId') === 'u1', 'userId → query param');
ok(q.get('sessionId') === 's1', 'sessionId → query param');
ok(q.getAll('tags').join(',') === 'a,b', 'tags → repeated query params');
ok(q.get('fromTimestamp') === '2026-06-01T00:00:00Z', 'from → fromTimestamp');
ok(q.get('toTimestamp') === '2026-06-02T00:00:00Z', 'to → toTimestamp');
ok(q.get('page') === '2' && q.get('limit') === '50', 'pagination');
const f = JSON.parse(q.get('filter') ?? '[]');
ok(Array.isArray(f) && f.length === 2, 'metadata → 2 filter conds');
ok(f[0].type === 'stringObject' && f[0].column === 'metadata' && f[0].operator === '=', 'metadata eq → stringObject =');

// ── search behavior ──
ok(!buildTraceQuery({ search: 'hello' }, { page: 1, limit: 10 }).get('filter'), 'search ignored without searchMetadataKey');
const f3 = JSON.parse(buildTraceQuery({ search: 'hello' }, { page: 1, limit: 10 }, 'user_query').get('filter') ?? '[]');
ok(f3[0].operator === 'contains' && f3[0].key === 'user_query', 'search → metadata contains (with key)');

// ── fallback renderer ──
const messagesTrace: RawTrace = { id: 't1', raw: { input: [{ role: 'user', content: 'hi' }], output: 'hello there' } };
const r1 = langfuseDefaultRenderer.render(messagesTrace);
ok(r1.turns.length === 2 && r1.turns[0]?.role === 'user' && r1.turns[1]?.role === 'assistant', 'default renderer: messages input + string output');
const objTrace: RawTrace = { id: 't2', raw: { input: 'summarize this', output: { result: 'ok', items: [1, 2] } } };
const r2 = langfuseDefaultRenderer.render(objTrace);
ok(r2.turns[1]?.blocks[0]?.type === 'code', 'default renderer: unextractable object output → code block');
ok(r2.meta?.degraded === true, 'default renderer: degraded flag set when falling back to JSON');

// ADK / Gemini shapes: new_message.parts / content.parts should be extracted into readable text (not raw JSON)
const adkTrace: RawTrace = {
  id: 't3',
  raw: {
    input: { new_message: { parts: [{ text: 'what is the capital of France?' }], role: 'user' }, run_config: { streaming_mode: 'SSE' } },
    output: { model_version: 'gpt-4.1', content: { parts: [{ text: 'Paris.' }] } },
  },
};
const r3 = langfuseDefaultRenderer.render(adkTrace);
ok(r3.turns[0]?.blocks[0]?.type === 'markdown', 'default renderer: ADK new_message.parts → readable text (not JSON)');
ok(r3.turns[1]?.blocks[0]?.type === 'markdown', 'default renderer: ADK content.parts → readable text');
ok(r3.meta?.degraded === false, 'default renderer: ADK extracted → not degraded');

// ── extractToolCalls: multiple formats (Gemini / OpenAI / Anthropic) ──
const gemCalls = extractToolCalls({ parts: [
  { functionCall: { name: 'search', args: { q: 'kyoto' } } },
  { functionResponse: { name: 'search', response: { hits: 2 } } },
] });
ok(gemCalls.length === 1 && gemCalls[0]?.name === 'search'
  && (gemCalls[0]?.args as any)?.q === 'kyoto' && (gemCalls[0]?.result as any)?.hits === 2,
  'extractToolCalls: Gemini functionCall + functionResponse paired');
const oaCalls = extractToolCalls({ tool_calls: [{ function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } }] });
ok(oaCalls.length === 1 && oaCalls[0]?.name === 'get_weather' && (oaCalls[0]?.args as any)?.city === 'Tokyo',
  'extractToolCalls: OpenAI tool_calls (arguments JSON parsed)');
const anCalls = extractToolCalls({ content: [{ type: 'tool_use', name: 'calc', input: { a: 1 } }] });
ok(anCalls.length === 1 && anCalls[0]?.name === 'calc', 'extractToolCalls: Anthropic tool_use');

// ── buildObservationTurns: tree building + depth + chronology + tool recognition ──
const observations = [
  { id: 'r', type: 'SPAN', name: 'agent.run', startTime: '2026-06-24T00:00:00.000Z' },
  { id: 'g1', type: 'GENERATION', name: 'router', model: 'gpt-x', parentObservationId: 'r', startTime: '2026-06-24T00:00:00.100Z', output: { parts: [{ functionCall: { name: 'search', args: { q: 'x' } } }] } },
  { id: 't1', type: 'SPAN', name: 'search', parentObservationId: 'r', startTime: '2026-06-24T00:00:00.200Z', input: { q: 'x' }, output: { hits: 3 } },
  { id: 'g2', type: 'GENERATION', name: 'responder', model: 'gpt-x', parentObservationId: 'r', startTime: '2026-06-24T00:00:00.300Z', output: { parts: [{ text: 'done' }] } },
];
const steps = buildObservationTurns(observations);
const isTool = (b: Block): b is Extract<Block, { type: 'toolCall' }> => b.type === 'toolCall';
ok(steps.length === 4, 'buildObservationTurns: 4 steps');
ok(steps[0]?.depth === 0 && steps[1]?.depth === 1 && steps[2]?.depth === 1 && steps[3]?.depth === 1,
  'buildObservationTurns: depth from tree (root 0, children 1)');
ok(steps[1]?.label === 'router' && steps[2]?.label === 'search' && steps[3]?.label === 'responder',
  'buildObservationTurns: chronological order by startTime');
ok(steps[1]?.blocks.some((b) => isTool(b) && b.name === 'search' && b.status === 'pending'),
  'GENERATION functionCall → pending toolCall (request, result later)');
ok(steps[2]?.role === 'tool' && steps[2]?.blocks.some((b) => isTool(b) && b.result != null),
  'leaf SPAN with io + tool-ish name → tool exec with result');
ok(steps[3]?.blocks.some((b) => b.type === 'markdown'), 'GENERATION text → markdown');
ok(steps[1]?.meta?.obsType === 'GENERATION' && typeof steps[1]?.meta?.model === 'string',
  'step meta carries obsType + model');

// ── default renderer wires observations → steps, and isn't flagged degraded when a process tree exists ──
const obsTrace: RawTrace = { id: 't-obs', raw: {
  input: [{ role: 'user', content: 'hi' }],
  output: { weird: 'object' },        // unreadable output → the conversation alone would be degraded
  observations,
} };
const ro = langfuseDefaultRenderer.render(obsTrace);
ok((ro.steps?.length ?? 0) === 4, 'default renderer: observations → steps');
ok(ro.meta?.degraded === false, 'default renderer: not degraded when an observation tree exists');
ok(ro.meta?.stepCount === 4, 'default renderer: stepCount in meta');

// ── DataSource contract (inject a mock fetch, offline) ──
const calls: { url: string; auth?: string }[] = [];
const fakeFetch = (async (url: unknown, opts: { headers?: Record<string, string> } = {}) => {
  const u = String(url);
  calls.push({ url: u, auth: opts.headers?.Authorization });
  if (u.includes('/api/public/traces/')) {
    return { ok: true, json: async () => ({ id: 'tX', sessionId: 's', tags: ['a'], input: 'hi', output: 'yo' }) };
  }
  if (u.includes('/api/public/traces')) {
    return { ok: true, json: async () => ({ data: [{ id: 't1', tags: ['prod'] }], meta: { totalItems: 7, page: 1, limit: 20 } }) };
  }
  if (u.includes('/scores')) {
    return { ok: true, json: async () => ({ data: [{ name: 'q', value: 5, source: 'ANNOTATION' }] }) };
  }
  return { ok: false, status: 404, statusText: 'nf', text: async () => '' };
}) as unknown as typeof fetch;

const ds = langfuseDataSource({ host: 'https://lf.example.com/', publicKey: 'pk', secretKey: 'sk', fetch: fakeFetch });
const list = await ds.listTraces({ tags: ['prod'], userId: 'u1' }, { page: 1, limit: 20 });
ok(list.items.length === 1 && list.items[0]?.id === 't1', 'DataSource.listTraces parses data[]');
ok(list.total === 7, 'listTraces total from meta.totalItems');
ok(!!calls[0]?.url.includes('/api/public/traces?') && calls[0].url.includes('tags=prod') && calls[0].url.includes('userId=u1'), 'listTraces builds query URL');
ok((calls[0]?.auth ?? '').startsWith('Basic '), 'listTraces sends basic auth');
const one = await ds.getTrace('t-9');
ok(one.id === 'tX' && one.raw != null, 'getTrace maps + keeps raw');
const sc = ds.getScores ? await ds.getScores('t-9') : [];
ok(sc.length === 1 && sc[0]?.source === 'human', 'getScores maps ANNOTATION → human');

// ── listScores pagination + parsing ──
const scorePages: Record<string, any> = {
  '1': { data: [{ id: 's1', traceId: 't1', name: 'default.accuracy', value: 1, source: 'EVAL', timestamp: '2026-06-24T10:00:00Z' }], meta: { totalItems: 2, page: 1, limit: 1 } },
  '2': { data: [{ id: 's2', traceId: 't2', name: 'default.accuracy', value: 0, source: 'ANNOTATION', timestamp: '2026-06-24T11:00:00Z' }], meta: { totalItems: 2, page: 2, limit: 1 } },
};
const scoreCalls: string[] = [];
const scoreFetch = (async (url: unknown) => {
  const u = String(url); scoreCalls.push(u);
  const page = new URL(u).searchParams.get('page') ?? '1';
  return { ok: true, json: async () => scorePages[page] ?? { data: [], meta: { totalItems: 2 } } };
}) as unknown as typeof fetch;

const ds2 = langfuseDataSource({ host: 'https://lf.example.com', publicKey: 'pk', secretKey: 'sk', fetch: scoreFetch });
const sl = await ds2.listScores!({ name: 'default.accuracy' }, { page: 1, limit: 5 });
ok(sl.items.length === 2, 'listScores paginates and merges two pages');
ok(sl.items[0]?.traceId === 't1' && sl.items[0]?.source === 'eval', 'listScores fills in traceId and normalizes source (EVAL→eval)');
ok(sl.items[1]?.traceId === 't2' && sl.items[1]?.source === 'human', 'listScores ANNOTATION→human');
ok(scoreCalls.some((u) => u.includes('name=default.accuracy')), 'listScores passes through the name filter');
ok(scoreCalls.length >= 2, 'listScores automatically requests subsequent pages');

console.log(fail ? `\n❌ ${fail} FAILED` : '\n✅ adapter-langfuse self-check passed (filter + default renderer + DataSource contract)');
process.exit(fail ? 1 : 0);
