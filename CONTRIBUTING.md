# Development and verification

Use Node.js ≥22.13 and Python ≥3.11. From the repository root:

```sh
npm ci
python -m venv services/agent/.venv
```

Activate the environment in your shell:

```powershell
# Windows PowerShell
./services/agent/.venv/Scripts/Activate.ps1
```

```sh
# Linux / macOS
. services/agent/.venv/bin/activate
```

Then install into that environment:

```sh
python -m pip install --upgrade pip
python -m pip install -e "./services/agent[dev]" -r services/agent/requirements.txt
npx playwright install chromium
npm run db:local
npm run dev
```

The kernel alone only needs `[dev]`; the pinned requirements add the native
voice dependencies so the complete 107-test Python suite can run without its
optional-runtime skip. Project commands prefer the dedicated environment when
it exists. Initial installation and dependency audits need network access.

## Optional services

The offline Agent demo needs no credentials. For normal semantic scoring or
voice, configure only the relevant groups from [.env.example](.env.example).
Run the worker from the repository root: it loads `.env.local`, then `.env`,
while preserving existing process environment values. The web app and worker
must receive the same relevant configuration; a different working directory
changes which local files the Python loader can find.
Never commit these files. See [LiveKit setup](docs/LIVEKIT_RUNBOOK.md).

`npm run doctor` validates all-or-none groups and public-secret exposure without
printing secret values. Missing scorer configuration yields labeled structure
feedback, not a reliable semantic score or ability update.

## Checks

```sh
npm run verify
python -m pip check
npm run audit:dependencies
npm run audit:python
```

`verify` covers configuration, content validation, lint, TypeScript checking,
Python and web tests, production build, local D1/browser fault injection and
frozen artifact regeneration. CI additionally checks the final voice runtime
imports and reruns Python tests after installing production voice dependencies.
Both dependency audits run in CI; the Python gate includes installed transitive,
test and build tools. Known npm exceptions remain visible, see
[dependency maintenance](docs/DEPENDENCY_UPGRADE_ZH.md).

For a partially configured local service group, `npm run verify:code` omits only
configuration preflight; it is not environment-file isolation or deployment
readiness. Use a dedicated checkout without real service credentials for
synthetic regression runs. Windows browser tests can use installed Chrome;
`STATINTERVIEW_BROWSER_EXECUTABLE` selects an explicit executable.

`npm run demo:agent -- --check` checks the checked-in trace without rewriting it.
When intentionally changing policy or fixtures, regenerate the artifacts,
review the diff and verify reproducibility. Keep frozen v2 results distinct from
current v3 routing checks; documentation-only changes should not regenerate them.

## Evidence and privacy

- Separate synthetic fixtures, simulation and real-user measurements.
- Do not upgrade NOT_READY/NOT_MEASURED without the existing protocol and sample rules.
- Link report conclusions to persisted raw evidence; add regressions for defects.
- Never commit credentials, personal transcripts, private reports or raw participant data.
- Do not add biometric, accent, emotion, gender or personality inference.

Formal docs and dated historical records are indexed in [docs](docs/README.md).
Personal application notes do not belong in the public technical documentation.
