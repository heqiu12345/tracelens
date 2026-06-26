import type { Block, Turn } from '../../core/src/index.ts';

/**
 * Deeply extract readable text from common LLM trace shapes, avoiding "a whole blob of JSON"
 * wherever possible:
 *   - ADK / Gemini : { parts:[{text}] } / { new_message:{parts} } / { content:{parts} }
 *   - OpenAI       : { choices:[{message:{content}}] } / { message:{content} }
 *   - Common single fields : text / content / output / response / answer / prompt / input / query
 * Nothing extractable → returns undefined (the caller degrades to a JSON code block and flags degraded).
 *
 * Shared by default-renderer (conversation) and observation-tree (process steps).
 */
export function extractText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, any>;
  const parts = o.parts ?? o.new_message?.parts ?? o.content?.parts;
  if (Array.isArray(parts)) {
    const txt = parts.map((p) => (typeof p === 'string' ? p : p?.text)).filter(Boolean).join('\n').trim();
    if (txt) return txt;
  }
  const cc = o.choices?.[0]?.message?.content ?? o.message?.content;
  if (typeof cc === 'string' && cc.trim()) return cc;
  for (const k of ['text', 'content', 'output', 'response', 'answer', 'prompt', 'input', 'query']) {
    if (typeof o[k] === 'string' && o[k].trim()) return o[k];
  }
  return undefined;
}

/** Wrap any value in a JSON code block (the degraded rendering when no readable text can be extracted). */
export function jsonBlock(v: unknown): Block {
  return { type: 'code', code: JSON.stringify(v, null, 2), lang: 'json' };
}

/** content → blocks: use markdown when text can be extracted, otherwise degrade to a JSON code block. */
export function contentBlocks(content: unknown): Block[] {
  if (content == null) return [];
  const t = extractText(content);
  return t ? [{ type: 'markdown', markdown: t }] : [jsonBlock(content)];
}

interface Msg { role?: string; content?: unknown; }

/** Recognize input/output as a message array (`[...]` or `{messages:[...]}`), otherwise undefined. */
export function messagesOf(io: unknown): Msg[] | undefined {
  if (Array.isArray(io)) return io as Msg[];
  if (io && typeof io === 'object' && Array.isArray((io as { messages?: unknown }).messages)) {
    return (io as { messages: Msg[] }).messages;
  }
  return undefined;
}

/** Backend role string → ConversationView Role. */
export function roleToTurn(role: string | undefined): Turn['role'] {
  if (role === 'user' || role === 'human') return 'user';
  if (role === 'system') return 'system';
  if (role === 'tool' || role === 'function') return 'tool';
  return 'assistant';
}
