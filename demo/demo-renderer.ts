/**
 * Demo Renderer (neutral, general-purpose): translates an OpenAI-messages-style agent trace
 * with tool calls + structured output into a ConversationView. Showcases UI primitives such as
 * tool-call, comparison table, and colored tags.
 *
 * Business-agnostic — any agent that emits structured JSON can write its own Renderer this way.
 */
import type {
  Renderer, RawTrace, ConversationView, Turn, Block, TableCell, Badge,
} from '../packages/core/src/index.ts';

interface ToolCall { id?: string; function: { name: string; arguments?: string }; }
interface Msg { role: string; content?: string; tool_calls?: ToolCall[]; tool_call_id?: string; }

interface CmpCell { title?: string; text?: string; tag?: string; }
interface CmpRow { dim: string; cells: CmpCell[]; }
interface Comparison { type: string; options: string[]; rows: CmpRow[]; summary?: string; }

const TAG_TONE: Record<string, Badge['tone']> = {
  easy: 'positive', good: 'positive', intense: 'negative', pricey: 'negative', note: 'attention',
};

function tryParse(s?: string): unknown {
  if (s == null) return undefined;
  try { return JSON.parse(s); } catch { return s; }
}

function comparisonToTable(c: Comparison): Block {
  const columns = c.options.map((o, i) => ({ key: `c${i}`, header: [{ type: 'card', title: o } as Block] }));
  const rows = c.rows.map((r) => ({
    label: r.dim,
    cells: r.cells.map((cl): TableCell => {
      const badges: Badge[] = cl.tag ? [{ text: cl.tag, tone: TAG_TONE[cl.tag] ?? 'neutral' }] : [];
      return { blocks: [{ type: 'card', title: cl.title ?? '', body: cl.text, badges: badges.length ? badges : undefined }] };
    }),
  }));
  return { type: 'table', rowHeaderLabel: 'Dimension', columns, rows };
}

export const demoRenderer: Renderer = {
  name: 'structured-agent',
  render(trace: RawTrace): ConversationView {
    const msgs = (((trace.raw ?? {}) as { messages?: Msg[] }).messages) ?? [];
    const turns: Turn[] = [];
    for (const m of msgs) {
      if (m.role === 'user') {
        turns.push({ role: 'user', blocks: [{ type: 'text', text: m.content ?? '' }] });
      } else if (m.role === 'assistant' && m.tool_calls?.length) {
        turns.push({
          role: 'assistant',
          blocks: m.tool_calls.map((tc): Block => ({
            type: 'toolCall', name: tc.function.name, args: tryParse(tc.function.arguments), status: 'ok',
          })),
        });
      } else if (m.role === 'tool') {
        turns.push({ role: 'tool', blocks: [{ type: 'toolCall', name: 'tool result', result: tryParse(m.content), status: 'ok' }] });
      } else if (m.role === 'assistant' && m.content) {
        const parsed = tryParse(m.content);
        if (parsed && typeof parsed === 'object' && (parsed as Comparison).type === 'comparison') {
          const c = parsed as Comparison;
          const blocks: Block[] = [comparisonToTable(c)];
          if (c.summary) blocks.push({ type: 'markdown', markdown: c.summary });
          turns.push({ role: 'assistant', blocks });
        } else {
          turns.push({ role: 'assistant', blocks: [{ type: 'markdown', markdown: m.content }] });
        }
      }
    }
    return { title: 'Structured agent · trip comparison', turns };
  },
};
