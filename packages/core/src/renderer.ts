import type { RawTrace } from './datasource.ts';
import type { ConversationView } from './primitives.ts';

/**
 * Renderer plugin — tracelens's irreplaceable core differentiator.
 *
 * Translates a backend's raw trace into a human-readable ConversationView. Write a Renderer for
 * your own agent and tracelens fits your project. It serves the "read traces yourself" part of the
 * AI engineering loop: making traces efficient to read, and readable by non-technical teammates too.
 */
export interface Renderer {
  name: string;
  /** Whether it can handle this trace (routing across renderers by tag/metadata/structure). Omitted means it is treated as a fallback candidate. */
  matches?(trace: RawTrace): boolean;
  render(trace: RawTrace): ConversationView;
}

/** Multi-renderer routing: pick the first one that matches, otherwise use a fallback renderer (e.g. raw / openai-messages). */
export interface RendererRegistry {
  register(r: Renderer): void;
  resolve(trace: RawTrace): Renderer;
}
