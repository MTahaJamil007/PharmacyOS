# PharmacyOS

PharmacyOS is a single-shop, on-premise pharmacy operations platform for Pakistani pharmacies. It is **LAN-resilient**: internet outages do not stop local sales, but the browser clients still require the shop server and LAN. It is not an offline-first application and has no client-side synchronization queue.

## Current status

The engineering assessment, every defect fixed in the October 2026 hardening pass, the verification commands with their exit codes, and the remaining go-live blockers are in [`docs/PRODUCTION_READINESS_2026-10-21.md`](docs/PRODUCTION_READINESS_2026-10-21.md). In short: the software is ready for a supervised pilot in one pharmacy; it is **not** ready for unsupervised production until the on-site gates below have evidence.

| Area                 | Verified status                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Counter and cash     | Scan/search, split tender, khata, supervisor-approved discounts, receipts and reprints, drawer open/movements/count/close with variance approval. Driven end to end against the real API and database.                  |
| Returns              | Lookup by receipt QR or invoice number, cumulative refund limits that never exceed what was paid, approval/rejection, cash/card/bank/khata refunds.                                                                     |
| Stock and purchasing | Stock overview, batch count/price/scrap, reorder levels, expiry and reorder queues, purchase orders from builder or suggestion, receiving with batch/expiry/MRP checks, cancellation, supplier price comparison.        |
| Onboarding           | Medicine list and opening-stock imports in 500-row parts; the whole file is validated before anything is written, and re-loading the same batch is refused.                                                             |
| Reporting            | Nine typed reports on branch-local business days with totals, exact CSV export and A4 print; live owner dashboard; read-only assistant over local reports.                                                              |
| Background jobs      | Dashboard metrics, availability snapshots, expiry risk, reorder suggestions and shelf recommendations run through the worker and are covered by an integration test of the worker loop.                                 |
| Fiscal integration   | Exact tax snapshots, FBR gateway, submission status, attempt history and guarded retry. Outbound transmission stays disabled until written approval, licensed-integrator review and real sandbox evidence.              |
| Production readiness | Blocked on on-site evidence: second terminal with trusted TLS, physical scanner/printer/drawer, backup to and restore from a physical disk, FBR authorization, and the 14-day parallel pilot (`docs/PILOT_RUNBOOK.md`). |

## Prerequisites

- Node.js 22.22.2 or newer for development; CI and the containers use pinned Node 24.19.0.
- npm 10.9 or newer.
- PostgreSQL 18 with `pg_trgm`, `unaccent`, and `pgcrypto` for non-container development.
- Docker Engine with Docker Compose for the production workflow.

## Local development

1. Copy `.env.example` to `.env` and replace every placeholder secret.
2. Install the locked dependency graph with `npm ci`.
3. Build the shared packages once with `npm run build:packages` (the database and seed scripts import their compiled output; `npm run dev` rebuilds them).
4. Start PostgreSQL, then run `npm run db:migrate` and `npm run db:seed`.
5. Create the initial owner with `npm run bootstrap:owner --workspace @pharmacy/api`.
6. Run `npm run dev`.

The web client defaults to `http://localhost:5173`. The local API defaults to `http://localhost:3001/api/v1`.

For representative non-production data, set `ALLOW_DEVELOPMENT_SEED=true` and a 12-or-more-character `DEVELOPMENT_SEED_PASSWORD`, then run `npm run db:seed:development`. The command refuses to run in production. `infra/scripts/smoke-development-seed.ps1` proves migrations and fixtures against an isolated disposable PostgreSQL container.

To preview the counter screen without a database or API, run `$env:VITE_PREVIEW_MODE='true'; npm run dev --workspace @pharmacy/web`. Preview data is compile-time gated and excluded from production builds.

## Quality gate

Run `npm run verify` before handing off a change. It checks formatting, lint, strict TypeScript, unit and integration tests, the browser suite, and production builds. Migrations are checksum-protected after application and must never be edited after deployment.

- Integration tests start a disposable PostgreSQL 18 container through Testcontainers; Docker must be running. Where the Ryuk reaper container cannot start, set `TESTCONTAINERS_RYUK_DISABLED=true`.
- The browser suite uses Playwright's Chromium. On a machine with only a system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path.

Run `npm run test:performance` separately for the representative Phase 5 gate (10,000 medicines and 200,000 historical batches). It is intentionally excluded from the normal fast verification loop.

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

Sequencing and objective release gates for Phases 0-5 are in `docs/DEVELOPMENT_PLAN.md`, and for Phases 6-9 in `docs/PHARMACY_OS_COMPLETION_ROADMAP.md`. The current build audit is `docs/SYSTEM_AUDIT_2026-09-21.md`. Phase execution evidence is stored in `docs/PHASE_0_EXECUTION.md` through `docs/PHASE_5_EXECUTION.md`; the on-site process is `docs/PILOT_RUNBOOK.md`.
