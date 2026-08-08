# StatInterview Coach

An uncertainty-aware, adaptive interview training agent for Chinese data
analysis internships. It asks four fixed anchor questions, then selects two
questions that reduce the largest remaining ability uncertainty. When evidence
is weak, it verifies or abstains instead of inventing a confident score.

> This is a training product, not a hiring predictor. It evaluates answer
> content only and does not score faces, voices, accents, emotions, or gender.
> The deployed demo is owner-only; per-user authorization is required before
> any future shared beta.

## What works now

- complete text interview flow with refresh-safe checkpoints and
  pause/resume recovery, including the finalizing-to-report edge case;
- one-click `guided_demo` path that deterministically demonstrates
  `VERIFY -> ABSTAIN -> ACCEPT`, adaptive selection and report replay without
  external model calls; every fixture score is visibly synthetic and demo
  sessions cannot enter user-feedback data;
- 24-question Chinese data-analysis bank with weighted rubrics;
- four comparable anchor questions plus deterministic adaptive selection;
- bounded reliability verification and explicit `ABSTAIN`;
- evidence-linked reports, uncertainty display, and user feedback collection;
- D1 persistence for sessions, turns, skill states, Agent events and feedback;
- standalone Python policy, scorer-evaluation and voice helpers with 55 tests;
- browser LiveKit token/room flow plus a LiveKit 1.6 voice worker that stores
  committed transcript fragments verbatim, restores the authoritative current
  question on reconnect and uses Mandarin-first synthesis;
- privacy-bounded voice observability with connection and
  transcript-to-checkpoint p50/p95 in the evidence report;
- final per-session LiveKit Inference usage export with model-level token,
  duration and character accounting, explicit pricing coverage and a
  versioned marginal list-price estimate; independently configured semantic
  scorer token costs join the same completed-interview total;
- shared Python/TypeScript golden fixtures for posterior and utility parity;
- deterministic decision replay with a SHA-256 policy fingerprint, invariant
  checks and top-three counterfactual question rankings;
- strict semantic-scoring inference plus a frozen double-label evaluation
  pipeline with grouped bootstrap and risk-coverage checks; the checked-in
  12-answer fixture is synthetic and the formal scorer gate is `NOT_READY`;
  release metrics are restricted to one frozen run on `locked_test`;
- reproducible fixed/random/adaptive policy benchmark and in-product
  experiment page;
- deployable vinext/Cloudflare Sites web application.

Without a semantic model key, the web app enters a transparent fallback mode:
it measures observable answer structure and domain-term coverage, labels the
result, and never writes that structure-only score into the ability posterior.
When an OpenAI-compatible scorer is configured, two role-separated passes from
the configured model score every weighted rubric criterion; only verbatim
answer excerpts count as evidence, and reviewer disagreement lowers
reliability.

## Why this is not another “AI interviewer”

Most demos generate questions and a final score. This project makes the
decision policy inspectable:

1. anchors establish a comparable baseline;
2. a simplified Rasch posterior stores both ability and uncertainty;
3. expected-value selection blends uncertainty, difficulty, JD relevance,
   coverage and time;
4. reliability is derived from observable evidence signals, not an LLM's
   self-reported confidence;
5. every answer, transition, decision reason and checkpoint is persisted;
6. reports link conclusions back to exact answer excerpts;
7. the complete question path can be replayed from persisted turns to detect
   a question that was approved by the bank but not selected by the policy.

## Architecture

```mermaid
flowchart LR
  UI["Web / LiveKit room"] --> API["Interview API"]
  LK["LiveKit Agent worker"] --> API
  API --> QB["Approved question bank"]
  API --> EDGE["Edge policy mirror"]
  EDGE --> D1["D1: turns, state, events"]
  PY["Python policy kernel"] -. parity tests .-> EDGE
  D1 --> REPORT["Evidence report"]
```

The Python kernel is the canonical algorithm implementation. The TypeScript
edge mirror keeps the private web demo deployable on Cloudflare. Shared golden
fixtures verify posterior updates, uncertainty summaries, information gain and
utility signals in both implementations.

## Measured result

`experiments/run_policy_benchmark.py` runs a deterministic, paired synthetic
benchmark. With seed `20260730`, 4,000 simulated candidates and the same
six-question budget, the adaptive policy reduced job-weighted MAE by 2.29%
versus the fixed sequence (paired absolute difference 95% interval:
`[-0.0214, -0.0109]`). The 90% posterior interval covered 89.8% of simulated
latent abilities.

The effect is small for balanced roles and larger for roles with uneven skill
weights. This supports a narrow claim: the policy allocates limited follow-up
questions more efficiently under its simulation assumptions. It does not prove
hiring validity or real-user learning impact. See the in-product `/lab` page
and [experiment report](docs/EXPERIMENT_RESULTS.md).

## Local development

Prerequisites: Node.js `>=22.13`, Python `>=3.11`.

```powershell
npm install
npm run db:local
npm run dev
```

Open `http://localhost:3000`.

For a repeatable interview demo, choose **进入引导演示** on the landing page
and use the answer option marked **推荐步骤**. The first weak answer triggers a
bounded verification, the verification remains insufficient and abstains, and
the remaining fixture answers establish evidence before two adaptive turns.

Agent kernel:

```powershell
Set-Location services\agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
pytest
```

Voice worker:

```powershell
python -m pip install -e ".[voice,dev]"
Copy-Item ..\..\.env.example ..\..\.env
python -m statinterview_agent.livekit_worker console
```

The browser requests a short-lived room token from
`/api/interviews/:id/voice-token`. The token explicitly dispatches the
`statinterview-coach` worker. Without LiveKit credentials the endpoint returns
`503 VOICE_NOT_CONFIGURED` and the text interview remains available.

Optional semantic scoring uses the three
`STATINTERVIEW_SCORER_*` values documented in `.env.example`. Provider failure
automatically falls back to the labeled structure heuristic.

## Verification

```powershell
npm run db:generate
node content\validate-question-bank.mjs
npm run lint
npm run build
npm run test:policy
npm run test:e2e
npm run experiment
npm run eval:scorer:fixture
npm run eval:voice:fixture
```

See [architecture](docs/ARCHITECTURE.md),
[evaluation plan](docs/EVALUATION.md),
[semantic scorer protocol](docs/SCORING_EVALUATION.md),
[voice evaluation protocol](docs/VOICE_EVALUATION.md),
[inference cost protocol](docs/COST_OBSERVABILITY.md), and
[implementation status](docs/IMPLEMENTATION_STATUS.md). For interview
preparation, use [INTERVIEW_GUIDE.md](docs/INTERVIEW_GUIDE.md).

## Upstream and licenses

The realtime architecture follows the official
[LiveKit Agents Python starter](https://github.com/livekit-examples/agent-starter-python)
and [LiveKit Meet](https://github.com/livekit-examples/meet) interaction model.
The current repository is an original implementation, not a hidden fork.
See [UPSTREAM.md](docs/UPSTREAM.md) for the exact reuse boundary.
