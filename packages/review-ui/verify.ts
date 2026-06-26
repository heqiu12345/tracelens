/**
 * review-ui self-check: rendering correctness of renderConversationView / renderScorePanel + XSS escaping.
 * Run: node packages/review-ui/verify.ts
 */
import type { ConversationView, Rubric } from '../core/src/index.ts';
import { renderConversationView, renderScorePanel } from './src/html.ts';

let fail = 0;
function ok(cond: boolean, name: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail++;
}
function has(hay: string, needle: string, name: string): void {
  ok(hay.includes(needle), `${name} ⊇ ${JSON.stringify(needle)}`);
}

// ── text / markdown / XSS ──
const v1: ConversationView = {
  turns: [
    { role: 'user', blocks: [{ type: 'text', text: 'hello <script>alert(1)</script>' }] },
    { role: 'assistant', blocks: [{ type: 'markdown', markdown: '**bold** and `code`' }] },
  ],
};
const h1 = renderConversationView(v1);
has(h1, 'tl-turn tl-user', 'user turn class');
ok(!h1.includes('<script>alert'), 'XSS: raw <script> NOT present');
has(h1, '&lt;script&gt;', 'XSS: escaped form present');
has(h1, '<strong>bold</strong>', 'markdown bold');
has(h1, '<code>code</code>', 'markdown inline code');

// ── table / card / badge ──
const v2: ConversationView = {
  turns: [{
    role: 'assistant',
    blocks: [{
      type: 'table',
      rowHeaderLabel: 'Dim',
      columns: [
        { key: 'c0', header: [{ type: 'card', title: 'A' }] },
        { key: 'c1', header: [{ type: 'card', title: 'B' }] },
      ],
      rows: [{
        label: 'Price',
        cells: [
          { blocks: [{ type: 'card', title: '$1', badges: [{ text: 'cheap', tone: 'positive' }] }] },
          { blocks: [{ type: 'card', title: '$2' }] },
        ],
      }],
    }],
  }],
};
const h2 = renderConversationView(v2);
has(h2, '<table class="tl-table"', 'table rendered');
has(h2, 'Price', 'row label rendered');
has(h2, 'tl-badge', 'badge rendered');
has(h2, '#0a7f5b', 'positive tone color applied');

// ── toolCall ──
const v3: ConversationView = {
  turns: [{ role: 'tool', blocks: [{ type: 'toolCall', name: 'search', args: { q: 'x' }, status: 'ok' }] }],
};
const h3 = renderConversationView(v3);
has(h3, 'tl-tool', 'toolCall block rendered');
has(h3, 'search', 'toolCall name rendered');

// ── steps (agent process tree): collapsible section + depth indentation + step badges + tool result ──
const v4: ConversationView = {
  turns: [{ role: 'user', blocks: [{ type: 'text', text: 'go' }] }],
  steps: [
    { role: 'system', label: 'agent.run', depth: 0, blocks: [], meta: { obsType: 'SPAN', durationMs: 1400 } },
    { role: 'tool', label: 'search', depth: 1, blocks: [{ type: 'toolCall', name: 'search', args: { q: 'x' }, result: { hits: 3 }, status: 'ok' }], meta: { obsType: 'SPAN', durationMs: 380 } },
    { role: 'assistant', label: 'responder', depth: 1, blocks: [{ type: 'markdown', markdown: 'done' }], meta: { obsType: 'GENERATION', model: 'gpt-x' } },
  ],
};
const h4 = renderConversationView(v4);
has(h4, 'tl-steps', 'steps section rendered');
has(h4, 'Agent process · 3 steps', 'steps summary with count');
has(h4, 'margin-left:16px', 'depth → indentation');
has(h4, 'tl-mb-type', 'meta type badge rendered');
has(h4, '1.4s', 'duration formatted to seconds');
has(h4, '380ms', 'duration formatted to ms');
has(h4, 'gpt-x', 'model badge rendered');
has(h4, 'hits', 'tool result rendered inside a step');
// observations are always expanded (no per-step collapse) so no observation data is hidden; the section itself is open by default
has(h4, '<details class="tl-steps" open>', 'process section expanded by default (observation data visible)');
has(h4, 'agent.run', 'empty-body step still shows its label');
ok(!h4.includes('<details class="tl-step"'), 'observations are NOT per-step collapsed (always expanded)');
// when there are no steps, the process section must not appear (backward compatible)
ok(!renderConversationView(v1).includes('tl-steps'), 'no steps → no Agent process section');

// ── score panel ──
const rubric: Rubric = {
  id: 'r', version: 'v1',
  dimensions: [
    { key: 'h', label: 'Helpful', scale: 'numeric', range: [1, 3] },
    { key: 'a', label: 'Acc', scale: 'binary' },
    { key: 't', label: 'Tone', scale: 'categorical', options: ['good', 'bad'] },
  ],
};
const sp = renderScorePanel(rubric);
has(sp, 'r@v1', 'rubric id@version');
has(sp, 'Helpful', 'numeric dim label');
ok((sp.match(/tl-opt/g) ?? []).length >= 7, 'option buttons (3 numeric + 2 binary + 2 categorical)');

console.log(fail ? `\n❌ ${fail} FAILED` : '\n✅ review-ui self-check passed (rendering + XSS escaping)');
process.exit(fail ? 1 : 0);
