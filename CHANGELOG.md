# Changelog

All notable changes to PharmacyOS are recorded in this file. The format follows Keep a Changelog, and the project uses Semantic Versioning once releases begin.

## [Unreleased]

### Added

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
