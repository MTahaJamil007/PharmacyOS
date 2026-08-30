# PharmacyOS

Local-first pharmacy operations foundation for small Pakistani pharmacies. The current repository implements the engineering base for the architecture plan: strict workspaces, a production-oriented PostgreSQL schema, terminal-aware authentication and permissions, durable background jobs, catalog search, an operational POS shell, and pinned deployment infrastructure.

## Prerequisites

- Node.js 22.12+ for development (Node 24 LTS is used in container images)
- npm 10.9+
- PostgreSQL 18 with `pg_trgm`, `unaccent`, and `pgcrypto`
- Docker Engine with Compose for the documented container workflow

## Local setup

1. Copy `.env.example` to `.env` and replace every secret.
2. Install exact dependencies: `npm ci`.
3. Start PostgreSQL, then run `npm run db:migrate` and `npm run db:seed`.
4. Create the initial owner with `BOOTSTRAP_OWNER_USERNAME` and a 12+ character `BOOTSTRAP_OWNER_PASSWORD`, then run `npm run bootstrap:owner --workspace @pharmacy/api`.
5. Run `npm run dev`. Web defaults to `http://localhost:5173`; API defaults to `http://localhost:3000/api/v1`.

For representative non-production data, set `ALLOW_DEVELOPMENT_SEED=true` and a 12+ character `DEVELOPMENT_SEED_PASSWORD`, then run `npm run db:seed:development`. The command refuses to run in production. `infra/scripts/smoke-development-seed.ps1` proves migrations and fixtures against an isolated disposable PostgreSQL container.

For UI-only review without a database, run `$env:VITE_PREVIEW_MODE='true'; npm run dev --workspace @pharmacy/web`. Preview data is explicitly compile-time gated and is not enabled in production builds.

## Quality gates

Run `npm run verify` before merging. It checks formatting, lint, strict TypeScript, unit/database contract tests, and production builds.

## Database workflow

- Migrations live in `packages/database/migrations` and are checksum-protected after application.
- `DATABASE_ADMIN_URL` is preferred for migrations. The API must use a least-privilege `DATABASE_URL` in production.
- Never edit an applied migration. Add a new ordered migration.
- Money and quantities must remain decimal strings at external boundaries.

## Production deployment

`infra/docker/compose.yaml` keeps PostgreSQL and Redis on an internal network and exposes only the Caddy web entrypoint. Run migrations as a controlled release step before starting the new API image. Backups and restore drills require deployment-specific encryption keys and destinations and must be configured before a pharmacy pilot.

## Implemented boundary

The repository now contains the Phase 2 coding foundation on top of the Phase 1 transaction core:

- Auth/RBAC/audit, catalog search, exact decimal pricing, FEFO reservation, idempotent sale finalization, payments, invoice sequencing, stock ledger writes, and the FBR outbox boundary.
- Idempotent cash-session open/movement/count/close, exact reconciliation, independent threshold-based variance approval, cashier/supervisor UI, and cash-gated counter checkout.
- Direct and reorder-derived purchase orders plus duplicate-safe partial/full goods receipt, discount/bonus/base-unit cost normalization, acquisition-lot batches, and append-only receipt/stock ledgers.
- Storage/security-aware shelf recommendations with deterministic scoring and an authorized review/apply workflow.
- Timezone-aware expiry risk, acquisition-cost value at risk, durable work items, and worker refresh jobs.
- Supplier quote/history normalization, deterministic reorder v2, stockout confidence, and duplicate-safe draft purchase-order creation.
- Complete-regimen affordability calculation using integer/decimal arithmetic and minimum sale increments.
- Opaque receipt return tokens, authorized invoice lookup, linked partial-return limits, approval, refund, stock disposition, and FBR return outbox linkage.
- A provider-independent, read-only owner assistant with whitelisted aggregate tools, runtime authorization, sanitization boundaries, rate limiting, timeouts, and durable metadata audit.
- Operational React screens for counter checkout, cash reconciliation, inventory attention, regimen affordability, return lookup/request/approval/cash refund, and owner questions.
- Reprintable 80 mm browser receipt rendering with a medium-error-correction QR containing only the opaque return token.

Production readiness still requires the verification work documented in `PharmacyOS_Phase_2_Test_and_Feature_Audit.docx`: database-backed integration/E2E/concurrency testing, printer/scanner validation, complete procurement/return operator screens, real FBR adapter certification, backup automation/restore evidence, and pilot performance/security validation.
