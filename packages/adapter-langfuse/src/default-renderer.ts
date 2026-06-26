import type { Renderer, RawTrace, ConversationView, Turn } from '../../core/src/index.ts';
import { extractText, jsonBlock, contentBlocks, messagesOf, roleToTurn } from './extract.ts';
import { buildObservationTurns } from './observation-tree.ts';

/**
 * Fallback renderer (works out of the box). Renders any Langfuse trace into a readable
 * conversation plus the agent process:
 *   - Conversation (turns): trace.input/output → OpenAI messages / ADK·Gemini parts / common single fields / plain text.
 *   - Process (steps): the trace.observations tree → a list of steps (routing, LLM generations,
 *     tool calls, sub-agents). This is the key to going "from understanding input/output to
 *     reviewing agent behavior," and is where it goes beyond the native observability view.
 *
 * When the conversation still yields no structured text and there are no observations, it
 * degrades to JSON and flags `meta.degraded=true` — the review app uses this to prompt
 * "this trace has no dedicated renderer, please write one following the examples."
 */
export const langfuseDefaultRenderer: Renderer = {
  name: 'langfuse-default',
  render(trace: RawTrace): ConversationView {
    const raw = (trace.raw ?? {}) as { input?: unknown; output?: unknown; observations?: unknown };
    const turns: Turn[] = [];

    const inMsgs = messagesOf(raw.input);
    if (inMsgs) {
      for (const m of inMsgs) turns.push({ role: roleToTurn(m.role), blocks: contentBlocks(m.content) });
    } else if (raw.input != null) {
      const t = extractText(raw.input);
      turns.push({ role: 'user', blocks: t ? [{ type: 'markdown', markdown: t }] : [jsonBlock(raw.input)] });
    }

    const outMsgs = messagesOf(raw.output);
    if (outMsgs) {
      for (const m of outMsgs) turns.push({ role: roleToTurn(m.role), blocks: contentBlocks(m.content) });
    } else if (raw.output != null) {
      const t = extractText(raw.output);
      turns.push({ role: 'assistant', blocks: t ? [{ type: 'markdown', markdown: t }] : [jsonBlock(raw.output)] });
    }

    // Agent process: the observation tree → steps (expanded when present).
    const steps = buildObservationTurns(raw.observations);

    // Degradation check: the conversation has content but can only be shown as JSON, and there
    // are no process steps either → prompt the user to write a dedicated renderer.
    // When an observation process tree exists, it's far from "a blob of JSON" (the process is
    // readable), so it doesn't count as degraded.
    const convDegraded = turns.some((tn) => tn.blocks.some((b) => b.type === 'code'));
    const degraded = convDegraded && steps.length === 0;

    return {
      title: `trace ${trace.id}`,
      turns,
      steps: steps.length ? steps : undefined,
      meta: { tags: trace.tags, userId: trace.userId, renderer: 'langfuse-default', degraded, stepCount: steps.length },
    };
  },
};
