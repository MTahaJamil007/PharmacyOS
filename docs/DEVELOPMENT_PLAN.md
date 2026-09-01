# PharmacyOS — Development Plan to Production

> **Status:** Active. Supersedes `PHARMACYOS_COMPLETION_PLAN.md` and the roadmap sections of `PharmacyOS_Phase_2_Test_and_Feature_Audit.docx`.
> **Date:** 2026-08-29
> **Scope decision:** single shop · on-prem LAN · stabilize before expanding · LAN-resilient (not true-offline)

---

## Context

**Goal:** ship a Pharmacy Operating System that replaces the legacy POS/management software used by small Pakistani pharmacies.

**Confirmed direction:** single shop, on-prem LAN deployment · stabilize before expanding · LAN-resilient (not true-offline) · must-have domain gaps are **customer credit ledger (udhaar/khata)**, **non-AI owner dashboard & reports**, and **discounts / pricing / stock adjustments**. Prescription capture and the controlled-drug register are explicitly deferred.

**What was reviewed:** the whole repository — `apps/api` (24 files), `apps/web` (8 files), `apps/worker`, `packages/{config,database,shared}`, migrations 001–006, `infra/docker`, both `.docx` planning documents, the 1,596-line architecture doc, the completion plan, and both ADRs. ~10.5k LOC.

**The headline finding, stated plainly:** the engineering foundation is genuinely good — exact BigInt decimal money, DB-enforced append-only ledgers, FEFO with correct lock ordering, checksum-protected migrations, opaque return tokens, a real durable outbox. But **the product cannot currently be piloted, and several features marked "Implemented" do not survive verification.**

Three findings decide the shape of this plan:

1. **The till will not open on any counter terminal.** `infra/docker/Caddyfile:1` serves plain HTTP on `:80`. Six POS write paths call `crypto.randomUUID()` (`apps/web/src/api.ts:220,304,319,331,342,433`), which is **secure-context-only**. On `http://<lan-ip>:8080` it is `undefined`. Opening the till, cash movements, closing, variance approval, returns, and **sale finalization** all throw `TypeError` before the fetch. It works in `npm run dev` on `localhost` and fails the moment it reaches a counter.
2. **There is no version control.** `git status` → `fatal: not a git repository`. No history, no branches, no CI, no review. Every prompt in the Phase 2 playbook ends with "commit before the next prompt"; that loop was never instantiated.
3. **The documented quality gate is red today.** `npm run verify` runs `lint`, which exits 1 with 10 `no-undef` errors in `scripts/dev.mjs`. Verified by running it.

This plan is therefore ordered: **make the work provable → make the pilot possible → make it correct → make it a counter-grade POS → make it beat the incumbents → certify and pilot.**

---

## Part 1 — Status reconciliation

The published feature table is the target. This is what verification says about the rows that do not hold. Rows not listed here checked out as claimed.

| Feature                                                                                  | Claimed                | Verified reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Invoice control** — "prevents duplicate finalization if retried"                       | Implemented            | **Broken under the exact case it exists for.** `pos.service.ts:314-348` reads the replay row _before_ taking the cash-session `FOR UPDATE`. Two concurrent retries both see "no sale", both proceed → unique violation → with no `APP_FILTER` registered, raw **HTTP 500**. The client cannot tell "sale succeeded" from "sale failed". The loser also burned an invoice number → permanent gap in the fiscal sequence. Same pattern in returns, procurement ×3.                                                                    |
| **Cash sessions / cash controls**                                                        | Implemented            | Server logic is correct — `cash-sessions.service.ts:52-58` is the _one_ place idempotency is done right (locks the terminal row first). But the client crashes on `crypto.randomUUID()` before any of it is reached on a LAN terminal. Also: `returns.refund` accepts **any** open session in the branch (`returns.service.ts:170-176`) — a user can post refunds against another cashier's till.                                                                                                                                   |
| **Stock ledger** — "every sale, receipt, return, and adjustment leaves durable evidence" | Implemented            | Append-only is real (DB trigger + no TRUNCATE grant). But **adjustments are never written at all** — `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `SCRAP`, `QUARANTINE`, `TRANSFER` are declared and never used. And `quantity_after` is app-supplied with no DB check that it equals prior + delta.                                                                                                                                                                                                                                          |
| **Expiry work items** — "quarantine, resolve"                                            | Implemented foundation | **Quarantine writes no ledger row and never decrements stock.** `intelligence.service.ts:227-232` flips `status` only. There is no scrap/write-off path anywhere. Expired stock keeps `current_qty > 0` forever, so value-at-risk never converts to a recorded loss and the same units resurface in every report indefinitely. The ledger no longer explains the stock state.                                                                                                                                                       |
| **Returns** — "restock / quarantine / scrap disposition"                                 | Implemented foundation | `returns.service.ts:204-210` sets `status = 'SELLABLE'` unconditionally on restock — **a `RECALLED` batch is silently returned to sale.** And `QUARANTINE` quarantines the _entire remaining batch_: returning 1 damaged tablet pulls all 500 out of stock. No batch-split mechanism.                                                                                                                                                                                                                                               |
| **Background worker** — "durable jobs"                                                   | Implemented            | `EXPIRE_RESERVATIONS` is implemented and **has zero producers** — verified, one grep hit, the consumer. Reservations never expire, drafts stick in `RESERVED`, and the reorder engine counts them with no expiry filter (`worker.ts:430-433`) so reorder quantities inflate without bound. `REFRESH_DASHBOARD_METRICS` is a no-op that returns `COMPLETED`. A job stuck in `PROCESSING` (worker crash) is orphaned **forever** — no reaper, no visibility timeout.                                                                  |
| **Branches and terminals** — "prevents wrong-counter attribution"                        | Implemented            | Terminal codes are unique per `(branch_id, code)`, **not globally**. `auth.service.ts:32-37` is `LIMIT 1` with **no `ORDER BY`** — for a user with roles at two branches both running `COUNTER-01`, the branch bound to the session is whatever the planner returns. That branch id then drives every tenancy check.                                                                                                                                                                                                                |
| **Receipts** — "reprintable"                                                             | Implemented            | **Not reprintable.** `printReceipt` is set only at checkout and nulled on close. `getSaleReceipt` has exactly one caller. There is no find-sale→reprint path in the UI. Reprint is a several-times-daily counter operation.                                                                                                                                                                                                                                                                                                         |
| **Payments** — "cash and non-cash"                                                       | Implemented            | Payment must equal the total _exactly_ (`pos.service.ts:366-372`). **No tendered amount, no change due, no partial payment, no credit.** The cart total on screen is also computed in **floating point** — `PosWorkspace.tsx:154` `Number(salePrice) * quantity` — inside a codebase whose stated rule is that money never touches a float.                                                                                                                                                                                         |
| **FBR boundary**                                                                         | Implemented boundary   | The outbox boundary is real and correctly non-blocking. The adapter is not: `SANDBOX` **fabricates** a fiscal number (`SANDBOX-<id>`) and marks the invoice `SUBMITTED` with no HTTP call; the three real modes return `RETRYABLE` until they dead-letter silently. `fbr_invoice_attempts` is written by nothing. `tax_total`/`tax_amount` are hardcoded `0`. The payload is four fields. No `FiscalInvoiceGateway` interface exists despite the architecture specifying it verbatim.                                               |
| **Owner AI assistant**                                                                   | Implemented foundation | Design is genuinely good (no SQL, no writes, per-tool re-authorization). Three problems: the deterministic reports are reachable **only** through the AI endpoint — so with `AI_ENABLED=false` (the shipped default) **the owner has no reports at all**, which inverts the architecture's own "do not make the dashboard AI-dependent" rule. The rate limiter is racy and self-amplifying (rejections insert audit rows that extend the window). And `internal: true` on the compose network blocks the egress the provider needs. |
| **Deployment foundation**                                                                | Implemented foundation | **`docker compose up` fails at parse time.** `POSTGRES_PASSWORD` is in neither `.env` nor `.env.example` (verified: 0 occurrences in both). `env_file` overrides image `ENV`, so production runs `NODE_ENV=development` — dev CORS, request logging, seed credentials in the container. No TLS. No migration step in compose. **No backup implementation of any kind** — no script, no cron, no `pg_dump`, no restore path — against an architecture doc that rates backups "Mandatory 10/10".                                      |
| **Development fixtures**                                                                 | Implemented            | Correct, and genuinely useful.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Also silently missing from the MVP's own "included" list:** owner dashboard, discounts with role approval, stock adjustment. All three are in architecture §4 as _included_, all three have **no endpoint**, and none appears in any existing gap list. 13 of 36 seeded permissions have no route behind them.

---

## Part 2 — Defect register

Ranked. `P0` blocks pilot, `P1` blocks trust, `P2` blocks competitiveness.

### P0 — Pilot blockers

| #   | Defect                                                                                                | Location                              |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| B1  | `crypto.randomUUID()` on non-secure origin → every till/cash/return/sale write fails on LAN terminals | `apps/web/src/api.ts` ×6              |
| B2  | No TLS; bearer token, passwords, invoices in cleartext over the shop LAN                              | `infra/docker/Caddyfile:1`            |
| B3  | No git repository, no CI, no review gate                                                              | repo root                             |
| B4  | `npm run verify` exits 1 (10 `no-undef`) — the documented merge gate is red                           | `eslint.config.js`, `scripts/dev.mjs` |
| B5  | Compose won't start — `POSTGRES_PASSWORD`, `HTTP_PORT` undefined                                      | `compose.yaml:10,83`, `.env.example`  |
| B6  | Production runs `NODE_ENV=development` via `env_file` override                                        | `compose.yaml:47,67`                  |
| B7  | **No backups. None.** Only durable state is a named volume                                            | `infra/`                              |
| B8  | No migration step in compose — API can start against an empty schema                                  | `compose.yaml`                        |
| B9  | Orphaned `PROCESSING` jobs are permanent; unguarded throws kill the worker                            | `worker.ts:29,49,61`                  |
| B10 | `EXPIRE_RESERVATIONS` never enqueued → phantom reservations accumulate forever                        | `worker.ts:180-185`                   |

### P1 — Correctness & trust

| #   | Defect                                                                                                  | Location                                                                            |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| C1  | Idempotency read-then-insert race → 500 + invoice-sequence gap                                          | `pos.service.ts:314`, `returns.service.ts:57`, `procurement.service.ts:219,392,505` |
| C2  | FEFO over-reservation under READ COMMITTED; surfaces as a failed sale at the till                       | `pos.service.ts:226-249`                                                            |
| C3  | Returns flip `RECALLED`→`SELLABLE`; one unit quarantines a whole batch                                  | `returns.service.ts:204-210`                                                        |
| C4  | Expiry quarantine writes no ledger row, never decrements stock; no scrap path                           | `intelligence.service.ts:227`                                                       |
| C5  | Effective base-unit cost rounds to `0.00` for high-count packs → all margin/VAR figures wrong           | `procurement.service.ts:568-571`                                                    |
| C6  | Sale subtotal can disagree with the sum of its own line totals when FEFO splits a fractional line       | `pos.service.ts:422,434`                                                            |
| C7  | Two different rounding rules for the same computation (half-up vs ceiling)                              | `decimal.ts:27` vs `budget-regimen.ts:53`                                           |
| C8  | No logout, no revocation (`revoked_at` never written), no refresh; 30-min hard logout mid-shift         | `auth.service.ts`, `auth.guard.ts`                                                  |
| C9  | No rate limit on `/auth/login`; timing oracle; lockout never resets                                     | `auth.service.ts:40,47-52`                                                          |
| C10 | `returns.refund` accepts any cashier's open session                                                     | `returns.service.ts:170-176`                                                        |
| C11 | Login can bind the session to the wrong branch                                                          | `auth.service.ts:32-37`                                                             |
| C12 | Guard's INNER JOIN 401s a valid session whose role has zero permissions                                 | `auth.guard.ts:60-63`                                                               |
| C13 | Validation gaps turn 400s into 500s (`quantity: "0"`, no magnitude bounds); no global exception filter  | `schemas.ts:6-11`, `app.module.ts`                                                  |
| C14 | Attention dashboard silently reports `0` when no stock is near expiry                                   | `intelligence.service.ts:43-63`                                                     |
| C15 | Reorder engine leaks reservations across branches                                                       | `worker.ts:430-433`                                                                 |
| C16 | Three "idempotency" unique indexes on `(id, x)` constrain nothing                                       | `004:18-23`, `005:4-6`                                                              |
| C17 | Migration 006 grants are one-shot — **any future table will be unreadable by `pharmacy_app`**           | `006_application_role_permissions.sql`                                              |
| C18 | Effectively zero test coverage; the only API test never imports the thing it names                      | all 6 test files                                                                    |
| C19 | Float money in the cart total shown to the customer                                                     | `PosWorkspace.tsx:154`                                                              |
| C20 | Checkout is 4 sequential awaits, no rollback, regenerated `clientRequestId` on retry → double-ring risk | `PosWorkspace.tsx:164-188`                                                          |

### P2 — Counter-grade gaps

Scanner support absent (no wedge handling, no `Enter`, no debounce — a 13-digit EAN fires 13 HTTP requests) · four advertised F-keys are fake · no receipt reprint · no ESC/POS or drawer kick · no 401 interceptor · no React error boundary (any render throw = white screen mid-sale) · hardcoded fake clock and permanently-green "LAN online" light · hardcoded `'2026-12-01'` expiry threshold · no i18n/Urdu/RTL · no code splitting or router · web app doesn't depend on `@pharmacy/shared` so **client and server contracts have no compile-time link** · `qrcode` is the only unpinned dependency, on the receipt path.

---

## Part 3 — Roadmap

Six phases. Each has an explicit exit gate; **no phase starts until the prior gate is green.** Effort is developer-weeks for one experienced full-stack developer.

---

### Phase 0 — Make the work provable · ~1 week

> **Implementation status (2026-08-30):** locally complete. `npm run verify` exits `0`; the baseline is committed on `main`, and a local clean clone passes `npm ci && npm run verify`. The GitHub Actions gate is configured and awaits the first push to a remote. See `docs/PHASE_0_EXECUTION.md` for evidence and dependency decisions.

Nothing else is safe to build until changes are tracked and the gate is honest.

- **Initialize git.** `git init`, verify `.gitignore` covers `.env`, `.npm-cache*/`, `dist/`, `node_modules/`. First commit is the current tree, unmodified, as a baseline. **Rotate the credentials in `.env` first** — it contains a live 4-char superuser password and an unreplaced `SESSION_SECRET` placeholder.
- **Delete the 12 `.npm-cache*/` directories** from the working tree (already gitignored; they are install debris).
- **Fix lint.** Add `languageOptions.globals` for `.js`/`.mjs` in `eslint.config.js` — the typed block at `:19-34` only matches `**/*.{ts,tsx}`, so plain JS falls through to `recommended` with no environment globals. Then add `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y` (neither is installed; `exhaustive-deps` is currently unenforced).
- **CI on every push:** `npm ci && npm run verify`. This is the gate that makes every later phase's claims checkable.
- **Pre-commit hook** (husky + lint-staged) running `format:check` and `lint` on staged files.
- **Create `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`.** Every P2 prompt in the playbook depends on these and none exists.
- **Pin `qrcode` and `@types/qrcode` exactly** — the only two carets in the dependency set, sitting on the receipt path.

**Exit gate:** `npm run verify` exits 0 in CI on a clean clone.

---

### Phase 1 — Make the pilot possible · ~2 weeks

> **Execution status (2026-08-30):** implementation and repository verification are complete. The operational exit gate remains open pending a clean Docker host, trusted second LAN terminal, sale/receipt hardware check, and a live encrypted restore drill. See `PHASE_1_EXECUTION.md`.

Everything here is a hard blocker. None of it is feature work.

**1.1 The LAN crypto crash (B1) — do this first.**
Add `packages/shared/src/client-request-id.ts` exporting a UUID generator that prefers `crypto.randomUUID()` and falls back to `crypto.getRandomValues()` when the secure-context API is absent. Replace all six call sites in `apps/web/src/api.ts`. This is a ~20-line fix that converts a dead product into a working one.

**1.2 TLS (B2).**
Change `Caddyfile:1` from `:80` to a hostname with Caddy's `tls internal` (local CA), or provision a real cert if the shop has a domain. Add the CA to counter terminals during install. Keep an `:80`→`:443` redirect. This also restores the secure context, making 1.1 defense-in-depth rather than the sole fix. Add HSTS and a CSP at the edge — helmet currently ships with `contentSecurityPolicy: false` while the bearer token sits in `localStorage`.

**1.3 Compose actually boots (B5, B6, B8).**
Add `POSTGRES_PASSWORD` and `HTTP_PORT` to `.env.example` with a note that Compose interpolates from a file **adjacent to `compose.yaml`**, not from `env_file`. Pin `NODE_ENV: production` in the `environment:` block for `api` and `worker` so it wins over `env_file`. Add a one-shot `migrate` service with `depends_on: postgres: service_healthy`, and make `api` depend on its successful completion. Add a healthcheck to `worker` (it has none). Add resource limits to all five services — there are none, so one runaway query OOM-kills the POS.

**1.4 Backups (B7).**
The largest operational hole in the repo. Build `infra/docker/Dockerfile.backup` + a `backup` service, per architecture §13: nightly encrypted `pg_dump`, retention 7 daily / 4 weekly / 3 monthly, daily copy to an external USB SSD, and **a weekly automated restore drill that writes its result to the existing, currently-unused `backup_runs` table.** Surface the last successful backup and last successful restore in the dashboard built in Phase 4. Target restore time < 15 min. _"A backup that has never been restored is not a backup"_ — the architecture doc's own words.

**1.5 Worker reliability (B9, B10).**
Enqueue `EXPIRE_RESERVATIONS` from the 60s scheduler alongside the other four job types. Add a stale-lock reaper: reclaim rows where `status='PROCESSING' AND locked_at < now() - interval '5 minutes'`. Wrap the `run()` loop body, the `job_attempts` insert, and `enqueueOperationalJobs()` in try/catch — all three currently throw out of the loop and kill the process. Add `expires_at > now()` to the `reserved_stock` subquery in `worker.ts:430-433` and scope it by branch. Give `FAILED` jobs a surface: an endpoint and a dashboard tile, since `last_error` is currently written and read by nothing.

**1.6 Truth in the README.**
Remove the "local-first" claim (there is no service worker, no IndexedDB, no offline queue — verified) and replace it with "LAN-resilient: internet outages do not stop sales." Reconcile the port contradiction (README says 3000, `.env.example` ships 3001). Downgrade the "reprintable receipt" and "FBR" claims to match Part 1.

**Exit gate:** a fresh `docker compose up` on a clean host, from `.env.example` alone, brings up a migrated, TLS-terminated stack; a second machine on the LAN opens a cash session, completes a sale, and prints a receipt; a restore drill passes and is recorded in `backup_runs`.

---

### Phase 2 — Correctness under concurrency · ~4 weeks

> **Execution status (2026-09-01):** exit gate passed. Local `npm run verify` exited `0` with 58 unit tests, 52 Docker/PostgreSQL integration tests, five browser workflows, and all builds; GitHub Actions run `33427582589` repeated the clean-clone gate successfully on commit `4f549af`. See `PHASE_2_EXECUTION.md`.

The most important phase. This is where "Implemented" becomes "proven".

**2.1 Build the test harness first.** There is effectively none today — the one API test never imports `AuthGuard`, and the "database contract test" is `String.includes` on a `.sql` file. Nothing can be safely fixed without this.

- Add a root `vitest.config.ts` (none exists; Vitest currently falls back to `apps/web/vite.config.ts` and defaults to the `node` environment).
- **DB-backed integration harness**: testcontainers or a disposable Postgres, migrations applied per run, transactional rollback per test. This is the single highest-leverage investment in the plan.
- **Concurrency harness**: parallel clients hitting one endpoint, asserting invariants. Needed for 2.2–2.4.
- Component tests: install `@testing-library/react` + `jsdom` (absent).
- E2E: Playwright for the five core workflows.

**2.2 Fix idempotency properly (C1).** Adopt the pattern already correct in `cash-sessions.service.ts:52-58` — **take the lock before the replay read** — across `pos.finalizeSale`, `returns.requestReturn`, and all three procurement paths. Then add a global `APP_FILTER` that maps `23505` → `409 Conflict` and `23514`/`22003` → `400`, so a genuine collision is a meaningful response instead of a 500. Replace the three no-op `(id, x)` unique indexes (C16) with real ones. Prove it with a concurrency test that fires N simultaneous retries of one `clientRequestId` and asserts exactly one sale, one invoice number, no gap.

**2.3 Fix FEFO over-reservation (C2).** Either escalate `reserveDraft` to `REPEATABLE READ` with a bounded retry, or track `reserved_qty` as a column decremented under the existing row lock. Keep the ascending-`id` lock ordering at `pos.service.ts:247` — that part is correct and deliberate. Prove with a concurrency test: N terminals reserving the last unit → exactly one wins, no oversell.

**2.4 Restore ledger integrity (C3, C4).**

- Returns: preserve `RECALLED`/`QUARANTINE` instead of forcing `SELLABLE`; implement batch splitting so a partial quarantine doesn't withdraw the whole batch.
- Expiry: write a `stock_movements` row for every quarantine, and build the missing **write-off/scrap path** that actually decrements `current_qty` — so value-at-risk converts into a recorded loss.
- Add a DB trigger asserting `quantity_after = prior + delta` and that `quantity_delta`'s sign matches `movement_type`. Today both are app-trust.
- Fix C17 now, before more migrations land: add `ALTER DEFAULT PRIVILEGES` so future tables are readable by `pharmacy_app`.

**2.5 Money exactness (C5, C6, C7, C19).** Widen `cost_price` scale or store effective cost in minor units so sub-paisa base-unit costs stop rounding to `0.00`. Make `sales.subtotal` the sum of its own line totals. Unify rounding on one documented rule. Replace the float cart total in `PosWorkspace.tsx:154` with `@pharmacy/shared` money helpers.

**2.6 Auth hardening (C8–C12).** Add `POST /auth/logout` writing `revoked_at` (the column exists and is checked but never written). Add sliding expiry / refresh so a cashier isn't hard-logged-out every 30 minutes mid-shift. Add rate limiting on `/auth/login`. Make the guard's joins LEFT so a zero-permission role 403s instead of 401ing. Scope `returns.refund` to the caller's own session. Fix branch selection with a deterministic `ORDER BY`.

**2.7 Validation (C13).** Bound every money/quantity schema; use `positiveQuantitySchema` where zero is invalid; add `useGlobalPipes` + the exception filter from 2.2.

**Exit gate:** the P0 test set from the audit `.docx` — migrations, POS regression, return concurrency, shelf safety, expiry boundary, reorder math, budget safety, RBAC, AI isolation — all executed and green in CI, with recorded exit codes. _"Do not mark any gate passed merely because code exists."_

---

### Phase 3 — Counter-grade POS · ~4 weeks

> **Implementation status (2026-09-01):** software workstreams 3.1–3.7 are complete on `development`; local and hosted gates passed, followed by a deterministic 20-sale digital scanner/keyboard/print/reprint simulation. The user has no access to the required hardware or pharmacist tester and explicitly authorized Phase 4 to proceed. Physical compatibility and human-speed validation remain unpassed and are carried to the Phase 5 pilot gate; the digital result is not represented as hardware evidence.

This is where the product starts to feel better than what it replaces. A pharmacist judges a POS in the first ten minutes at the counter.

**3.1 Scanner and keyboard.** A wedge-scanner input handler (buffered keystrokes, inter-key timing heuristic, `Enter`-terminated) that auto-adds on exact barcode match. Debounce search (a 13-digit EAN currently fires 13 requests). `Enter` adds the first result. Implement the four F-keys that are already advertised on screen but wired to nothing, plus quantity-by-keyboard, `*N` multiplier, line delete, and F-key tendering. **Target: a full sale without touching the mouse.**

**3.2 Payment reality.** Tendered amount and change due — neither exists; payment must currently equal the total exactly. Split payments across methods. This is table stakes for a cash counter.

**3.3 Printing.** Keep `window.print()` as the fallback, add an ESC/POS path (WebUSB/WebSerial or a small local print agent) for reliable 80 mm output plus **cash-drawer kick**. Build the **receipt reprint** path — find sale → reprint — which does not exist today. Add error handling to the QR effect, which currently fails silently and prints a receipt with no return token.

**3.4 Resilience at the counter.** Persist the cart to `localStorage` (an F5 currently loses a sale in progress). Add a React error boundary — there is none, so any render throw white-screens mid-sale. Add a 401 interceptor with a re-auth modal. Make checkout resumable: reuse one `clientRequestId` across retries (it is currently regenerated, defeating the server's dedup) and handle "finalized but receipt fetch failed" without implying the sale failed.

**3.5 Delete the lies in the UI.** The hardcoded clock (`Thu · 20 Aug / 12:42 PM`), the permanently-green "LAN online" dot wired to nothing, the static "Draft / Not reserved" labels, and the hardcoded `'2026-12-01'` expiry threshold that will flag every item in the catalog from that date onward.

**3.6 Structural.** Introduce a real router and split the 983-line `OperationalWorkspace.tsx` (four unrelated business domains in one file) into `modules/{pos,cash,inventory,returns,dashboard}`. Add code splitting so a cashier terminal stops downloading the owner-AI screen and the QR encoder. **Make `apps/web` depend on `@pharmacy/shared`** so the ~15 hand-redeclared interfaces in `api.ts` become compile-time-checked against the server. Add focus management to the receipt modal (currently `role="dialog"` with no trap, no initial focus, no Escape).

**3.7 Urdu/RTL foundation.** Extract strings to a message catalog and add `dir` handling now, while there are 8 files. Retrofitting later means touching every file and most of the 1,538-line stylesheet. Full Urdu translation can follow; the plumbing must land here.

**Exit gate:** a pharmacist completes 20 consecutive sales keyboard-and-scanner-only, on a counter terminal, with printing and reprint working, and rates it faster than their current system.

---

### Phase 4 — Beat the incumbents · ~5 weeks

> **Execution status (2026-09-01):** software exit gate passed on `development` under the explicit Phase 3 physical-hardware waiver recorded in `PHASE_3_EXECUTION.md`. The public-API owner-day scenario and owner-facing browser gate passed; full verification exited `0` with 69 unit tests, 55 Docker/PostgreSQL integration tests, nine browser workflows, and all production builds. See `PHASE_4_EXECUTION.md`. Physical Phase 3 evidence remains a Phase 5 pilot prerequisite.

The three chosen must-haves. These are what legacy systems have and PharmacyOS does not.

**4.1 Customers + credit ledger (udhaar/khata) — the biggest competitive gap.**
`sales` has **no customer reference of any kind** today. Build:

- `customers` (name, phone, address, credit limit, opening balance) and `customer_ledger_entries` (append-only, like the stock ledger — sale, payment, adjustment, with running balance).
- Optional customer attach at POS with fast phone-number lookup.
- `CREDIT` as a payment method, gated by credit limit and a permission.
- Payment-against-account (a customer pays down their khata, partially or fully), aged-balance report, per-customer statement, and a daily receivables total on the dashboard.
- Enforce the ledger invariant in the DB, not in the app — the same discipline already applied to stock movements.

**4.2 Owner dashboard & reports (non-AI).**
Today `OwnerToolsService` is injected into exactly one consumer, `OwnerAiService`, exposed only by `POST /owner-ai/chat`. **With `AI_ENABLED=false` — the shipped default — the owner sees nothing.** Fix the layering:

- Extract the deterministic reports into a `reports` module with its own endpoints, behind the already-seeded `reports.view_basic` / `reports.view_financial` permissions.
- Build a `dashboard` module for the 12 metrics the architecture specifies, and make `REFRESH_DASHBOARD_METRICS` write `dashboard_daily_metrics` instead of returning `COMPLETED` immediately.
- Build the owner UI: daily sales, gross profit, top movers, dead stock, expiry value at risk, cash variance history, receivables, failed fiscal submissions, last backup + last restore drill.
- A charting library is needed — none is installed.
- **The AI assistant then explains the dashboard rather than being the only way to reach it**, which is what architecture §12 required all along.

**4.3 Discounts, pricing & stock adjustments.**
All three were in the MVP's own "included" list and silently disappeared.

- **Discounts:** line and invoice level, with the supervisor-approval threshold the roles already imply. `discount_total` / `discount_amount` columns exist and are always `0`; `sale.discount.basic` and `sale.discount.override` are seeded with no route.
- **Pricing:** an MRP/sale-price management screen with price history — batch-level prices are currently only settable at goods receipt.
- **Stock adjustments:** a counted-adjustment and scrap workflow writing the `ADJUSTMENT_IN`/`ADJUSTMENT_OUT`/`SCRAP` movement types that are declared and never used, behind the seeded `inventory.adjust` permission. Add physical stock take / cycle count — a monthly reality in every pharmacy and absent here.

**4.4 Close the remaining CRUD gaps** that block day-two operation: user management and password change (**no way to create a user or change a password exists outside the bootstrap script**), catalog CRUD (only `GET medicines/search` exists), supplier CRUD, shelf management, terminal registration, and a settings screen for `operational_intelligence_policies`. These retire most of the 13 orphaned permissions.

**Exit gate:** a pharmacy owner runs a full day — open till, credit sales to regulars, a customer paying down their khata, a discounted sale, a stock adjustment, close till, read the day's report — without touching psql.

---

### Phase 5 — Fiscal, observability & pilot · ~4 weeks

**Execution status (2026-09-01):** repository-controlled fiscal/tax, observability, alerting, hot-path, performance, and pilot-preparation work is implemented; focused software/performance gates pass. The overall exit gate remains blocked on explicit outbound-data approval, licensed-integrator and tax-adviser validation, real FBR sandbox evidence, physical hardware/LAN/external-disk tests, and the 14-day pharmacy pilot. See `docs/PHASE_5_EXECUTION.md` and `docs/PILOT_RUNBOOK.md`.

**5.1 FBR.** Build the `FiscalInvoiceGateway` interface the architecture specifies verbatim (`validateInvoice` / `submitInvoice` / `getReferenceData`) — it does not exist. Add the tax fields the current model lacks entirely: seller NTN/STRN, POS registration number, per-item HS codes, tax rates. `tax_total` and `tax_amount` are hardcoded `0` today. Persist every attempt to `fbr_invoice_attempts` (currently written by nothing). **Make `SANDBOX` call a real sandbox instead of fabricating `SANDBOX-<id>` and marking the invoice `SUBMITTED`.** Fix the compose `internal: true` network that blocks the egress this needs. Engage a licensed integrator — FBR requires one — and confirm with a Pakistani tax professional whether printing before fiscalization is acceptable for the pharmacy's tier, as the architecture doc itself flags.

**5.2 Observability.** Structured logging in production (currently Fastify logs only in development, so production logs almost nothing), correlation IDs, `/metrics`, error tracking, and alerting on: failed jobs, failed fiscal submissions, cash variances over threshold, and **backup/restore failures**.

**5.3 Performance against the stated targets.** Search p95 < 150 ms, barcode < 80 ms, finalize < 300 ms, dashboard < 2 s — at representative volume (10k–50k medicines, 200k batches, 300–1,500 invoices/day). Fix the round-trip amplification first: `receivePurchaseOrder` runs up to **2,500 round trips in one transaction** holding locks, against a 15 s request timeout; `pendingVariance` fans 50 parallel calls at a pool of 10; the auth guard runs a 5-table join on **every** request with no caching.

**5.4 Pilot.** Hardware matrix (printer/scanner/drawer), UPS, install runbook, staff training, and a rollback plan. Then one friendly pharmacy, running in parallel with their existing system for two weeks.

**Exit gate — the audit `.docx`'s own release gate:** **BLOCK** on any authorization bypass, duplicate refund, inventory corruption, unsafe shelf placement, money/rounding error, secret leak, or failed restore. **PILOT** only when all P0 pass, critical P1 journeys pass, performance is acceptable at representative volume, and backup/restore is proven.

---

## Part 4 — Verification strategy

The gap between "the mechanism exists" and "the mechanism is correct under concurrency and covered by a test" is where this codebase currently sits. Every phase above is gated on evidence, not on code existing.

| Layer           | Today                                                    | Target                                                                                                                                             |
| --------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit            | 4 real files, ~26 assertions, all pure helpers           | All money, FEFO, reorder, expiry-bucket, regimen, and credit-ledger math                                                                           |
| DB integration  | 0 (the "contract test" is `String.includes` on SQL text) | Every migration applied and rolled back; every constraint and trigger asserted                                                                     |
| API integration | 0                                                        | Every endpoint × every role × unauthorized × cross-branch                                                                                          |
| **Concurrency** | 0                                                        | The 8 named races: double finalize, oversell, double refund, cash close, invoice numbering, goods receipt, worker double-claim, reservation expiry |
| Component       | 0 (no jsdom, no testing-library)                         | POS cart, checkout, cash count, return flow                                                                                                        |
| E2E             | 0 (no Playwright)                                        | The 5 core workflows                                                                                                                               |
| Performance     | 0                                                        | The four p95 targets at representative volume                                                                                                      |
| Restore drill   | 0                                                        | Weekly, automated, recorded in `backup_runs`                                                                                                       |

**Standing rule for this project, from its own audit document:** record actual exit codes and outputs; never mark a gate passed because the code exists or the command is planned.

---

## Part 5 — Sequencing and risk

**Critical path:** Phase 0 → 1.1/1.2 (LAN + TLS) → 2.1 (test harness) → everything else. The first two unblock any real-world use; 2.1 unblocks safe change.

**Parallelizable once Phase 2 is green:** 3.x (frontend) and 4.x (backend domain) can run concurrently if a second developer joins. 5.1 (FBR) should start early — licensed-integrator engagement has external lead time measured in weeks.

**Risks:**

- **FBR certification is the longest external dependency.** Start the integrator conversation during Phase 1, not Phase 5.
- **Phase 2 will surface more defects.** The estimate assumes the first real integration tests find issues the static review could not. Treat 4 weeks as a floor.
- **Rewriting for offline later is expensive.** The LAN-resilient choice is right for the pilot, but if chains or unreliable-power sites become the target, revisit before Phase 4 — retrofitting sync after the customer ledger exists is materially harder.
- **The single-shop scope is not a dead end.** `branch_id` is already on every transactional table. Multi-branch is a later phase, not a rewrite — provided the cross-branch leaks (C11, C15) are fixed in Phase 2 rather than being allowed to set a precedent.

**Rough total: 20 developer-weeks to a defensible pilot** (~5 months solo, ~3 with two developers). Phases 0–2 are ~7 weeks and are non-negotiable; they convert a codebase that cannot be piloted into one that can be trusted.

---

## Part 6 — Documents to produce

As part of execution, not after it:

1. `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md` — Phase 0. The entire Phase 2 prompt playbook assumes these exist.
2. **ADRs for the undocumented deviations already made:** dropping Prisma, dropping the repository layer, collapsing 17 modules into 10, omitting the backup service, routing owner reports through the AI endpoint. None is recorded; all contradict the architecture doc.
3. **New ADRs** for: LAN-resilient over local-first, the customer-credit ledger model, the fiscal adapter design.
4. `docs/RUNBOOK.md` — install, backup/restore, upgrade, rollback, incident response.
5. `docs/OPERATIONS.md` — daily open/close, month-end, stock take.
6. **Reconcile the three competing roadmap taxonomies** (Milestones 0–14, Prompts P2-01…11, Phases A–L) into this one. They currently have no mapping between them.
7. **Correct the README and the feature table** against Part 1 — an accurate status table is worth more than an optimistic one, and this plan supersedes both.
