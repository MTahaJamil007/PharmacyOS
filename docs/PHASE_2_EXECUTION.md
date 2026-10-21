# Phase 2 Execution — Correctness Under Concurrency

- **Roadmap source:** `docs/DEVELOPMENT_PLAN.md`
- **Started:** 2026-08-31
- **Status:** exit gate passed
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

| Command                                 | Exit code | Result                                                                                                                                   |
| --------------------------------------- | --------: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm view` for Phase 2 harness packages |         0 | Resolved current stable exact versions on 2026-08-31                                                                                     |
| Root harness type-check and lint        |         0 | New Vitest, migration, rollback, and concurrency code passed                                                                             |
| `npm run test:integration`              |         0 | Disposable PostgreSQL 18 started; four DB-backed tests passed; container removed automatically                                           |
| Root `npm run typecheck`                |         0 | Root harness and all six workspaces passed after the transactional changes                                                               |
| Migration + ledger integration tests    |         0 | Two files and nine tests passed against disposable PostgreSQL 18                                                                         |
| `npm run test:integration`              |         0 | Three files and 11 tests passed; migration, POS races, refunds, and ledgers were green                                                   |
| `npm run test:unit`                     |         0 | 27 tests passed across API, web, worker, config, database, and shared workspaces                                                         |
| Root `npm run typecheck`                |         0 | Root harness and all workspaces passed after the money-boundary changes                                                                  |
| `npm run test:integration`              |         0 | Four files and 13 tests passed, including sub-paisa receipt and fractional FEFO sale totals                                              |
| Root `npm run typecheck`                |         0 | Root harness and every workspace passed after auth/session changes                                                                       |
| Auth integration test                   |         0 | Four scenarios passed against PostgreSQL 18                                                                                              |
| `npm run test:integration`              |         0 | Five files and 17 tests passed across migrations, POS, ledger, money, refunds, and auth                                                  |
| `npm run test:unit`                     |         0 | 35 tests passed across all six workspaces                                                                                                |
| `npm run lint`                          |         0 | ESLint completed with zero warnings                                                                                                      |
| Validation integration test             |         0 | Five boundary, prototype-key, and oversized-identifier cases passed against PostgreSQL 18                                                |
| `npm run test:unit`                     |         0 | 48 tests passed across all six workspaces after validation hardening                                                                     |
| `npm run lint`                          |         0 | ESLint completed with zero warnings after validation hardening                                                                           |
| `npm run test:integration`              |         0 | Six files and 22 tests passed across all Docker-backed Phase 2 integration suites                                                        |
| Phase 2 P0 intelligence suite           |         0 | Four shelf, expiry, reorder, and budget scenarios passed against disposable PostgreSQL 18                                                |
| Phase 2 return-concurrency suite        |         0 | Four scenarios passed, including two requests competing for the final returnable unit                                                    |
| Phase 2 RBAC matrix                     |         0 | 24 endpoint and isolation scenarios passed against disposable PostgreSQL 18                                                              |
| Phase 2 AI unit suite                   |         0 | 23 API tests passed, including disabled, timeout, rate-limit, malformed, and grounding failures                                          |
| `npm run test:e2e`                      |         0 | All five required counter workflows passed in Chromium-compatible Chrome                                                                 |
| `npm run verify`                        |         0 | Formatting, lint, type-check, 58 unit tests, 52 Docker integration tests, five E2E tests, and all production builds passed on 2026-08-31 |
| GitHub Actions `Quality gate`           |         0 | Clean Ubuntu clone passed on commit `4f549af7fe38e0ccf4ad46402871578e18290261`; run `33427582589` on 2026-08-31                          |

## P0 exit matrix

| Audit requirement  | Objective evidence                                                                                                                                      | Result |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Migrations         | A copied applied migration is tampered with; the production migration runner rejects the checksum mismatch                                              | Pass   |
| POS regression     | Parallel finalization, last-unit FEFO, fractional reservation pricing, immutable receipt lines, and exact header totals pass against PostgreSQL 18      | Pass   |
| Return concurrency | Two requests compete for the final returnable unit; one succeeds, one is rejected, retries are idempotent, and the original sale item remains immutable | Pass   |
| Shelf safety       | Unsafe and stale shelf recommendations cannot move stock; application revalidates state atomically before writing the append-only ledger                | Pass   |
| Expiry boundary    | Branch-local dates determine sellability and expiration; exact-boundary stock is excluded and acquisition cost remains exact                            | Pass   |
| Reorder math       | No-history, stockout, minimum stock, MOQ, pack multiple, near-expiry, and replay cases pass; no purchase order is created automatically                 | Pass   |
| Budget safety      | Zero-day, multi-medicine, fractional, and stale-price cases use exact arithmetic; checkout recalculates current prices                                  | Pass   |
| RBAC               | 24 allowed/denied endpoint cases prove empty-role denial, branch isolation, system-admin business isolation, and tool-level authorization rechecks      | Pass   |
| AI isolation       | Disabled mode performs no provider call; timeouts, 429s, malformed output, tool failures, numeric contradictions, and secret-bearing errors fail safely | Pass   |

## Browser exit workflows

- Sign in and sign out.
- Complete a cash sale and render its printable receipt.
- Open, adjust, and close a cash session.
- Review shelf-safety and reorder recommendations.
- Look up, request, approve, and refund a return.

On this Windows host, Playwright used the installed Chrome binary because the pinned Playwright browser download was unavailable. The GitHub Actions workflow installs the pinned Playwright Chromium package before running the same `npm run verify` command.

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
- **Login throttling:** IP and normalized-username scopes are SHA-256 hashed and serialized with transaction advisory locks. The configured limit is consumed before Argon2 work, so parallel attempts cannot bypass it. Unknown usernames verify against a fixed Argon2id dummy hash and receive the same `401` response as invalid credentials. Audit evidence distinguishes ordinary failures from throttled attempts without using audit-row counts as limiter state.
- **Account lockout:** failure counts use an explicit 15-minute window and a fixed lock expiry. Attempts during a lock do not extend it; the next failure after an expired window starts again at one. Successful login clears the account failure state.
- **Session lifetime:** a session has a 30-minute idle expiry that refreshes after half the idle window, bounded by a non-extendable 12-hour absolute expiry. `POST /auth/logout` records revocation and an audit event; both web sign-out controls call it before discarding the local session.
- **Authorization:** duplicate terminal codes bind deterministically by branch and terminal ID. The guard uses left joins below the assigned role, so a valid zero-permission session authenticates and receives `403` for a forbidden operation instead of a misleading `401`.
- **Refund ownership:** a cash refund accepts only an open session owned by the authenticated user on the authenticated terminal. The integration suite rejects another cashier's open till before proving one refund under eight concurrent retries.
- **Exact validation bounds:** identifiers, quantities, and money are bounded to the corresponding PostgreSQL domains without converting input to JavaScript `Number`. Required-positive fields reject every representation of zero, and range endpoints are validated in chronological order.
- **Request shape:** a global request-boundary pipe limits key length, nesting, array size, and traversed nodes, and rejects prototype-mutating keys before controllers execute. The raw-JSON integration test proves `__proto__` is rejected at the application boundary.
- **Normalized failures:** expected uniqueness, foreign-key, constraint, invalid-text, range, serialization, deadlock, and timeout failures have stable non-`500` responses; unexpected database failures remain on Nest's normal internal-error path and do not disclose database details.

## Findings resolved during execution

- PostgreSQL 18 treated untyped quantity parameters in subtraction and unary negation as ambiguous. Transactional quantity expressions now cast parameters explicitly to `numeric`.
- The development seed previously created historical sale movements without an opening stock movement. It now writes a 50-unit opening balance and decrements each historical sale from the ledger-derived quantity; reruns preserve batches that already have history.
- The first Docker-backed test attempt exited `1` because the managed shell could not access the Docker Desktop executable. After granting the test process access to the installed runtime, all disposable-container runs completed and cleaned up normally. This was a host permission issue, not a repository failure.

## Gate status

The Phase 2 exit gate is **passed**. The complete P0 suite passed locally and in [GitHub Actions run 33427582589](https://github.com/MTahaJamil007/PharmacyOS/actions/runs/33427582589) from a clean Ubuntu clone at commit `4f549af7fe38e0ccf4ad46402871578e18290261`. The first hosted run exposed a web workspace alias that depended on generated local output; commit `4f549af` made that dependency explicit and the repeated hosted gate exited `0`.

## Post-gate change record — 2026-09-26: automatic terminal selection and dependency recovery

### Sign-in no longer asks for a terminal code

`loginSchema` now treats `terminalCode` as optional and accepts an optional `preferredTerminalCode`.
`AuthService.login` authenticates the account first, then resolves the terminal in a fixed order:

1. `terminalCode`, when supplied, binds the session to exactly that terminal and fails the sign-in
   when the account may not use it. The response stays the generic `Invalid credentials or terminal`.
2. `preferredTerminalCode` — the terminal the browser last opened — is used when it still resolves
   and is silently ignored when it does not, so a renamed or deactivated terminal cannot lock a
   device out.
3. Otherwise the terminal is chosen for the account: the terminal it opened most recently, then the
   first active terminal ordered by type (`SALES_COUNTER`, `CASHIER`, other), code, branch, and
   terminal id.

Every path still requires an active terminal in an active branch where the account holds a
`user_branch_roles` row, and duplicate terminal codes still bind deterministically by branch and
terminal id. An authenticated account with no usable terminal receives `401` with
`No active terminal is available for this account`. `AUTH.LOGIN_FAILED` and
`AUTH.LOGIN_RATE_LIMITED` metadata now records `terminalSelection` (`EXPLICIT`, `REMEMBERED`, or
`AUTOMATIC`) beside the submitted code.

The web client asks only for username and password. It remembers the terminal a device opened in
`localStorage` under `pharmacy-device-terminal`, sends it as a preference, and keeps a
`Change terminal` control for the multi-terminal case. The re-authentication dialog binds to the
terminal that already holds the counter's work instead of offering an editable field.

### Dependency recovery

`npm audit fix --force` had moved `@nestjs/platform-fastify` to `12.1.0` against NestJS 11, which
broke API boot with `ERR_MODULE_NOT_FOUND` for `@nestjs/common/internal`. The dependency is pinned
back to `11.2.3`. No `11.x` release ships a patched Fastify, so `fastify` is pinned to `5.12.5` in
`apps/api` with a root `overrides` entry that also replaces the copy `@nestjs/platform-fastify`
pins; this closes GHSA-w2qp-rph6-63g4 and GHSA-3m5p-2c4r-xxw2 without a major NestJS change.
`@nestjs/platform-fastify@11.2.3` is now a root `devDependency` because
`tests/integration/harness/api.ts` imports it directly and previously relied on hoisting.

### Development boot fix

`DatabaseExceptionFilter` injected `HttpAdapterHost` by constructor type only. `tsx` and Vitest
transpile with esbuild, which emits no `design:paramtypes` metadata, so Nest injected `undefined`
and `npm run dev` aborted with `Cannot read properties of undefined (reading 'httpAdapter')` even
though the `tsc` build worked. The dependency is now injected by token, matching the rest of the
application.

### Commands and exit codes

| Command                    | Exit code | Notes                                                               |
| -------------------------- | --------- | ------------------------------------------------------------------- |
| `npm install`              | 0         | `found 0 vulnerabilities`                                           |
| `npm audit`                | 0         | No advisories reported                                              |
| `npm run format:check`     | 0         |                                                                     |
| `npm run lint`             | 0         |                                                                     |
| `npm run typecheck`        | 0         |                                                                     |
| `npm run test:unit`        | 0         | 103 tests, including four new `LoginScreen` cases                   |
| `npm run test:e2e`         | 0         | 14 Playwright tests                                                 |
| `npm run build`            | 0         |                                                                     |
| `npm run test:integration` | 1         | No container runtime on this host; Docker Desktop was not available |

`npm run verify` was therefore not completed end to end: its `test:integration` stage cannot run
without a container runtime.

### Unverified operational assumptions

- The four new cases in `tests/integration/auth-hardening.integration.test.ts` — automatic
  selection, fallback from an unusable remembered code, rejection of an explicit terminal the
  account may not use, and the no-terminal message — are written but **not executed**. They require
  Docker.
- A live sign-in against the local PostgreSQL instance was not exercised: the host's PostgreSQL 18
  installation was still in progress, so `/health/ready` and `/auth/login` returned `500` from
  `ECONNREFUSED`. The API itself booted and mapped every route after the dependency and injection
  fixes.
- Terminal memory lives in the browser profile. A shared browser profile moved between physical
  counters will offer the wrong terminal as its preference until an operator uses
  `Change terminal`.

## Post-gate change record — 2026-09-26 (second pass): local cluster bootstrap and DI metadata

Signing in on a native (non-container) PostgreSQL installation failed with `500 Internal Server
Error`. Two further defects were behind it, both independent of the terminal-selection work above.

### The local cluster was never provisioned

`.env` names `pharmacy_app` and database `pharmacy_os`, and the Compose stack creates the role from
`infra/docker/postgres-init-app-role.sh`. A native PostgreSQL 18 installation has no equivalent
hook, and the documented steps went straight from "Start PostgreSQL" to `npm run db:migrate`. On
this host neither the role nor the database existed, so the API failed with `28P01` and the worker
logged the same error on every loop. `packages/database/src/bootstrap-cluster.ts`
(`npm run db:bootstrap:local`) now creates the login role and database that `DATABASE_URL` names,
administering through `DATABASE_ADMIN_URL`. It is idempotent, drops nothing, aligns only the
password of an existing role, refuses to run with `NODE_ENV=production`, and lets PostgreSQL's own
`format('%I'/'%L')` quote every identifier and the password, because a utility statement cannot bind
them as parameters. README step 3 now names the command.

### Successful responses never completed

`RequestMetricsInterceptor` took `MetricsService` as a constructor type without `@Inject`, the same
defect found in `DatabaseExceptionFilter`. Under `tsx` and Vitest the dependency resolved to
`undefined`, so `finalize()` threw inside the RxJS pipeline and the reply was never sent: every
successful request hung, while failures still answered through the exception filter. This is why the
earlier `500` responses arrived but `/health/live` did not. Both are now injected by token, and
`AGENTS.md` records the rule. A sweep of `apps/api/src` and `apps/worker/src` found no other
Nest-managed constructor relying on implicit metadata; `StructuredLogger`, `GeminiProvider`, and the
worker classes are constructed explicitly.

### Commands and exit codes

| Command                                             | Exit code | Result                                                 |
| --------------------------------------------------- | --------- | ------------------------------------------------------ |
| `npm run db:bootstrap:local`                        | 0         | Created role `pharmacy_app` and database `pharmacy_os` |
| `npm run db:migrate`                                | 0         | Applied migrations 001–015                             |
| `npm run db:seed`                                   | 0         | Seeded roles and permissions                           |
| `npm run bootstrap:owner --workspace @pharmacy/api` | 0         | Owner ready on terminal `ADMIN-01` in branch `MAIN`    |
| `GET /api/v1/health/ready`                          | —         | `{"status":"ready","database":"connected"}`            |

### Live sign-in evidence

Against this cluster, `POST /api/v1/auth/login` behaved as designed:

| Request                          | Response                                                 |
| -------------------------------- | -------------------------------------------------------- |
| username and password only       | `201`, opened `ADMIN-01` ("Owner / admin") in branch `1` |
| `preferredTerminalCode: GONE-99` | `201`, fell back to the automatic choice                 |
| `terminalCode: GONE-99`          | `401 Invalid credentials or terminal`                    |
| wrong password                   | `401 Invalid credentials or terminal`                    |

This closes the "live sign-in was not exercised" limitation recorded in the first pass above. The
integration suite remains unexecuted: it provisions disposable containers and this host has no
container runtime.
