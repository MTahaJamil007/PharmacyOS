# Changelog

All notable changes to PharmacyOS are recorded in this file. The format follows Keep a Changelog, and the project uses Semantic Versioning once releases begin.

## [Unreleased]

### Added

- Git history with an immutable pre-Phase-0 baseline commit.
- GitHub Actions quality gate running a locked install and `npm run verify` on pushes and pull requests.
- Husky and lint-staged pre-commit checks for formatting and linting staged files.
- React Hooks and JSX accessibility lint enforcement.
- Local secret rotation command that updates ignored `.env` credentials without printing them.
- Repository engineering guidance in `AGENTS.md` and `CLAUDE.md`.
- Phase 0 implementation evidence in `docs/PHASE_0_EXECUTION.md`.

### Changed

- Pinned `qrcode` and `@types/qrcode` exactly on the receipt path.
- Standardized repository text line endings through `.gitattributes`.

### Removed

- Thirteen ignored `.npm-cache*` install-debris directories from the workspace.

### Security

- Rotated the local session, development-seed, and bootstrap-owner secrets in the ignored `.env` file.
