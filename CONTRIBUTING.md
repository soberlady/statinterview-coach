# Contributing

## Set up

Install Node.js 22.13 or newer and Python 3.11 or newer, then run:

```powershell
npm install
python -m pip install -e ".\services\agent[voice,dev]"
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
