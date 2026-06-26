# tracelens

> Make your LLM traces human-reviewable. A pluggable rendering & scoring layer on top of Langfuse.

**English** · [简体中文](README.zh-CN.md)

![tracelens — raw trace turned into a human-reviewable, scorable conversation](docs/hero.svg)

**Zero runtime dependencies · runs on Node ≥ 22.18 (native TypeScript, no build) · `typecheck` + self-checks run in CI.**

## Try it in 30s (zero install)

No `npm install`, no build step — just Node ≥ 22.18:

```bash
git clone https://github.com/heqiu12345/tracelens.git tracelens && cd tracelens
node apps/review-server/src/server.ts   # → http://localhost:4317  (built-in demo data)
# …or a static, backend-free before/after page:
node demo/build.ts && open demo/index.html
```

## The problem

Observability platforms like **Langfuse** store your agent traces — but render them as raw observation trees and JSON. For complex agents (tool chains, structured/custom output, multi-turn conversations) and for **non-engineer reviewers** (PM / QA / ops / domain experts), that's unreadable. *You can't review what you can't read.*

**tracelens** is the missing last mile: a pluggable layer that turns any trace into a **human-readable conversation**, lets domain experts **score it against a versioned rubric**, and **feeds those judgments back into the loop**.

It does **not** reinvent Langfuse. Langfuse stays the backend (storage, querying). tracelens owns only the part Langfuse will never do for you: **domain rendering + human judgment**.

## Why — the AI engineering loop

The loop `trace → monitor → build datasets → experiment → evaluate → trace` is increasingly automatable by agents. But as the [Langfuse blog "AI is eating AI engineering"](https://langfuse.com/blog/2026-06-09-ai-is-eating-ai-engineering) argues, automating *past the point where you can still vouch for the output* ships **agent slop**. The durable edge is **"your sense of what good looks like, and the care you put into teaching it."**

tracelens is the **human-judgment layer** of that loop:

- **read traces yourself** → made efficient & non-engineer-friendly (Renderer)
- **review a sample + calibrate** → a real workflow (Rubric + review UI)
- inject judgments back into **datasets** and **judge-calibration** (FeedbackSink)

## Architecture — framework + plugins

The core is ~zero-domain. Everything domain-specific lives in a plugin behind **4 contracts**:

| Contract | Role |
|---|---|
| `DataSource` | fetch / write traces — first adapter: **Langfuse** |
| `Renderer` | trace → human-readable `ConversationView` *(the core differentiator)* |
| `Rubric` | versioned scoring dimensions, routed by trace tag/version |
| `FeedbackSink` | route judgments → score / dataset / judge-calibration |

Renderers emit **UI primitives** (`text · markdown · table · card · tool-call · image`) — never HTML — so one render works across web / terminal / screenshots.

**What "readable" means in practice:** the built-in default renderer reads common shapes out of the box — OpenAI `messages`/`choices`, ADK/Gemini `parts`, plain text — **and unfolds the Langfuse observation tree into a step-by-step "agent process" view**: every LLM call, tool call (name · args · result), and sub-agent shown in order and indented by nesting. That's the leap from *reading the final answer* to *reviewing how the agent got there* — the part raw observation trees make tedious. For a **domain protocol** (custom tags, bespoke tool chains) you write a ~30-line `Renderer` (see [`examples/custom-tag-chatbot`](examples/custom-tag-chatbot)). Until you do, the app shows a best-effort view **and tells you a renderer is missing** — never a silent wall of JSON.

## Quickstart — connect your Langfuse

```bash
export LANGFUSE_HOST=https://cloud.langfuse.com   # or your self-hosted URL
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
node packages/adapter-langfuse/smoke.ts           # lists recent traces + renders one
```

```ts
// packages are workspace-internal today (not yet published) — import from source paths,
// or wire up your own bundling. npm publishing is on the roadmap.
import { langfuseDataSourceFromEnv, langfuseDefaultRenderer } from '@tracelens/adapter-langfuse';
import { renderConversationView } from '@tracelens/review-ui';

const ds = langfuseDataSourceFromEnv();                       // reads LANGFUSE_* env
const { items } = await ds.listTraces({ tags: ['prod'] }, { page: 1, limit: 20 });
const view = langfuseDefaultRenderer.render(await ds.getTrace(items[0].id));
const html = renderConversationView(view);                    // → drop into any page
```

Zero runtime deps (Langfuse public REST API + Node `fetch`). Filters map to native params
(`userId / sessionId / tags / time`) + `filter` DSL for metadata. Write your own
`Renderer` for prettier domain views (see `examples/custom-tag-chatbot`).

### Or just run the review app

```bash
node apps/review-server/src/server.ts   # → http://localhost:4317
```

A full browser UI — browse & filter traces, read rendered conversations, score against a
rubric, and write judgments back as Langfuse scores. **Runs on built-in demo data out of the
box** (no setup); set the three `LANGFUSE_*` vars above to point it at your own project.

## judge calibration — human scores vs. LLM-judge

tracelens ships a **judge-calibration** layer: across traces, it puts human scores and LLM-judge scores side by side and quantifies how well they agree. The aggregate dashboard reports **agreement rate / Cohen's κ / a confusion matrix / bias (is the judge too lenient or too strict) / confidence gating** — with an **honest denominator** (it only counts traces scored by *both* sides, labels each dimension with `n=`, and greys out dimensions with too few samples), plus a truncation note when a sample exceeds the fetch cap. From the top disagreements you can **drill into a single trace's side-by-side compare** — human vs. judge value *and reasoning* — and when the judge is wrong, flag it back through the `FeedbackSink` in one click to build up a judge-eval set.

Run `node apps/review-server/src/server.ts`, open the page, and switch to the **Calibration** tab (**works on built-in demo data out of the box**, no setup). If your judge's score names don't line up with the rubric dimensions, map them explicitly with `LANGFUSE_JUDGE_MAP` (JSON, e.g. `{"test_eva":"default.accuracy"}`).

## Status

🚧 **Early WIP — but everything here runs.** Contracts are self-verified against a real complex agent (`examples/custom-tag-chatbot`: comparison tables + product refs → `ConversationView`), with unit tests for the HTML renderer (incl. XSS escaping), a mock-fetch contract test for the Langfuse adapter, and pure-function tests for the calibration engine (pairing + agreement/κ/bias/gating) and its rendering. Six self-check suites run in CI.

```bash
npm install        # devDeps only: typescript + @types/node (runtime stays zero-dep)
npm run typecheck  # tsc --noEmit — clean
npm run verify     # core contracts + adapter + review-ui + calibration self-checks
npm run demo       # zero-backend before/after page → demo/index.html
```

**Roadmap (PRs welcome):** rubric routing by version · more renderers (LangGraph / CrewAI / OpenAI SDK) · richer reviewer ergonomics (keyboard flow, queues) · publish packages to npm. **Writing a `Renderer` for your own agent is a great first contribution.**

## License

MIT © heqiu12345
