# PharmacyOS

PharmacyOS is a single-shop, on-premise pharmacy operations platform for Pakistani pharmacies. It is **LAN-resilient**: internet outages do not stop local sales, but the browser clients still require the shop server and LAN. It is not an offline-first application and has no client-side synchronization queue.

## Current status

| Area                 | Verified status                                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engineering gate     | Phases 0–4 and repository-controlled Phase 5 work are implemented on `development`; current command evidence is in the phase execution records.                                                                                                       |
| Pilot deployment     | Phase 1 code and an isolated Docker-host build/start/backup/restore are verified. Second-terminal sale/receipt, trusted client TLS, and physical external-disk evidence remain.                                                                       |
| Receipts             | Sale lookup/reprint, opaque return-token QR, tax snapshots, and 80 mm browser rendering exist; physical printer/QR evidence remains a pilot prerequisite.                                                                                             |
| Fiscal integration   | Exact tax snapshots, a real FBR DI gateway, and an operator surface for submission status, attempt history, and guarded retry. Outbound transmission stays disabled pending explicit approval, licensed-integrator review, and real sandbox evidence. |
| Onboarding           | Bulk medicine catalog import validates every row and reports issues before anything is written; a partial import is never applied.                                                                                                                    |
| Purchasing           | Supplier orders, order approval, and multi-line goods receipt into batches are usable from the web client; goods receipt is the only path by which stock enters the system.                                                                           |
| Owner reporting      | Deterministic reports/dashboard, a reports workspace with CSV export, operational alerts, metrics, and the optional read-only AI explanation boundary are implemented.                                                                                |
| Production readiness | Blocked until the active phase exit gates in `docs/DEVELOPMENT_PLAN.md` have on-site evidence.                                                                                                                                                        |

## Prerequisites

- Node.js 22.22.2 or newer for development; CI and the containers use pinned Node 24.19.0.
- npm 10.9 or newer.
- PostgreSQL 18 with `pg_trgm`, `unaccent`, and `pgcrypto` for non-container development.
- Docker Engine with Docker Compose for the production workflow.

## Local development

1. Copy `.env.example` to `.env` and replace every placeholder secret.
2. Install the locked dependency graph with `npm ci`.
3. Start PostgreSQL. On a native installation the cluster has no application role or database yet,
   so run `npm run db:bootstrap:local` once: it creates the login role and database that
   `DATABASE_URL` names, using `DATABASE_ADMIN_URL` for administration. The Compose stack does this
   from `infra/docker/postgres-init-app-role.sh` instead. The command is idempotent and drops
   nothing; it refuses to run with `NODE_ENV=production`.
4. Run `npm run db:migrate` and `npm run db:seed`.
5. Create the initial owner with `npm run bootstrap:owner --workspace @pharmacy/api`.
6. Run `npm run dev`.

Sign-in asks only for a username and password. The API selects the terminal: the one that account
opened most recently, otherwise the first active counter in a branch it is assigned to. The browser
remembers the terminal it opened and offers `Change terminal` when a counter must be named
explicitly.

The web client defaults to `http://localhost:5173`. The local API defaults to `http://localhost:3001/api/v1`.

### Loading a medicine catalog file

To load a real catalog — a pharmacy export, a supplier list, or a published price list — save it as
CSV (export an `.xlsx` to CSV first) and run:

```
npm run load:medicines --workspace @pharmacy/api -- <path-to-file.csv> --validate-only
npm run load:medicines --workspace @pharmacy/api -- <path-to-file.csv>
```

The first command writes nothing and reports which columns were recognized, which were ignored, and
every row the catalog contract rejects. The second applies the file through the same validated
import path the administration screen uses, in chunks of 2,000 rows, and records the file name and
its SHA-256 in the audit trail. Re-running the same file replays idempotently instead of duplicating
rows. `docs/examples/medicine-catalog-sample.csv` shows an accepted file.

Column headings are matched by meaning, so `Brand Name`, `Generic`, `Strength`, `Form`, `Pack`,
`MRP`, `Trade Price`, `Company`, `Rx` and similar spellings are understood without renaming
anything. A catalog row carries no price: a sale price belongs to an inventory batch received into a
branch. For development only, `--with-demo-stock` also creates one opening batch per priced row
through the append-only stock ledger, so the counter can ring up a sale; it requires
`ALLOW_DEVELOPMENT_SEED=true` and refuses to run in production. Use `--quantity` to set the opening
quantity and `--limit` for a trial run.

For representative non-production data, set `ALLOW_DEVELOPMENT_SEED=true` and a 12-or-more-character `DEVELOPMENT_SEED_PASSWORD`, then run `npm run db:seed:development`. The command refuses to run in production. `infra/scripts/smoke-development-seed.ps1` proves migrations and fixtures against an isolated disposable PostgreSQL container.

For UI-only review without a database, run `$env:VITE_PREVIEW_MODE='true'; npm run dev --workspace @pharmacy/web`. Preview data is compile-time gated and excluded from production builds.

## Quality gate

Run `npm run verify` before handing off a change. It checks formatting, lint, strict TypeScript, tests, and production builds. Migrations are checksum-protected after application and must never be edited after deployment.

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
