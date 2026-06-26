/**
 * Self-check for the aggregation helpers (injects a mock DataSource, no network): computeDashboard / computeDrilldown.
 * Run: node apps/review-server/calibration-data-verify.ts
 */
import type { DataSource, ScoreRecord, ScoreFilter, PageReq, Page, RawTrace, TraceFilter } from '../../packages/core/src/index.ts';
import { computeDashboard, computeDrilldown } from './src/calibration-data.ts';

let fail = 0;
function ok(c: boolean, n: string): void { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) fail++; }

const SCORES: ScoreRecord[] = [
  { name: 'default.helpfulness', value: 2, source: 'human', traceId: 'x', comment: "didn't answer the question" },
  { name: 'default.helpfulness', value: 5, source: 'eval', traceId: 'x', comment: 'structured' },
  { name: 'default.accuracy', value: 1, source: 'human', traceId: 'x' },
  { name: 'default.accuracy', value: 1, source: 'eval', traceId: 'x' },
  { name: 'default.helpfulness', value: 4, source: 'human', traceId: 'y' },
  { name: 'default.helpfulness', value: 4, source: 'eval', traceId: 'y' },
];
const src: DataSource = {
  name: 'mock',
  async listTraces(_f: TraceFilter, p: PageReq): Promise<Page<RawTrace>> { return { items: [], total: 0, page: p.page, limit: p.limit }; },
  async getTrace(id: string): Promise<RawTrace> { return { id, raw: { input: 'hi', output: 'yo' } }; },
  async listScores(f: ScoreFilter, p: PageReq): Promise<Page<ScoreRecord>> {
    const items = SCORES.filter((s) => (!f.name || s.name === f.name) && (!f.traceId || s.traceId === f.traceId));
    return { items, total: items.length, page: p.page, limit: p.limit };
  },
};
const dims = [
  { dimension: 'default.helpfulness', scale: 'numeric' as const },
  { dimension: 'default.accuracy', scale: 'binary' as const },
];

const dash = await computeDashboard(src, dims, {});
ok(dash.pairedTraces === 2, 'dashboard: pairedTraces=2');
ok(dash.dimensions.some((d) => d.dimension === 'default.helpfulness'), 'dashboard: includes the helpfulness dimension');
ok(dash.overall.severeDisagreements === 1, 'dashboard: 1 severe disagreement (x helpfulness differs by 3)');
ok(dash.topDisagreements[0]?.traceId === 'x', 'dashboard: top disagreement is x');

const drill = await computeDrilldown(src, 'x', dims);
ok(drill.pairs.length === 2, 'drilldown: x has 2 pairs');
const hp = drill.pairs.find((p) => p.dimension === 'default.helpfulness');
ok(hp != null && hp.agree === false && hp.human.comment === "didn't answer the question", 'drilldown: helpfulness disagreement + human comment');

// Truncation: when limit is below the real total, truncated=true
const dashT = await computeDashboard(src, dims, { limit: 1 });
ok(dashT.truncated === true, 'dashboard: truncated=true when over the cap');
const dashOk = await computeDashboard(src, dims, {});
ok(dashOk.truncated === false, 'dashboard: truncated=false when under the cap');

// mapping: a differently-named judge score (test_eva) is mapped to a human dimension
const mapScores: ScoreRecord[] = [
  { name: 'default.helpfulness', value: 3, source: 'human', traceId: 'm1' },
  { name: 'test_eva', value: 4, source: 'eval', traceId: 'm1' },
];
const mapSrc: DataSource = {
  name: 'm', async listTraces(_f, p) { return { items: [], total: 0, page: p.page, limit: p.limit }; },
  async getTrace(id) { return { id, raw: {} }; },
  async listScores(f, p) { const items = mapScores.filter((s) => !f.name || s.name === f.name); return { items, total: items.length, page: p.page, limit: p.limit }; },
};
const dashM = await computeDashboard(mapSrc, [{ dimension: 'default.helpfulness', scale: 'numeric' as const }], { mapping: { test_eva: 'default.helpfulness' } });
ok(dashM.pairedTraces === 1, 'dashboard: mapped source name is fetched and paired (test_eva→helpfulness)');

console.log(fail ? `\n❌ ${fail} FAILED` : '\n✅ aggregation-helper self-check passed');
process.exit(fail ? 1 : 0);
