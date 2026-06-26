/**
 * UI primitives (ConversationView) — one of tracelens's framework contracts.
 *
 * A Renderer turns any backend trace into a ConversationView; the framework only
 * understands these primitives and owns the rendering of their style. A Renderer emits
 * structured primitives only, never HTML/styles — this is the key to decoupling domain
 * logic from rendering style, and lets the same render result target different surfaces
 * such as web / terminal / screenshot.
 */

/** Colored label (e.g. ±tags in comparison tables, product badges). `tone` is a semantic color; the framework maps it to concrete color values per theme. */
export interface Badge {
  text: string;
  tone?: 'neutral' | 'positive' | 'attention' | 'negative' | 'info';
}

/** Table column header (the header itself can be rich content, e.g. a product card). */
export interface TableColumn {
  key: string;
  header: Block[];
}

/** Table cell = a group of primitives (supports mixing cards/text/tags, i.e. a cell in a multi-dimension comparison table). */
export interface TableCell {
  blocks: Block[];
}

/** Render primitive: the smallest building block a Renderer emits. A new surface only needs to implement this limited set. */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'markdown'; markdown: string }
  | { type: 'code'; code: string; lang?: string }
  | {
      type: 'card';
      title?: string;
      subtitle?: string;
      body?: string;
      imageUrl?: string;
      href?: string;
      badges?: Badge[];
    }
  | {
      type: 'table';
      caption?: string;
      /** Header text for the "dimension column" (optional). */
      rowHeaderLabel?: string;
      columns: TableColumn[];
      /** Each row: an optional row label + cells aligned with `columns`. */
      rows: { label?: string; cells: TableCell[] }[];
    }
  | {
      type: 'toolCall';
      name: string;
      args?: unknown;
      result?: unknown;
      status?: 'ok' | 'error' | 'pending';
    }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'tags'; badges: Badge[] }
  | { type: 'divider' };

/** Conversation role. */
export type Role = 'user' | 'assistant' | 'system' | 'tool';

/** A single conversation turn (or message); also used to represent one step in an agent's process tree (observation). */
export interface Turn {
  role: Role;
  /** Display label, e.g. "Turn 1" / an agent name / an observation name. */
  label?: string;
  blocks: Block[];
  /**
   * Nesting depth: used for indentation in an agent's process tree (observation tree), 0 = top level.
   * Omitted for ordinary conversation turns (equivalent to 0).
   */
  depth?: number;
  /**
   * Domain / step metadata. Conventional visualization keys (rendered by review-ui as step-header badges):
   *   obsType(SPAN/GENERATION/TOOL…) · model · durationMs · level(ERROR…) · ts.
   * Remaining keys are used freely by the domain renderer (e.g. reply_agent, latency_ms).
   */
  meta?: Record<string, unknown>;
}

/** A Renderer's output: a human-readable conversation view. */
export interface ConversationView {
  title?: string;
  /** The conversation itself (user question ↔ final answer), readable by anyone. */
  turns: Turn[];
  /**
   * The agent's "process": an ordered list of steps — observations / tool calls / sub-agent call tree —
   * using Turn.depth to express parent-child indentation. Kept separate from `turns` so the review UI
   * can collapse it. This moves review from "understanding the input and output" further to
   * "auditing the agent's behavior" — which is where it goes beyond a native observability view.
   */
  steps?: Turn[];
  /** Domain metadata that can be shown in the review UI (version, entry_scene…). */
  meta?: Record<string, unknown>;
}
