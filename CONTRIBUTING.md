# Contributing

## Set up

Install Node.js 22.13 or newer and Python 3.11 or newer, then run:

```powershell
npm ci
python -m pip install -e "./services/agent[dev]"
npm run db:local
```

Copy `.env.example` to `.env.local` only when credential-dependent voice or
semantic-scoring work is needed. Never commit that file.

## Verify a change

Run the complete machine-checkable gate:

```powershell
npm run verify
```

This checks configuration shape, the question bank, lint, Python tests,
TypeScript/rendered-output tests, the local D1 end-to-end path and all frozen
synthetic evidence artifacts. CI repeats the same gate and rejects generated
artifacts that are not reproducible.

## Evidence rules

- Label synthetic fixtures, simulations and real-user measurements
  separately.
- Never upgrade `NOT_MEASURED` or `NOT_READY` without the required protocol,
  sample size and frozen data.
- Keep conclusions linked to exact persisted evidence.
- Add a regression test for every fixed failure mode.
- Do not add face, accent, emotion, gender or personality inference.

## Review and runtime checks

`npm run demo:agent` runs the production edge policy with synthetic scores.
`npm run typecheck` generates runtime declarations with the pinned Wrangler
and runs a full TypeScript check, following the
[Cloudflare type-generation workflow](https://developers.cloudflare.com/workers/languages/typescript/).
Generated types stay under ignored `.wrangler/`.

If optional local service configuration is partial, `npm run verify:code`
runs the full code gate without configuration preflight. `npm run doctor` is
still required before deployment. No env file needs to be edited for this.

After changing policy or demo fixtures, run `npm run demo:agent -- --write`
and review `content/agent-demo.json`. CI checks its reproducibility.
Pure Python tests use `[dev]`; CI separately installs pinned production
voice dependencies and imports the worker to catch adapter failures.
