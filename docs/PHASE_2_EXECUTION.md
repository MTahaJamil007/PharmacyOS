# Phase 2 Execution — Correctness Under Concurrency

- **Roadmap source:** `docs/DEVELOPMENT_PLAN.md`
- **Started:** 2026-08-31
- **Status:** in progress
- **Sequence exception:** the user explicitly directed Phase 2 execution before the remaining Phase 1 on-site checks scheduled for 2026-09-01. Phase 1 remains open; this exception does not mark its exit gate passed.

## Execution order

| Order | Workstream                       | Required evidence                                                                                                                                                  |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Test foundation                  | Root Vitest configuration, disposable PostgreSQL 18, real migrations, rollback helper, parallel-client harness, jsdom component test, and Playwright configuration |
| 2     | Idempotency and error semantics  | Locks precede replay reads; PostgreSQL conflicts map deterministically; concurrent same-ID requests create one business record                                     |
| 3     | FEFO concurrency                 | Deterministic inventory locks and a bounded retry policy; last-unit parallel test proves one winner and no negative availability                                   |
| 4     | Ledger integrity                 | Return disposition and batch splitting, expiry quarantine/scrap movements, database-enforced movement arithmetic, future-role privileges                           |
| 5     | Money exactness                  | Higher-precision cost, line-derived subtotal, one rounding rule, and no browser floating-point cart arithmetic                                                     |
| 6     | Authentication and authorization | Logout revocation, sliding session expiry, login throttling, zero-permission 403, own-session refunds, deterministic branch selection                              |
| 7     | Request validation               | Bounded schemas plus global request transformation and normalized database exceptions                                                                              |
| 8     | Exit proof                       | P0 database/API/component/E2E suite green in CI with command output and limitations recorded here                                                                  |

## Baseline audit

| Area               | Baseline on 2026-08-31                                             | Risk                                                           |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| API behavior tests | Two isolated test cases; no real application bootstrap or database | Regressions and authorization wiring are largely unobserved    |
| Database tests     | Three SQL-source string assertions                                 | Constraints, grants, triggers, and migrations are not executed |
| Concurrency        | No parallel-client harness                                         | Idempotency and FEFO claims are unproven                       |
| Web components     | No jsdom or Testing Library                                        | User interaction and exact-total behavior are unproven         |
| End to end         | No Playwright configuration or workflows                           | Counter workflows have no automated release proof              |

## Execution evidence

| Command                                 | Exit code | Result                                                                                         |
| --------------------------------------- | --------: | ---------------------------------------------------------------------------------------------- |
| `npm view` for Phase 2 harness packages |         0 | Resolved current stable exact versions on 2026-08-31                                           |
| Root harness type-check and lint        |         0 | New Vitest, migration, rollback, and concurrency code passed                                   |
| `npm run test:integration`              |         0 | Disposable PostgreSQL 18 started; four DB-backed tests passed; container removed automatically |

## Test-foundation decisions

- Testcontainers owns one disposable PostgreSQL 18 container per integration run.
- Every test suite receives a uniquely named database; migrations execute through the same checksum-protected runner used by production.
- Direct database tests use an explicit rollback helper. Endpoint concurrency tests use isolated databases and deterministic teardown because independent HTTP connections cannot share a caller-owned transaction.
- The integration runner uses one test worker to bound Docker resource usage; concurrency is created deliberately inside tests, not accidentally between suites.
- The application-role connection is included so permission tests exercise `pharmacy_app`, not only the PostgreSQL administrator.
- Test credentials are fixed disposable values scoped to the ephemeral container. No production or local `.env` secret is read.

## Gate status

The Phase 2 exit gate is **not passed**. The test foundation has begun, while the P0 correctness fixes and five core Playwright workflows remain in progress.
