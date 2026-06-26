import type { FeedbackSink, Judgment } from '../../core/src/index.ts';

export interface LangfuseScoreSinkConfig {
  host: string;
  publicKey: string;
  secretKey: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Write each dimension's score from one Judgment back to Langfuse (POST /api/public/scores),
 * one score per dimension. This is the "score sink" in the AI engineering loop: human judgments
 * flow back into the data source. kind = 'score'.
 *
 * Dimension value type → Langfuse dataType: number→NUMERIC, boolean→BOOLEAN(0/1), string→CATEGORICAL.
 */
export function langfuseScoreSink(cfg: LangfuseScoreSinkConfig): FeedbackSink {
  const doFetch = cfg.fetch ?? globalThis.fetch;
  const base = cfg.host.replace(/\/+$/, '');
  const auth = 'Basic ' + Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString('base64');
  return {
    name: 'langfuse-score',
    kind: 'score',
    async submit(j: Judgment): Promise<void> {
      for (const [dim, value] of Object.entries(j.scores)) {
        const body: Record<string, unknown> = {
          traceId: j.traceId,
          name: `${j.rubricId}.${dim}`,
          comment: j.comment,
        };
        if (typeof value === 'number') {
          body.value = value;
        } else if (typeof value === 'boolean') {
          body.value = value ? 1 : 0;
          body.dataType = 'BOOLEAN';
        } else {
          body.value = String(value);
          body.dataType = 'CATEGORICAL';
        }
        const res = await doFetch(base + '/api/public/scores', {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`Langfuse score POST ${res.status} @ ${dim} — ${t.slice(0, 160)}`);
        }
      }
    },
  };
}
