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
| 3     | FEFO concurrency                 | Deterministic inventory locks followed by a current reservation read; last-unit parallel test proves one winner and no negative availability                       |
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
| Root `npm run typecheck`                |         0 | Root harness and all six workspaces passed after the transactional changes                     |
| Migration + ledger integration tests    |         0 | Two files and nine tests passed against disposable PostgreSQL 18                               |
| `npm run test:integration`              |         0 | Three files and 11 tests passed; migration, POS races, refunds, and ledgers were green         |
| `npm run test:unit`                     |         0 | 27 tests passed across API, web, worker, config, database, and shared workspaces               |
| Root `npm run typecheck`                |         0 | Root harness and all workspaces passed after the money-boundary changes                        |
| `npm run test:integration`              |         0 | Four files and 13 tests passed, including sub-paisa receipt and fractional FEFO sale totals    |

## Test-foundation decisions

- Testcontainers owns one disposable PostgreSQL 18 container per integration run.
- Every test suite receives a uniquely named database; migrations execute through the same checksum-protected runner used by production.
- Direct database tests use an explicit rollback helper. Endpoint concurrency tests use isolated databases and deterministic teardown because independent HTTP connections cannot share a caller-owned transaction.
- The integration runner uses one test worker to bound Docker resource usage; concurrency is created deliberately inside tests, not accidentally between suites.
- The application-role connection is included so permission tests exercise `pharmacy_app`, not only the PostgreSQL administrator.
- Test credentials are fixed disposable values scoped to the ephemeral container. No production or local `.env` secret is read.

## Correctness decisions and evidence

- **Idempotency:** transaction-scoped PostgreSQL advisory locks are acquired from operation, branch, and client-request identity before every replay read in sale, return-request, and procurement transitions. The sale concurrency test sends eight simultaneous finalize requests and proves one sale, one fiscal invoice, invoice counter `1`, one `-000001` number, one original response, and seven replays.
- **Database errors:** the global exception filter maps unique conflicts to HTTP `409`, check and numeric-range failures to HTTP `400`, and leaves unexpected failures on the framework's normal error path.
- **FEFO:** `reserveDraft` first locks every eligible inventory row in ascending batch ID, then reads active reservations in a second READ COMMITTED statement. This is deliberate: a REPEATABLE READ snapshot created before a waiter acquires the locks could remain stale. Eight drafts competing for one unit produce exactly one HTTP `201`, seven HTTP `409`, one active reservation, and no stock decrement or oversell.
- **Ledger:** migration 009 introduces separate return/expiry inventory segments, repairs auditable legacy opening balances, validates all existing history, enforces movement arithmetic/sign/branch agreement, and uses a deferred constraint trigger so every batch quantity change must reconcile by commit. Invalid arithmetic, wrong signs, and direct quantity mutation all fail with PostgreSQL `23514`.
- **Expiry:** quarantine transfers the complete quantity out of the sellable source into a linked quarantine segment and records both sides. Scrap decrements that segment to zero and records the loss. Active reservations block both restrictive actions.
- **Returns:** a quarantined returned unit enters a linked segment instead of changing the original acquisition lot. Sellable restock cannot revive `RECALLED` or `QUARANTINE` state. Eight concurrent refund attempts create one refund, two expected restock movements, one original response, and seven replays.
- **Future migrations:** default privileges now make tables, sequences, and functions created by the migration owner usable by `pharmacy_app`; a post-migration table is inserted into and read through that role in the integration suite.
- **Cost precision:** acquisition cost is stored as `numeric(20,8)` in purchase-order items, goods-receipt evidence, inventory batches, and sold-item cost basis. A one-rupee order unit containing 1,000 base units persists as `0.00100000`, not `0.00`.
- **Sale totals:** every sale line and draft line is constrained to PostgreSQL numeric nearest-paisa rounding. Deferred database triggers require `sales.subtotal` to equal the sum of immutable `sale_items.line_total` values. Finalization derives payment, fiscal payload, audit metadata, draft totals, and the sale header from the actual FEFO reservation splits.
- **Rounding rule:** line extension uses nearest paisa with halves away from zero everywhere, including the budget-regimen calculator. Quantity rounding up to a permitted sale increment remains a separate physical-quantity rule.
- **Browser exactness:** cart lines, cart totals, receipts, cash values, refunds, and budget values use shared `bigint` decimal helpers plus string formatting. No browser production path converts money to JavaScript `Number`; return quantities are also filtered with scaled integers.
- **Fractional proof:** a one-unit sale at PKR `0.01` split across two `0.500` FEFO reservations changes the reservation total from the initial PKR `0.01` estimate to PKR `0.02`; the client tenders the reservation total and the stored header equals the two PKR `0.01` sale lines.

## Findings resolved during execution

- PostgreSQL 18 treated untyped quantity parameters in subtraction and unary negation as ambiguous. Transactional quantity expressions now cast parameters explicitly to `numeric`.
- The development seed previously created historical sale movements without an opening stock movement. It now writes a 50-unit opening balance and decrements each historical sale from the ledger-derived quantity; reruns preserve batches that already have history.
- The first Docker-backed test attempt exited `1` because the managed shell could not access the Docker Desktop executable. After granting the test process access to the installed runtime, all disposable-container runs completed and cleaned up normally. This was a host permission issue, not a repository failure.

## Gate status

The Phase 2 exit gate is **not passed**. Workstreams 1–5 are implemented and green locally. Authentication/authorization, request validation, the remaining P0 audit matrix, the five core Playwright workflows, and CI exit evidence remain in progress.
