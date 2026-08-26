# Security policy

## Supported scope

Only the latest revision of the default branch is supported. This repository
is currently an owner-only research/demo system, not a public multi-tenant
service. Per-user authorization is a required release gate before a shared
beta.

The public portfolio deployment is a separate read-only mode. With
`STATINTERVIEW_PUBLIC_SHOWCASE=1`, the Worker redirects data-bearing pages and
returns `403 PUBLIC_SHOWCASE_READ_ONLY` for operational APIs. It displays only
fixed synthetic fixtures and is not a public beta of the full system.

## Reporting a vulnerability

Use GitHub's private security-advisory reporting for this repository. Do not
open a public issue containing a credential, candidate transcript, room token
or exploit details. Include the affected revision, reproduction steps, impact
and the smallest safe proof of concept.

## Data and credential rules

- Never commit `.env`, `.env.local`, LiveKit secrets or scorer keys.
- Never use real candidate-identifying data in fixtures, issues or pull
  requests.
- Treat room tokens and raw transcripts as sensitive, even when short-lived.
- Run `npm run doctor` before deployment; it detects partial secret groups and
  secret-like values exposed through `NEXT_PUBLIC_*` variables without
  printing their values.

This project is an interview-training tool. It must not be used as an
automated hiring decision system.
