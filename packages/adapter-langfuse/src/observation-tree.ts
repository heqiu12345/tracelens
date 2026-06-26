/**
 * Observation tree → process steps (Turn[]).
 *
 * Langfuse's `GET /api/public/traces/{id}` (TraceWithFullDetails) returns the agent's full
 * execution trace under `observations[]`: each observation has type (SPAN/GENERATION/EVENT/TOOL…),
 * name, startTime/endTime, input/output, parentObservationId (for building the tree), and more.
 * This module flattens it in chronological order into a step list with depth-based indentation,
 * and does its best to recognize "tool calls" as the toolCall primitive — letting reviewers see
 * the agent's "process" (routing, tool calls, sub-agents), not just the opening and closing turns.
 *
 * Designed to tolerate different instrumentation / Langfuse versions: every field is nullable,
 * and anything unrecognized degrades to a labeled node.
 */
import type { Turn, Block } from '../../core/src/index.ts';
import { extractText, jsonBlock } from './extract.ts';

/** Langfuse observation (a loose type that tolerates missing fields / different versions). */
export interface LangfuseObservation {
  id?: string;
  parentObservationId?: string | null;
  /** SPAN | GENERATION | EVENT | TOOL | AGENT | CHAIN | RETRIEVER | … */
  type?: string;
  name?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  level?: string | null;
  statusMessage?: string | null;
  model?: string | null;
  /** ms (provided by ObservationsView). */
  latency?: number | null;
  [k: string]: unknown;
}

/** A single tool call extracted from LLM output / messages (aligned with the UI's toolCall primitive). */
export interface ExtractedToolCall { name: string; args?: unknown; result?: unknown; }

function asObj(v: unknown): Record<string, any> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined;
}

function tryJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

/**
 * Extract tool calls from any LLM input/output, covering the mainstream formats:
 *   - Gemini / ADK : parts:[{functionCall:{name,args}} | {functionResponse:{name,response}}]
 *   - OpenAI       : tool_calls:[{function:{name,arguments}}] (top level / message / choices[].message)
 *   - Anthropic    : content:[{type:'tool_use',name,input} | {type:'tool_result',content}]
 * functionResponse / tool_result results are backfilled onto the matching call (by name, or by order).
 */
export function extractToolCalls(value: unknown): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];
  const results: { name?: string; response: unknown }[] = [];
  const o = asObj(value);

  // —— 1) Gemini / ADK parts —— collect every possible parts location
  const partsBuckets: unknown[] = [];
  if (o) {
    partsBuckets.push(o.parts, o.content?.parts, o.message?.parts, o.new_message?.parts);
    if (Array.isArray(o.candidates)) for (const c of o.candidates) partsBuckets.push(asObj(c)?.content?.parts);
  }
  if (Array.isArray(value)) for (const m of value) { const mo = asObj(m); if (mo) partsBuckets.push(mo.parts, mo.content?.parts); }
  for (const parts of partsBuckets) {
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      const po = asObj(p);
      if (!po) continue;
      const fc = po.functionCall ?? po.function_call;
      if (fc) calls.push({ name: String(fc.name ?? 'function'), args: tryJson(fc.args ?? fc.arguments) });
      const fr = po.functionResponse ?? po.function_response;
      if (fr) results.push({ name: fr.name, response: fr.response ?? fr.output });
    }
  }

  // —— 2) OpenAI tool_calls / Anthropic content blocks ——
  const messages: unknown[] = Array.isArray(value) ? value
    : Array.isArray(o?.messages) ? (o!.messages as unknown[])
    : Array.isArray(o?.choices) ? (o!.choices as unknown[]).map((c) => asObj(c)?.message)
    : o?.message ? [o.message]
    : o ? [o] : [];
  for (const m of messages) {
    const mo = asObj(m);
    if (!mo) continue;
    const tcs = mo.tool_calls;
    if (Array.isArray(tcs)) for (const tc of tcs) {
      const fn = asObj(tc)?.function;
      if (fn) calls.push({ name: String(fn.name ?? 'function'), args: tryJson(fn.arguments ?? fn.args) });
    }
    if (Array.isArray(mo.content)) for (const b of mo.content) {
      const bo = asObj(b);
      if (bo?.type === 'tool_use') calls.push({ name: String(bo.name ?? 'tool'), args: bo.input });
      if (bo?.type === 'tool_result') results.push({ name: undefined, response: bo.content });
    }
  }

  // —— backfill results onto their matching calls ——
  for (const r of results) {
    const match = r.name
      ? calls.find((c) => c.name === r.name && c.result === undefined)
      : calls.find((c) => c.result === undefined);
    if (match) match.result = r.response;
    else calls.push({ name: r.name ? String(r.name) : 'tool result', result: r.response });
  }
  return calls;
}

const TOOLISH = /\b(tool|function|retriev|search|api|query_db|fetch)\b/i;

function durationMs(o: LangfuseObservation): number | undefined {
  if (typeof o.latency === 'number' && o.latency >= 0) return Math.round(o.latency);
  const s = Date.parse(o.startTime ?? ''); const e = Date.parse(o.endTime ?? '');
  if (!Number.isNaN(s) && !Number.isNaN(e) && e >= s) return e - s;
  return undefined;
}

/**
 * Whether this observation is itself a tool execution: a TOOL type, or a SPAN that is a
 * "leaf + has input/output + has a tool-like name." role and blocks share this single check
 * so the two don't diverge.
 */
function isToolExec(o: LangfuseObservation, type: string, name: string, isLeaf: boolean): boolean {
  if (type === 'TOOL' || type === 'TOOL_CALL') return true;
  return isLeaf && type !== 'GENERATION' && o.input !== undefined && o.output !== undefined
    && (type === 'SPAN' || type === 'RETRIEVER' || TOOLISH.test(name));
}

/** observation → the blocks for this step. Distinguishes tool execution / LLM generation / structural node. */
function obsBlocks(o: LangfuseObservation, type: string, name: string, isLeaf: boolean): Block[] {
  const status: 'ok' | 'error' | 'pending' = String(o.level).toUpperCase() === 'ERROR' ? 'error' : 'ok';

  // 1) It's a tool execution in its own right
  if (isToolExec(o, type, name, isLeaf)) {
    return [{ type: 'toolCall', name, args: o.input, result: o.output, status }];
  }

  // 2) GENERATION: assistant output text + tool calls requested in output (results usually arrive in a later TOOL step)
  if (type === 'GENERATION') {
    const blocks: Block[] = [];
    const txt = extractText(o.output);
    if (txt) blocks.push({ type: 'markdown', markdown: txt });
    for (const c of extractToolCalls(o.output)) {
      blocks.push({ type: 'toolCall', name: c.name, args: c.args, result: c.result, status: c.result !== undefined ? status : 'pending' });
    }
    if (!blocks.length && o.output != null) blocks.push(jsonBlock(o.output));
    return blocks;
  }

  // 3) Structural node (container SPAN / AGENT / CHAIN / EVENT…): surface some readable info where possible, but don't force-fit input/output
  const blocks: Block[] = [];
  for (const c of extractToolCalls(o.output)) {
    blocks.push({ type: 'toolCall', name: c.name, args: c.args, result: c.result, status });
  }
  const ot = extractText(o.output) ?? extractText(o.input);
  if (ot) blocks.push({ type: 'markdown', markdown: ot });
  if (!blocks.length && o.statusMessage) blocks.push({ type: 'text', text: String(o.statusMessage) });
  return blocks; // may be empty → just a labeled structural node
}

function obsToTurn(o: LangfuseObservation, depth: number, isLeaf: boolean): Turn {
  const type = String(o.type ?? '').toUpperCase();
  const name = (o.name && String(o.name)) || type || 'step';
  const level = String(o.level ?? '').toUpperCase();
  const role: Turn['role'] = isToolExec(o, type, name, isLeaf)
    ? 'tool'
    : type === 'GENERATION' ? 'assistant' : 'system';
  const meta: Record<string, unknown> = {};
  if (type) meta.obsType = type;
  if (o.model) meta.model = String(o.model);
  const dur = durationMs(o);
  if (dur !== undefined) meta.durationMs = dur;
  if (level && level !== 'DEFAULT' && level !== 'DEBUG') meta.level = level;
  return { role, label: name, depth, blocks: obsBlocks(o, type, name, isLeaf), meta };
}

/**
 * observations array → process steps in chronological order (with depth-based indentation).
 * Builds the tree from parentObservationId, sorts siblings by ascending startTime (keeping the
 * original order when missing), and flattens via pre-order DFS.
 */
export function buildObservationTurns(observations: unknown): Turn[] {
  if (!Array.isArray(observations) || !observations.length) return [];
  const obs = observations.filter((o): o is LangfuseObservation => !!o && typeof o === 'object');
  if (!obs.length) return [];

  const byId = new Map<string, LangfuseObservation>();
  for (const o of obs) if (o.id) byId.set(o.id, o);
  const children = new Map<string | undefined, LangfuseObservation[]>();
  for (const o of obs) {
    const pid = o.parentObservationId && byId.has(o.parentObservationId) ? o.parentObservationId : undefined;
    (children.get(pid) ?? children.set(pid, []).get(pid)!).push(o);
  }
  const origIdx = new Map<LangfuseObservation, number>();
  obs.forEach((o, i) => origIdx.set(o, i));
  const chrono = (a: LangfuseObservation, b: LangfuseObservation): number => {
    const ta = Date.parse(a.startTime ?? ''); const tb = Date.parse(b.startTime ?? '');
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
    return origIdx.get(a)! - origIdx.get(b)!;
  };

  const turns: Turn[] = [];
  const visit = (node: LangfuseObservation, depth: number): void => {
    const kids = (children.get(node.id) ?? []).slice().sort(chrono);
    turns.push(obsToTurn(node, depth, kids.length === 0));
    for (const k of kids) visit(k, depth + 1);
  };
  for (const root of (children.get(undefined) ?? []).slice().sort(chrono)) visit(root, 0);
  return turns;
}
