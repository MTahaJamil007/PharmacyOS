# PharmacyOS

PharmacyOS is a single-shop, on-premise pharmacy operations platform for Pakistani pharmacies. It is **LAN-resilient**: internet outages do not stop local sales, but the browser clients still require the shop server and LAN. It is not an offline-first application and has no client-side synchronization queue.

## Current status

| Area                 | Verified status                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engineering gate     | Phase 0 is complete locally. A clean clone passes the locked install and `npm run verify`; hosted CI awaits a Git remote.                                                       |
| Pilot deployment     | Phase 1 code and an isolated Docker-host build/start/backup/restore are verified. Second-terminal sale/receipt, trusted client TLS, and physical external-disk evidence remain. |
| Receipts             | A sale can render and print an 80 mm browser receipt with an opaque return-token QR code. There is no find-sale/reprint workflow yet.                                           |
| Fiscal integration   | The durable FBR outbox boundary exists. No certified production FBR adapter exists; non-disabled real modes retry rather than submit.                                           |
| Owner reporting      | The read-only AI boundary and limited operational screens exist. A deterministic non-AI owner dashboard is planned for Phase 4.                                                 |
| Production readiness | Blocked until the active phase exit gates in `docs/DEVELOPMENT_PLAN.md` have on-site evidence.                                                                                  |

## Prerequisites

- Node.js 22.22.2 or newer for development; CI and the containers use pinned Node 24.19.0.
- npm 10.9 or newer.
- PostgreSQL 18 with `pg_trgm`, `unaccent`, and `pgcrypto` for non-container development.
- Docker Engine with Docker Compose for the production workflow.

## Local development

1. Copy `.env.example` to `.env` and replace every placeholder secret.
2. Install the locked dependency graph with `npm ci`.
3. Start PostgreSQL, then run `npm run db:migrate` and `npm run db:seed`.
4. Create the initial owner with `npm run bootstrap:owner --workspace @pharmacy/api`.
5. Run `npm run dev`.

The web client defaults to `http://localhost:5173`. The local API defaults to `http://localhost:3001/api/v1`.

For representative non-production data, set `ALLOW_DEVELOPMENT_SEED=true` and a 12-or-more-character `DEVELOPMENT_SEED_PASSWORD`, then run `npm run db:seed:development`. The command refuses to run in production. `infra/scripts/smoke-development-seed.ps1` proves migrations and fixtures against an isolated disposable PostgreSQL container.

For UI-only review without a database, run `$env:VITE_PREVIEW_MODE='true'; npm run dev --workspace @pharmacy/web`. Preview data is compile-time gated and excluded from production builds.

## Quality gate

Run `npm run verify` before handing off a change. It checks formatting, lint, strict TypeScript, tests, and production builds. Migrations are checksum-protected after application and must never be edited after deployment.

## Production deployment

The production stack provides:

- Caddy-managed HTTPS with an internal CA, HTTP-to-HTTPS redirect, HSTS, and a restrictive CSP.
- One-shot, checksum-verified migrations before API, worker, or backup startup.
- Separate PostgreSQL administrator and least-privilege application roles.
- Health checks plus CPU, memory, and process ceilings for every long-running service.
- Nightly encrypted logical backups, 7/4/3 retention, an external copy, and weekly isolated restore drills recorded in `backup_runs`.
- Reservation-expiry scheduling, stale worker-lock recovery, and owner-visible failed-job status.

Follow `docs/RUNBOOK.md`; do not improvise a production installation from the Compose file alone. Only the Caddy entrypoint is published to the LAN. Internet-dependent integrations remain non-blocking for local sales.

## Architecture invariants

- Money and quantities use exact decimal or integer representations, never floating point.
- Branch and terminal ownership is explicit at transactional boundaries.
- Stock and cash ledgers are append-only audit records.
- Idempotent writes lock before replay checks and reuse the same client request ID on retry.
- Database constraints enforce invariants; controllers validate and services coordinate use cases.
- Inventory locks follow deterministic ordering.

The sequencing and objective release gates are defined in `docs/DEVELOPMENT_PLAN.md`. Phase execution evidence is stored beside it in `docs/PHASE_0_EXECUTION.md` and `docs/PHASE_1_EXECUTION.md`.
