# Phase 0 Execution — Make the Work Provable

**Roadmap source:** `docs/DEVELOPMENT_PLAN.md`  
**Executed:** 2026-08-30  
**Scope:** repository provenance, a truthful quality gate, dependency controls, local hooks, and contributor guidance

## Baseline review

The plan's principal Phase 0 findings were reproduced:

- The directory had no Git repository.
- `.gitignore` already excluded `.env`, `.env.*` except `.env.example`, `node_modules`, `dist`, coverage, logs, and `.npm-cache*`.
- `SESSION_SECRET` and `DEVELOPMENT_SEED_PASSWORD` in `.env` matched the public placeholders. The owner password was not the four-character value described by the plan, so that detail was stale; all three local auth secrets were rotated anyway.
- `npm run verify` exited `1` during `format:check`, before reaching the documented JavaScript `no-undef` lint failures.
- The workspace contained thirteen `.npm-cache*` directories, not twelve.
- `qrcode` and `@types/qrcode` were the only dependencies using caret ranges.

The unmodified tracked tree was committed as `chore: establish PharmacyOS baseline` before Phase 0 source changes. `.env` remained ignored and was never staged.

## Implementation

| Requirement        | Implementation                                                                                         | Evidence                            |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Version control    | Initialized `main` and captured the current tree in a root commit                                      | `git log --oneline`                 |
| Secret hygiene     | Added `npm run secrets:rotate-local`; rotated session, seed, and owner secrets without printing values | `.env` remains ignored              |
| Cache cleanup      | Removed every root `.npm-cache*` directory after validating its resolved path was inside the workspace | 13 directories removed              |
| JavaScript globals | Applied Node globals to JavaScript and MJS files                                                       | `eslint.config.js`                  |
| React correctness  | Enabled React Hooks recommended-latest and JSX accessibility recommended rules for the web app         | `eslint.config.js`                  |
| Dependency pinning | Pinned receipt QR runtime and types to exact versions                                                  | `apps/web/package.json`             |
| CI                 | Added locked install plus the full verification command for every push and pull request                | `.github/workflows/ci.yml`          |
| Pre-commit checks  | Added Husky with lint-staged formatting and lint checks scoped to staged files                         | `.husky/pre-commit`, `package.json` |
| Agent guidance     | Added invariant-focused contributor instructions                                                       | `AGENTS.md`, `CLAUDE.md`            |
| Change history     | Added a Keep a Changelog-style unreleased section                                                      | `CHANGELOG.md`                      |

## Dependency decision

The development plan assumed the React accessibility plugin could be added to the existing ESLint 10 stack. It cannot: `eslint-plugin-jsx-a11y@6.10.2` declares support only through ESLint 9. The implementation therefore uses the newest ESLint 9 release with matching `@eslint/js`, rather than bypassing peer-dependency validation. React Hooks 7 supports ESLint 10, but the combined plugin set determines the compatible major.

`lint-staged@17` also requires Node `>=22.22.1`, while this repository supports Node `>=22.12.0`. It is pinned to the latest compatible 16.x release so pre-commit checks work across the declared engine range.

## Verification evidence

| Command                                    |  Exit code | Result                                         |
| ------------------------------------------ | ---------: | ---------------------------------------------- |
| `npm run verify` before implementation     |          1 | Failed at formatting in six files              |
| `npm audit` during dependency installation |          0 | No known vulnerabilities                       |
| `npm run verify` after implementation      |          0 | Format, lint, types, 10 tests, and builds pass |
| `npm ci` in a clean checkout               | Pending CI | Enforced by GitHub Actions on the first push   |

## Exit-gate interpretation

Phase 0 is locally complete: `npm run verify` exited `0`. The build emitted the existing Vite advisory that the main web bundle exceeds 500 kB; code splitting is already planned for Phase 3, and the advisory is not a failed gate. The clean-clone portion remains an external CI assertion until the repository is pushed to a GitHub remote. A green local run is necessary but does not substitute for that CI evidence.
