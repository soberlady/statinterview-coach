# StatInterview Agent Kernel

This directory contains the deterministic decision core for StatInterview. It
does **not** connect to an LLM, speech provider, LiveKit, a database, or any
secret-bearing service. Those adapters can be added around this package later.

The kernel currently provides:

- an explicit, guarded interview state machine;
- Pydantic input/output contracts with unknown fields rejected;
- a discrete Bayesian ability posterior using a simplified Rasch model;
- expected-information-gain question selection with product constraints;
- rubric-based score aggregation;
- reliability classification and bounded verification decisions;
- a small policy facade that combines reliability, ability updates, and
  question selection.
- an optional LiveKit 1.6 voice worker that keeps raw final transcripts as
  evidence and delegates all question decisions to the policy API.

## Run locally

Python 3.11 or newer is required.

```powershell
cd services/agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
pytest
```

## Run the LiveKit voice worker

The voice extra follows the current LiveKit `AgentServer` / `AgentSession`
interface. It is optional so the deterministic kernel remains lightweight.

```powershell
python -m pip install -e ".[voice,dev]"
Copy-Item ..\..\.env.example ..\..\.env
# Fill LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET and an interview id.
python -m statinterview_agent.livekit_worker console
```

For a deployed room, use the name
`statinterview--<interview_id>`. The worker reads the initial question from the
web API, captures LiveKit's final transcript, and calls the turn API. It never
allows the LLM to paraphrase stored candidate evidence. On shutdown it also
exports the final cumulative model usage and a versioned marginal list-price
estimate; see the
[cost observability protocol](../../docs/COST_OBSERVABILITY.md) for the
accounting boundary.

## Public API

```python
from statinterview_agent import (
    AbilityEstimator,
    InterviewState,
    InterviewStateMachine,
    QuestionSelector,
    ReliabilityClassifier,
)
```

The intended integration boundary is:

1. An external speech/LLM adapter produces structured rubric assessments.
2. `score_rubric_answer` aggregates them deterministically.
3. `ReliabilityClassifier` decides whether to accept, verify, or abstain.
4. Accepted evidence updates an `AbilityPosterior`.
5. `QuestionSelector` picks the next question from approved question-bank
   entries.
6. The application persists the returned snapshot after every completed turn.

## Model assumptions

The ability estimator uses:

```text
P(correct | theta, difficulty) = sigmoid(theta - difficulty)
```

`theta` is represented on a finite grid (by default `-3.0` through `3.0` in
steps of `0.1`). A fractional rubric outcome in `[0, 1]` is treated as soft
evidence. Question difficulty is initially expert-authored; this package does
not claim psychometric calibration or hiring validity.

Expected information gain is the current posterior entropy minus the expected
posterior entropy after a correct/incorrect response. Product constraints then
blend that value with JD relevance, skill coverage, repetition limits, and
remaining-time cost.

## Reliability policy

The system never trusts an LLM-provided confidence number. Reliability is
derived from observable signals: evidence coverage, transcript completeness,
answer length, scorer disagreement, score proximity to a decision threshold,
and schema validity.

A low-reliability result requests at most one verification for the current
question and at most three per interview. When the budget is exhausted, the
kernel returns `ABSTAIN` rather than inventing a score.

## State machine

Happy-path states:

```text
CREATED -> PREPARING -> ANCHOR_INTERVIEW -> ADAPTIVE_INTERVIEW
        -> FINALIZING -> COMPLETED
```

`VERIFYING` can temporarily branch from either interview phase. `PAUSED` and
`RECOVERING` preserve a guarded resume target. `FAILED`, `CANCELLED`, and
`COMPLETED` are terminal.

The state policies in `state_machine.py` also define allowed tools, maximum
durations, and retry budgets. Application code should enforce those budgets
when running external operations.
