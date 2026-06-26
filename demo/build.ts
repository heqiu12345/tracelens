/**
 * Build a zero-backend demo page: left "raw trace JSON" ↔ right "the readable conversation
 * rendered by tracelens" + a scoring panel.
 * Run: node demo/build.ts → produces demo/index.html, openable directly in a browser.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { RawTrace, Rubric } from '../packages/core/src/index.ts';
import { renderConversationView, renderScorePanel, CSS, esc } from '../packages/review-ui/src/html.ts';
import { demoRenderer } from './demo-renderer.ts';

const trace = JSON.parse(readFileSync(new URL('./sample-trace.json', import.meta.url), 'utf8')) as RawTrace;
const view = demoRenderer.render(trace);
const rawJson = JSON.stringify(trace.raw, null, 2);

const rubric: Rubric = {
  id: 'demo',
  version: 'v1',
  dimensions: [
    { key: 'helpfulness', label: 'Helpfulness', description: 'Did it actually answer the comparison?', scale: 'numeric', range: [1, 5] },
    { key: 'accuracy', label: 'Factual accuracy', scale: 'binary' },
    { key: 'tone', label: 'Tone', scale: 'categorical', options: ['great', 'ok', 'off'] },
  ],
};

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>tracelens demo</title><style>${CSS}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,'PingFang SC',sans-serif;background:var(--bg);color:var(--text);line-height:1.55}
.tl-demo{max-width:1180px;margin:0 auto;padding:24px}
.tl-h{display:flex;align-items:baseline;gap:10px}.tl-h h1{font-size:22px;margin:0}.tl-h .tag{background:#111827;color:#fff;font-size:11px;padding:2px 8px;border-radius:10px}
.tl-sub{color:var(--text2);margin:4px 0 18px}
.tl-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.tl-pane h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--text2);margin:0 0 8px}
.tl-raw{background:#0f172a;color:#cbd5e1;border-radius:12px;padding:14px;font-family:var(--mono);font-size:11.5px;overflow:auto;max-height:600px;white-space:pre-wrap;word-break:break-word}
.tl-after{margin-top:20px}
.tl-foot{margin-top:22px;color:var(--text2);font-size:12px;text-align:center}
@media(max-width:860px){.tl-cols{grid-template-columns:1fr}}
</style></head><body><div class="tl-demo">
<div class="tl-h"><h1>tracelens</h1><span class="tag">demo</span></div>
<p class="tl-sub">Same trace, two views — raw observability JSON vs. a human-reviewable conversation. No backend, no build.</p>
<div class="tl-cols">
<div class="tl-pane"><h2>&#9312; Raw trace · what an observability tool shows</h2><div class="tl-raw">${esc(rawJson)}</div></div>
<div class="tl-pane"><h2>&#9313; tracelens · human-reviewable conversation</h2>${renderConversationView(view)}</div>
</div>
<div class="tl-after"><h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--text2);margin:0 0 8px">&#9314; Score &amp; feed back into the loop</h2>${renderScorePanel(rubric)}</div>
<div class="tl-foot">tracelens · the human-judgment layer of the AI engineering loop</div>
</div></body></html>`;

writeFileSync(new URL('./index.html', import.meta.url), page);
console.log(`✅ wrote demo/index.html (${page.length} bytes)`);
