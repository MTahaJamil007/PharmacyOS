# Changelog

All notable changes to PharmacyOS are recorded in this file. The format follows Keep a Changelog, and the project uses Semantic Versioning once releases begin.

## [Unreleased]

### Added

- Phase 6 fiscal operations surface: branch-scoped submission status counts, per-invoice attempt history from `fbr_invoice_attempts`, and a reason-required, idempotent, audited retry that re-queues the durable outbox row instead of calling the gateway inline. An invoice that already holds an official fiscal number can never be retried.
- Backup and restore-drill evidence surface reading `backup_runs`, deliberately read-only; a restore is still run from the host with the runbook.
- Owner-assistant usage audit exposing who used which deterministic tool, without exposing question text.
- Bulk medicine catalog import with a validate-before-write contract: `VALIDATE` never writes and returns per-row issues, `APPLY` refuses to write at all if any row is still rejected, matches existing medicines by SKU or barcode, and is idempotent on the client request id.
- Operations workspace at `/operations` and a catalog import panel in Administration.
- Phase 6 evidence and operator checklists in `docs/PHASE_6_EXECUTION.md`, plus ADR 0006.

- Purchasing workspace covering supplier selection, exact purchase-order arithmetic, order approval, multi-line goods receipt into batches, receipt history, and supplier quote capture. Goods receipt is the only path by which stock enters the system and previously had no user interface.
- Deterministic reports workspace for the seven owner reports, with date ranges, a generic table renderer for aggregate and row-list payloads, CSV export, and the data basis shown beside every figure.
- Permission-aware primary navigation, so an operator no longer sees destinations that can only answer 403.
- Build audit in `docs/SYSTEM_AUDIT_2026-09-21.md`, the Phase 6-9 plan in `docs/PHARMACY_OS_COMPLETION_ROADMAP.md`, and ADR 0005 for the purchasing and reporting surfaces.

- Phase 3 counter-grade scanner/keyboard operation, split tender and change, resilient checkout recovery, receipt search/reprint, and optional Web Serial ESC/POS printing with drawer control.
- Lazy domain routes, shared web/API contracts, persisted carts, render recovery, in-place re-authentication, live LAN/terminal state, and an English/Urdu RTL foundation.
- Database-enforced cash tender/change constraints plus branch-scoped receipt-reprint audit evidence.

- Phase 1 LAN-safe request identifiers with a cryptographic insecure-origin fallback.
- TLS-terminated production Compose stack with migration gating, health checks, and resource ceilings.
- Encrypted local/external backup automation, 7/4/3 retention, and isolated weekly restore drills recorded in `backup_runs`.
- Worker heartbeat, stale-lock recovery, reservation-expiry scheduling, and failed-job visibility for system managers.
- Deployment configuration contract tests and Phase 1 operational runbook/evidence.
- Git history with an immutable pre-Phase-0 baseline commit.
- GitHub Actions quality gate running a locked install and `npm run verify` on pushes and pull requests.
- Husky and lint-staged pre-commit checks for formatting and linting staged files.
- React Hooks and JSX accessibility lint enforcement.
- Local secret rotation command that updates ignored `.env` credentials without printing them.
- Repository engineering guidance in `AGENTS.md` and `CLAUDE.md`.
- Phase 0 implementation evidence in `docs/PHASE_0_EXECUTION.md`.

### Changed

- Every genuinely orphaned permission is now enforced: `fbr.view_status`, `fbr.retry`, `backup.restore`, `ai.audit.read`, and `returns.refund_cash`. A cash refund now requires `returns.refund_cash` in addition to `returns.refund`.
- The owner dashboard accepts `analytics.owner.read` as an alternative to `reports.view_financial`, through a new any-of permission decorator.

- Split the monolithic operations workspace into POS, cash, inventory, returns, and dashboard modules with route-level code splitting.
- Replaced client-side floating-point totals and duplicate API interfaces with shared exact arithmetic and compile-time contracts.

- Production database access now separates the PostgreSQL administrator and least-privilege application roles.
- README claims now match the LAN-resilient, receipt, fiscal-integration, and release-gate reality.
- Pinned `qrcode` and `@types/qrcode` exactly on the receipt path.
- Standardized repository text line endings through `.gitattributes`.

### Removed

- Thirteen ignored `.npm-cache*` install-debris directories from the workspace.

### Security

- Added internal-CA HTTPS, HTTP redirection, HSTS, CSP, and persistent Caddy trust material.
- Excluded backup identities from Git and Docker build contexts; backup artifacts are encrypted before disk writes.
- Rotated the local session, development-seed, and bootstrap-owner secrets in the ignored `.env` file.
