/**
 * Built-in mock DataSource (demo mode): a few Langfuse-shaped traces, with tags/userId/search filtering.
 * Lets the app run, be clicked through, and be scored without any credentials configured.
 */
import type {
  DataSource, RawTrace, Page, TraceFilter, PageReq, ScoreRecord, ScoreFilter,
} from '../../../packages/core/src/index.ts';

const TRACES: RawTrace[] = [
  {
    id: 'demo-1', sessionId: 's-001', userId: 'alice', timestamp: '2026-06-24T10:00:00Z', tags: ['prod', 'qa-agent'],
    raw: {
      input: [{ role: 'user', content: 'What is the capital of France?' }],
      output: 'The capital of France is **Paris**.',
    },
  },
  {
    id: 'demo-2', sessionId: 's-002', userId: 'bob', timestamp: '2026-06-24T11:30:00Z', tags: ['prod', 'support-agent'],
    raw: {
      input: [
        { role: 'system', content: 'You are a helpful support agent.' },
        { role: 'user', content: 'My order #4471 has not arrived yet.' },
      ],
      output: "I'm sorry about the delay on order #4471 — it's in transit and expected tomorrow. Want me to email you the tracking link?",
    },
  },
  {
    id: 'demo-3', sessionId: 's-003', userId: 'alice', timestamp: '2026-06-24T12:15:00Z', tags: ['staging', 'tool-agent'],
    raw: {
      input: [{ role: 'user', content: 'Compare plan A and plan B for a small team.' }],
      output: {
        type: 'comparison', winner: 'A',
        reasons: ['cheaper per seat', 'more storage'],
        note: 'structured output with no specialized renderer — shown as JSON; this is exactly when you write a Renderer',
      },
    },
  },
  {
    // Multi-step agent: the top-level input/output is readable (the conversation), while the
    // observation tree shows the "process" — the router LLM decides to call a tool → the tool
    // runs (with args + results) → the LLM produces the final reply.
    id: 'demo-4', sessionId: 's-004', userId: 'bob', timestamp: '2026-06-24T13:40:00Z', tags: ['prod', 'discover-agent'],
    raw: {
      input: [{ role: 'user', content: 'Find me a hiking tour near Kyoto under ¥10000.' }],
      output: 'I found a great option: **Mt. Daimonji Sunset Hike** (¥6,800) — a 3-hour guided evening hike with panoramic city views, well under your budget. Want me to check availability?',
      observations: [
        {
          id: 'o1', type: 'SPAN', name: 'discover_agent.run', parentObservationId: null,
          startTime: '2026-06-24T13:40:00.000Z', endTime: '2026-06-24T13:40:01.400Z', latency: 1400,
        },
        {
          id: 'o2', type: 'GENERATION', name: 'router', model: 'gemini-2.0-flash', parentObservationId: 'o1',
          startTime: '2026-06-24T13:40:00.100Z', endTime: '2026-06-24T13:40:00.500Z', latency: 400,
          input: { parts: [{ text: 'Find me a hiking tour near Kyoto under ¥10000.' }] },
          output: { parts: [{ functionCall: { name: 'search_activities', args: { location: 'Kyoto', category: 'hiking', max_price: 10000 } } }] },
        },
        {
          id: 'o3', type: 'SPAN', name: 'search_activities', parentObservationId: 'o1',
          startTime: '2026-06-24T13:40:00.520Z', endTime: '2026-06-24T13:40:00.900Z', latency: 380,
          input: { location: 'Kyoto', category: 'hiking', max_price: 10000 },
          output: { results: [{ title: 'Mt. Daimonji Sunset Hike', price: 6800, duration_h: 3 }, { title: 'Arashiyama Bamboo & Hills Walk', price: 9200, duration_h: 4 }] },
        },
        {
          id: 'o4', type: 'GENERATION', name: 'responder', model: 'gemini-2.0-flash', parentObservationId: 'o1',
          startTime: '2026-06-24T13:40:00.920Z', endTime: '2026-06-24T13:40:01.380Z', latency: 460,
          output: { parts: [{ text: 'I found a great option: **Mt. Daimonji Sunset Hike** (¥6,800) — a 3-hour guided evening hike with panoramic city views, well under your budget.' }] },
        },
      ],
    },
  },
];

/**
 * Paired human + LLM-judge samples: covering the three dimensions helpfulness(numeric)/accuracy(binary)/tone(categorical),
 * with agreement and disagreement spread across traces (e.g. demo-3 helpfulness human 2 / judge 5 → severe disagreement),
 * so the calibration dashboard is visible out of the box in demo mode.
 * Every record carries a traceId (needed by listScores/pairing); SCORES is still grouped by traceId, so getScores(id) is unchanged.
 */
const SCORES: Record<string, ScoreRecord[]> = {
  'demo-1': [
    { name: 'default.helpfulness', value: 5, source: 'human', traceId: 'demo-1', comment: 'Answered Paris directly — concise and accurate' },
    { name: 'default.helpfulness', value: 5, source: 'eval', traceId: 'demo-1', comment: 'correct and concise' },
    { name: 'default.accuracy', value: true, source: 'human', traceId: 'demo-1' },
    { name: 'default.accuracy', value: true, source: 'eval', traceId: 'demo-1' },
  ],
  'demo-2': [
    { name: 'default.helpfulness', value: 4, source: 'human', traceId: 'demo-2', comment: 'Proactively offered the tracking link — thoughtful' },
    { name: 'default.helpfulness', value: 4, source: 'eval', traceId: 'demo-2', comment: 'proactive and on-topic' },
    { name: 'default.tone', value: 'great', source: 'human', traceId: 'demo-2', comment: 'Warm and apologetic tone' },
    { name: 'default.tone', value: 'ok', source: 'eval', traceId: 'demo-2', comment: 'polite but slightly generic' },
  ],
  'demo-3': [
    { name: 'default.helpfulness', value: 2, source: 'human', traceId: 'demo-3', comment: "Didn't answer the question — never actually weighed the trade-offs between the two plans" },
    { name: 'default.helpfulness', value: 5, source: 'eval', traceId: 'demo-3', comment: 'structured comparison, looks thorough' },
    { name: 'default.accuracy', value: true, source: 'human', traceId: 'demo-3' },
    { name: 'default.accuracy', value: false, source: 'eval', traceId: 'demo-3', comment: 'storage claim unverified' },
  ],
};

export function mockDataSource(): DataSource {
  return {
    name: 'mock',
    async listTraces(filter: TraceFilter, page: PageReq): Promise<Page<RawTrace>> {
      let items = TRACES.slice();
      if (filter.tags?.length) items = items.filter((t) => (t.tags ?? []).some((x) => filter.tags!.includes(x)));
      if (filter.userId) items = items.filter((t) => t.userId === filter.userId);
      if (filter.search) {
        const q = filter.search.toLowerCase();
        items = items.filter((t) => JSON.stringify(t.raw).toLowerCase().includes(q));
      }
      const start = (page.page - 1) * page.limit;
      return { items: items.slice(start, start + page.limit), total: items.length, page: page.page, limit: page.limit };
    },
    async getTrace(id: string): Promise<RawTrace> {
      const t = TRACES.find((x) => x.id === id);
      if (!t) throw new Error(`mock trace not found: ${id}`);
      return t;
    },
    async getScores(traceId: string): Promise<ScoreRecord[]> {
      return SCORES[traceId] ?? [];
    },
    async listScores(filter: ScoreFilter, page: PageReq): Promise<Page<ScoreRecord>> {
      const all = Object.values(SCORES).flat();
      const items = all.filter((s) => (!filter.name || s.name === filter.name) && (!filter.traceId || s.traceId === filter.traceId) && (!filter.source || s.source === filter.source));
      const start = (page.page - 1) * page.limit;
      return { items: items.slice(start, start + page.limit), total: items.length, page: page.page, limit: page.limit };
    },
  };
}
