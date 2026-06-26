/**
 * Contract self-check: use the custom-tag chatbot renderer to render a trace whose replies
 * embed a custom tag protocol into a ConversationView, asserting that the multi-dimensional
 * comparison table maps correctly into UI primitives with no leftover protocol tags.
 *
 * Run: node examples/custom-tag-chatbot/verify.ts (node >= 22.6, native TS type-stripping)
 */
import { readFileSync } from 'node:fs';
import type { RawTrace } from '../../packages/core/src/datasource.ts';
import { customTagChatbotRenderer } from './src/renderer.ts';

const trace = JSON.parse(
  readFileSync(new URL('./fixtures/compare-trace.json', import.meta.url), 'utf8'),
) as RawTrace;

const view = customTagChatbotRenderer.render(trace);

let fail = 0;
function ok(cond: boolean, name: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail++;
}

ok(customTagChatbotRenderer.matches?.(trace) === true, 'renderer.matches hits the chatbot tag');
ok(view.turns.length >= 2, 'turns: user question + assistant reply');

const assistant = view.turns.find((t) => t.role === 'assistant');
const table = assistant?.blocks.find((b) => b.type === 'table');
ok(!!table, 'assistant contains a table primitive (multi-dimensional comparison table parsed)');

if (table && table.type === 'table') {
  ok(table.columns.length === 2, '2 product column headers (pin row → columns)');
  ok(table.rows.length === 2, '2 dimension rows (Duration / Pace)');
  const hasCard = table.rows.some((r) => r.cells.some((c) => c.blocks.some((b) => b.type === 'card')));
  ok(hasCard, 'cells contain a card primitive (block/pace → card)');
  const hasBadge = table.rows.some((r) =>
    r.cells.some((c) => c.blocks.some((b) => b.type === 'card' && (b.badges?.length ?? 0) > 0)),
  );
  ok(hasBadge, 'negative_tag → colored badge');
}

const dump = JSON.stringify(view);
ok(!dump.includes('<row') && !dump.includes('<table'), 'no leftover <row>/<table> protocol tags');

console.log(
  fail
    ? `\n❌ ${fail} FAILED`
    : '\n✅ Contract self-check passed: a chatbot trace carrying a custom tag protocol can be cleanly implemented as a Renderer → ConversationView',
);
process.exit(fail ? 1 : 0);
