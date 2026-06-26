import type { Renderer } from '../../../packages/core/src/renderer.ts';
import type { RawTrace } from '../../../packages/core/src/datasource.ts';
import type {
  ConversationView, Turn, Block, TableCell, TableColumn, Badge,
} from '../../../packages/core/src/primitives.ts';
import { splitBotReplySegments, type RowNode } from './tags.ts';

const CROWD_LABEL: Record<string, string> = { high: 'Crowded', medium: 'Moderate', low: 'Quiet' };

function badgeOf(o: Record<string, unknown>): Badge | undefined {
  if (typeof o.positive_tag === 'string') return { text: o.positive_tag, tone: 'positive' };
  if (typeof o.attribute_tag === 'string') return { text: o.attribute_tag, tone: 'attention' };
  if (typeof o.negative_tag === 'string') return { text: o.negative_tag, tone: 'negative' };
  return undefined;
}

/** Map a comparison-table cell value (by row.type) into a UI primitive. */
function cellOf(type: string, v: unknown): TableCell {
  if (v == null) return { blocks: [{ type: 'text', text: '--' }] };
  if (type === 'product' || type === 'card') {
    const o = v as Record<string, unknown>;
    const id = typeof v === 'string' ? v : String(o.product_id ?? o.title ?? '');
    return { blocks: [{ type: 'card', title: `🎫 ${id}` }] };
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const badge = badgeOf(o);
    if (type === 'pace') {
      return { blocks: [{ type: 'card', title: String(o.label ?? o.level ?? ''), body: String(o.text ?? '') }] };
    }
    if (type === 'crowd') {
      return { blocks: [{ type: 'card', title: CROWD_LABEL[String(o.level)] ?? String(o.level ?? ''), body: String(o.text ?? '') }] };
    }
    // block (default): title + text + colored tag
    return {
      blocks: [{
        type: 'card',
        title: String(o.title ?? ''),
        body: String(o.text ?? ''),
        badges: badge ? [badge] : undefined,
      }],
    };
  }
  return { blocks: [{ type: 'text', text: String(v) }] };
}

/** rows → table Block: product/pin rows become column headers, the rest become data rows. */
function rowsToTable(rows: RowNode[]): Block | undefined {
  let header: unknown[] | null = null;
  const body: RowNode[] = [];
  for (const r of rows) {
    if (r.type === 'product' || r.type === 'card') header = r.values;
    else body.push(r);
  }
  const nCols = header ? header.length : Math.max(0, ...body.map((r) => r.values?.length ?? 0));
  if (!nCols) return undefined;

  const columns: TableColumn[] = [];
  for (let i = 0; i < nCols; i++) {
    const id = header ? String(header[i]) : `Option ${i + 1}`;
    columns.push({ key: `c${i}`, header: [{ type: 'card', title: `🎫 ${id}` }] });
  }
  const tableRows = body.map((r) => ({
    label: r.name,
    cells: Array.from({ length: nCols }, (_, i) => cellOf(r.type, (r.values ?? [])[i])),
  }));
  return { type: 'table', rowHeaderLabel: 'Dimension', columns, rows: tableRows };
}

function botResponseToBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const seg of splitBotReplySegments(text)) {
    if (seg.kind === 'table') {
      const t = rowsToTable(seg.rows);
      if (t) blocks.push(t);
    } else if (seg.content.trim()) {
      blocks.push({ type: 'markdown', markdown: seg.content.trim() });
    }
  }
  return blocks;
}

interface AgentTurn {
  role?: string;
  query?: string;
  botResponse?: string;
  replyAgent?: string;
}

/**
 * A reference Renderer for a chatbot that embeds a custom tag protocol in its replies.
 *
 * The chatbot's replies embed a set of domain tags: a multi-dimensional comparison table
 * (<table>/<row>, with cell types such as block/pace/crowd), product references, and more.
 * This example proves that the tracelens contract can handle a genuinely complex agent —
 * mapping the domain protocol cleanly into UI primitives (table / card / colored badge).
 * The core framework carries zero domain logic; all of it lives in this plugin.
 */
export const customTagChatbotRenderer: Renderer = {
  name: 'custom-tag-chatbot',
  matches(trace: RawTrace): boolean {
    return (trace.tags ?? []).some((t) => t.includes('chatbot'));
  },
  render(trace: RawTrace): ConversationView {
    const raw = (trace.raw ?? {}) as { turns?: AgentTurn[] };
    const turns: Turn[] = [];
    for (const t of raw.turns ?? []) {
      if (t.query) turns.push({ role: 'user', blocks: [{ type: 'text', text: t.query }] });
      if (t.botResponse != null) {
        turns.push({
          role: 'assistant',
          label: t.replyAgent,
          blocks: botResponseToBlocks(t.botResponse),
          meta: t.replyAgent ? { replyAgent: t.replyAgent } : undefined,
        });
      }
    }
    return { title: `session ${trace.sessionId ?? trace.id}`, turns, meta: { tags: trace.tags } };
  },
};
