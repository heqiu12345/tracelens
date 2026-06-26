/**
 * Smoke test against a real Langfuse instance (requires environment variables). Verifies the
 * adapter can connect, fetch data, and render.
 *
 *   LANGFUSE_HOST=https://cloud.langfuse.com \
 *   LANGFUSE_PUBLIC_KEY=pk-lf-... \
 *   LANGFUSE_SECRET_KEY=sk-lf-... \
 *   node packages/adapter-langfuse/smoke.ts
 *
 * Not run in CI (no credentials); for pure-function logic see verify.ts.
 */
import { langfuseDataSourceFromEnv, langfuseDefaultRenderer } from './src/index.ts';

const ds = langfuseDataSourceFromEnv();
const now = new Date();
const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();

const pageRes = await ds.listTraces({ from, to: now.toISOString() }, { page: 1, limit: 5 });
console.log(`✅ connected to "${ds.name}": ${pageRes.total} traces in last 7d, showing ${pageRes.items.length}`);
for (const t of pageRes.items) {
  console.log(`  - ${t.id}  session=${t.sessionId ?? '-'}  tags=[${(t.tags ?? []).join(', ')}]`);
}

if (pageRes.items[0]) {
  const full = await ds.getTrace(pageRes.items[0].id);
  const view = langfuseDefaultRenderer.render(full);
  console.log(`\nDefault renderer → ${view.turns.length} turn(s):`);
  for (const turn of view.turns) {
    console.log(`  [${turn.role}] ${turn.blocks.map((b) => b.type).join(', ')}`);
  }
  if (ds.getScores) {
    const scores = await ds.getScores(pageRes.items[0].id);
    console.log(`\nScores on first trace: ${scores.length ? scores.map((s) => `${s.name}=${s.value}`).join(', ') : '(none)'}`);
  }
}
