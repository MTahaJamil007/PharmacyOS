# Phase 6 Execution — Prove It on Real Equipment

- **Roadmap source:** `docs/PHARMACY_OS_COMPLETION_ROADMAP.md`
- **Started:** 2026-09-21
- **Branch:** `development`
- **Repository-controlled status:** the software half of Phase 6 is implemented and its focused gates pass
- **Overall exit gate:** **not passed.** Every remaining item needs equipment, a site, or a signature; none of it can be produced by writing code.

Phase 6 has two halves. This document records both honestly and does not let the completed half imply the other.

| Half                                                                     | Status                        |
| ------------------------------------------------------------------------ | ----------------------------- |
| **Software prerequisites** — surfaces the operator needs before cutover  | **Implemented; gates passed** |
| **Operational evidence** — hardware, site, fiscal approval, 14-day pilot | **Not started; blocked**      |

---

## 1. Software delivered in this phase

### 1.1 Fiscal operations surface (roadmap 7.1, pulled forward — 6.4 depends on it)

Turning on outbound fiscal transmission without a screen that can see and retry a failed submission would put the operator in `psql` on their first bad day. That surface now exists.

- `GET /fiscal/invoices` — branch-scoped status counts across all nine fiscal states plus a filtered invoice list, behind `fbr.view_status`.
- `GET /fiscal/invoices/:id/attempts` — the durable `fbr_invoice_attempts` history for one record: operation, outcome, HTTP status, duration, correlation id, and error.
- `POST /fiscal/invoices/:id/retry` — behind `fbr.retry`, requiring a written reason of at least ten characters, idempotent on `clientRequestId`, and audited as `FISCAL.RETRY_REQUESTED`.
- The Operations workspace at `/operations` renders all of the above with a retry action.

**Two safety rules are enforced in the service, not only in the UI:**

1. An invoice that already carries a `fiscal_invoice_number` **cannot** be retried. It returns `409`. This is ADR 0004's ambiguity rule: a blind resubmission can create a duplicate fiscal invoice.
2. A retry never calls the gateway inline. It resets the existing durable outbox row so the worker owns the transmission, which keeps the counter independent of the fiscal endpoint.

### 1.2 Backup and restore evidence surface

- `GET /operations/backups` behind `backup.restore`: the last successful backup, the last successful restore drill, and the recent `backup_runs` history with destination, encryption flag, size, duration, and checksum.
- Rendered in the Operations workspace, which supports the Phase 1 operational checks in section 2 below.
- **Deliberately read-only.** A restore is destructive and is run from the host with `docs/RUNBOOK.md`. The application shows the evidence trail; it is not a control.

### 1.3 Bulk catalog import (roadmap 8.3, pulled forward — 6.5 depends on it)

A pharmacy onboards from a spreadsheet, not from four thousand individual form submissions, and a wrong catalog invalidates every otherwise-correct figure the system produces.

- `POST /admin/medicines/import` with `mode: VALIDATE | APPLY`, behind `settings.manage_system`.
- `VALIDATE` never writes. It reports created/updated counts plus a per-row, per-field issue list.
- `APPLY` re-validates and **refuses to write anything if any row is still rejected**, then runs as a single transaction, idempotent on `clientRequestId`.
- Rows match an existing medicine by SKU or barcode; a file that names the same SKU or barcode twice is rejected on both lines rather than silently applying the last one.
- The browser parses the CSV (RFC 4180 quoting, CRLF, common heading spellings such as `Brand Name`, `Salt`, `EAN`, `Rx`), reports ignored columns instead of dropping them silently, and omits blank cells so the server applies its own defaults.

### 1.4 Orphaned permissions closed

The audit found five seeded permissions with no enforcement anywhere. All five are now real:

| Permission            | Now enforced by                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `fbr.view_status`     | `GET /fiscal/invoices`, `GET /fiscal/invoices/:id/attempts`                                            |
| `fbr.retry`           | `POST /fiscal/invoices/:id/retry`                                                                      |
| `backup.restore`      | `GET /operations/backups`                                                                              |
| `ai.audit.read`       | `GET /owner-ai/audits` — who used which deterministic tool; question text is never stored, only hashed |
| `returns.refund_cash` | `ReturnsService.refund` rejects a `CASH` refund without it                                             |

`analytics.owner.read` now also opens the owner dashboard, through a new `RequireAnyPermission` decorator: a destination legitimately reachable by two roles should not force one of them to hold the other's permission.

**Three permissions the audit listed as orphaned were wrong and are corrected here.** `sale.discount.override`, `sales.budget_regimen.verify`, and `customer.credit` are enforced inside their services, which is the correct design — a basic cashier must be able to call the discount endpoint and supply supervisor credentials, so a route guard would be wrong. The audit's claim that they were unenforced did not survive re-reading the services.

### 1.5 Role decision recorded

`INVENTORY_MANAGER` holds `inventory.purchase` but not `procurement.purchase_draft.approve`, so it can draft a purchase order and receive goods but cannot mark an order as ordered. **This is intended segregation of duties: the person who receives stock is not the person who commits the shop's money.** It was previously undocumented and looked like a seed oversight. The purchasing screen now states it on the order rather than failing with a 403.

---

## 2. Operational evidence still required — none of it is code

These are unchanged from the Phase 1, 3, and 5 exit gates. **Nothing below has been attempted.**

### 2.1 Site and hardware (blocking prerequisite)

Record model, serial, firmware/driver, connection, warranty contact, and assigned terminal for each:

| #   | Item                     | Acquired | Model / serial | Assigned terminal |
| --- | ------------------------ | -------- | -------------- | ----------------- |
| 1   | Production server        | ☐        |                |                   |
| 2   | Second counter terminal  | ☐        |                |                   |
| 3   | Barcode scanner          | ☐        |                |                   |
| 4   | 80 mm ESC/POS printer    | ☐        |                |                   |
| 5   | Cash drawer              | ☐        |                |                   |
| 6   | UPS                      | ☐        |                |                   |
| 7   | External SSD for backups | ☐        |                |                   |

### 2.2 Phase 1 operational gate

| #   | Check                                 | Pass condition                                                                                         | Done |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---- |
| 1   | Trust the internal CA on terminal two | No certificate warning; HTTP redirects to HTTPS; correct hostname; correct terminal clock              | ☐    |
| 2   | Real sale from terminal two           | Open till → scan → reserve → finalize → reload; sale, payment, stock movement, and invoice all present | ☐    |
| 3   | Backup to the physical external disk  | Encrypted dump **and** SHA-256 sidecar on the mounted device, not a local directory that resembles one | ☐    |
| 4   | Restore from that physical copy       | Checksum, decryption, restore, and application-role validation pass in under 15 minutes                | ☐    |
| 5   | `backup_runs` records the restore     | Visible in the Operations workspace with a duration                                                    | ☐    |

### 2.3 Phase 3 physical gate

| #   | Check                   | Pass condition                                                                                         | Done |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------ | ---- |
| 1   | Scanner compatibility   | 30 configured and 10 unknown rapid scans, one controlled lookup each, no dropped or doubled characters | ☐    |
| 2   | Printer output          | Original and searched reprint unclipped and readable at 80 mm, with the expected return/fiscal QR      | ☐    |
| 3   | Reprint audit           | Each reprint leaves an audit row                                                                       | ☐    |
| 4   | Drawer compatibility    | Opens only for configured authorized cash events; a drawer failure never alters a completed sale       | ☐    |
| 5   | Pharmacist counter gate | 20 consecutive scanner-and-keyboard-only sales, with a recorded speed comparison to the current system | ☐    |

### 2.4 Fiscal activation — external lead time, start immediately

| #   | Requirement                                              | Owner               | Done |
| --- | -------------------------------------------------------- | ------------------- | ---- |
| 1   | Written outbound-data approval                           | Pharmacy owner      | ☐    |
| 2   | Licensed integrator engaged                              | Implementation lead | ☐    |
| 3   | Pakistani tax adviser confirmation                       | Pharmacy owner      | ☐    |
| 4   | Privacy/retention policy for customer and buyer identity | Privacy owner       | ☐    |
| 5   | Worker wired to the approved gateway calls               | Implementation lead | ☐    |
| 6   | Real sandbox validate/submit evidence persisted          | Integrator          | ☐    |
| 7   | Credit-note/return mapping approved and tested           | Integrator          | ☐    |

**Until every row above is signed, `FBR_MODE=DISABLED` stays.** Possession of a token is not approval to transmit data.

### 2.5 Master data, roles, UPS, and the pilot

| #   | Check                                            | Pass condition                                                                                 | Done |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---- |
| 1   | Catalog imported and reconciled                  | `VALIDATE` reports zero rejected rows; counts and totals signed off                            | ☐    |
| 2   | Opening stock, batches, expiry dates, shelves    | Physically counted and reconciled against the import                                           | ☐    |
| 3   | Named individual accounts; shared logins removed | Role matrix signed                                                                             | ☐    |
| 4   | UPS test                                         | Under supervised mains removal the server, network, and counter stay up, then shut down safely | ☐    |
| 5   | 14-day parallel pilot                            | One signed daily reconciliation per operating day, per `PILOT_RUNBOOK.md`                      | ☐    |
| 6   | Cutover decision                                 | Written PASS/BLOCK against the stop conditions                                                 | ☐    |

---

## 3. Objective evidence from this session

Commands run from the repository root on 2026-09-21, Windows 11, Node 22.20.0, npm 10.9.3.

| Command                    | Exit        | Evidence                                                                                                                     |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`     | 0           | Clean.                                                                                                                       |
| `npm run lint`             | 0           | Clean at `--max-warnings 0`.                                                                                                 |
| `npm run typecheck`        | 0           | Root plus all six workspace projects, strict.                                                                                |
| `npm run test:unit`        | 0           | 100 unit tests (91 before this phase, 9 added for catalog CSV parsing).                                                      |
| `npm run test:e2e`         | 0           | 14 Playwright workflows (11 before this phase, 3 added for fiscal retry, backup evidence, and validate-before-apply import). |
| `npm run build`            | 0           | All production builds; the Operations route is code-split.                                                                   |
| `npm run test:integration` | **not run** | **Docker Desktop could not start its Linux engine on this machine** — the named pipe never appeared.                         |

### Unverified in this session — read this before merging

- **The 10 PostgreSQL integration suites did not run**, including `phase6-operations.integration.test.ts`, which was written in this session and has never been executed. It covers branch scoping of fiscal records, retry idempotency under two concurrent requests, the 409 on an already-numbered invoice, 403 for a session without the permissions, backup evidence, validate-without-writing, apply idempotency, and barcode-matched update.
- Unlike the previous session's work, **this phase changes the API, so "the integration tests were green at the last commit" does not carry over.** `npm run verify` must be run in full, with Docker available, before this branch is merged.
- Nothing in section 2 has been attempted. No hardware, no site, no fiscal approval, no pilot.

---

## 4. What this phase does and does not mean

**It means** the operator now has, in the application: fiscal submission status with a safe retry, backup and restore-drill evidence, assistant usage audit, and a validate-before-write catalog import. The software prerequisites for a pilot are in place.

**It does not mean** Phase 6 is complete. The exit gate is the `DEVELOPMENT_PLAN.md` Phase 5 release gate, unchanged: **BLOCK** on any authorization bypass, duplicate refund, inventory corruption, unsafe shelf placement, money or rounding error, secret leak, or failed restore. **PILOT** only when all P0 pass, critical P1 journeys pass, performance is acceptable at representative volume, and backup/restore is proven from physical media.

None of those conditions has been evaluated.

---

## 5. Post-gate change record — 2026-09-26: catalog file loading and error reporting

### Validation failures now reach the operator

Creating a user from the administration screen showed only `Request failed (400)`. The API had in
fact answered with Zod's flattened field errors, and the browser client reported `body.message`,
which a flattened body does not carry. `describeApiError` in `apps/web/src/api.ts` now composes the
form and field errors into the reported message, so `password: Too small: expected string to have

> =12 characters` reaches the screen. This applies to every validated endpoint, not only user
> creation. The create form also states the rules it knows about before submission.

Live evidence: `POST /api/v1/admin/users` with an eight-character password answers `400` with
`{"formErrors":[],"fieldErrors":{"password":["Too small: expected string to have >=12
characters"]}}`, which the client now renders verbatim.

### Loading a catalog file

`apps/api/src/load-medicine-file.ts` (`npm run load:medicines --workspace @pharmacy/api`) loads a
pharmacy, supplier, or regulator catalog file. The catalog itself goes through
`CatalogImportService`, the same path the administration screen uses, in chunks of 2,000 rows with a
deterministic client request id per file and chunk, so a repeated run replays instead of
duplicating. Every row is validated locally against `catalogImportRowSchema` first, so one pass
reports all rejections. A `CATALOG.FILE_LOADED` audit event records the file name and its SHA-256
next to the counts, which gives a catalog figure its provenance.

The CSV parser moved from `apps/web/src/modules/administration/catalog-csv.ts` to
`packages/shared/src/catalog-file.ts` so the screen and the loader cannot diverge, and it now also
recognizes price and company columns (`MRP`, `Maximum Retail Price`, `Trade Price`, `Company`, and
similar). Those three fields are named in `NON_CONTRACT_FIELDS`: the catalog contract does not carry
a price, because a sale price belongs to an inventory batch received into a branch.

`--with-demo-stock` creates one opening batch per priced row, recorded through the append-only stock
ledger as `ADJUSTMENT_IN` and never disturbing a batch that already has movement history. It is a
development fixture: it requires `ALLOW_DEVELOPMENT_SEED=true` and refuses to run in production.
Prices loaded this way are the file's figures, not a pharmacy's own agreed prices.

### Evidence

`docs/examples/medicine-catalog-sample.csv` (12 real Pakistani-market brands, with MRP and trade
price) was loaded against the local cluster:

| Step                                              | Result                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `--validate-only`                                 | All 12 columns recognized, 0 ignored, 12 rows would be created   |
| Load with `--with-demo-stock`                     | 12 medicines created, 12 batches, 12 `ADJUSTMENT_IN` movements   |
| Second run of the same file                       | Replayed as one `CATALOG.IMPORTED` event; no duplicate medicines |
| `GET /catalog/medicines/search?query=Paracetamol` | 2 results with price, available quantity, and days to expiry     |
| `GET /catalog/medicines/search?query=augment`     | `Augmentin 625mg Tablets` at `486.50`, 50 available, 67 days     |

The first attempt at the stock step failed with `operator is not unique: date + unknown`, the same
untyped-parameter behaviour recorded in Phase 2; the expiry offset is now cast explicitly.

### Limitation

A real Pakistani catalog with DRAP-published prices has not been loaded. The published datasets that
carry those figures sit behind a Kaggle login, so the operator supplies the file; the loader and its
column mapping are proven against the sample above, not against that file.

## 6. Post-gate change record — 2026-10-21: counter budget plan, discounts, and release

### What changed

- **Budget plan on the counter.** Ticket lines can be ticked; the budget plan (`F3` or the toolbar)
  runs the existing complete-regimen calculation on the ticked lines only (all lines when none are
  ticked) and writes the planned whole-unit quantities back to the cart. By default the cost of the
  unticked lines comes out of the customer's budget first. The Budget page uses the same planner
  component. Shared logic: `apps/web/src/modules/pos/budget-plan.ts`.
- **Discounts.** Per-line and invoice discounts, each as a percentage or a rupee amount, a reason
  preset or free text, and supervisor credentials when the branch limit is exceeded (`F9`). The
  cashier's entry is kept with the cart and with a held cart. The exact-money plan
  (`apps/web/src/modules/pos/discount.ts`) rounds half up to the paisa and fills the server's existing
  `lineDiscounts` and `invoiceDiscount` fields; the counter previously never sent line discounts. The
  server remains authoritative for the policy limit and approval.
- **Loopholes closed.** A supervisor-required discount no longer locks the cashier out of entering
  approval. A reserved ticket can be released and edited through the new
  `POST /pos/drafts/:draftId/cancel`, which locks the draft, is limited to the opening terminal, is
  idempotent, releases active reservations, and writes `POS.DRAFT_CANCELLED`. Changing the discount
  money issues a new discount request ID; removing an applied discount starts a fresh draft, because
  the server cannot set a discount back to zero. Enter during a stale debounced search no longer adds
  the previous query's result. Out-of-stock or unpriced results cannot be added. Malformed discount
  input can no longer break the summary.
- **Counter layout.** Arrow-key result navigation, a results column header, an idle panel showing
  the held ticket, a dense ticket with tick boxes, bulk Budget plan, Discount, and Remove, per-line
  discount and stock-shortfall tags, a pay button that shows the total, and responsive rules. The
  top navigation now scrolls inside its own row instead of widening the page.

### Evidence

| Command                    | Exit | Notes                                                                    |
| -------------------------- | ---- | ------------------------------------------------------------------------ |
| `npm run format:check`     | 0    |                                                                          |
| `npm run lint`             | 0    |                                                                          |
| `npm run typecheck`        | 0    |                                                                          |
| `npm run test:unit`        | 0    | Adds `discount.test.ts` and `budget-plan.test.ts` (10 tests)             |
| `npm run test:e2e`         | 0    | 15 passed, including a new budget, discount, and release counter journey |
| `npm run build`            | 0    |                                                                          |
| `npm run test:integration` | 1    | Docker was not running: `Could not find a working container runtime`     |

The counter was also exercised in the browser in preview mode (sample data): keyboard adding, `*N`,
ticking, budget plan, bulk and invoice discounts, reason enforcement, hold and resume with discounts,
and the 1100 px layout.

### Unverified

The new integration test, "cancels a reserved draft once and releases its stock for the next
ticket" in `tests/integration/pos-idempotency.integration.test.ts`, has not run because it needs
Docker. The discount and cancel endpoints were exercised only through mocked e2e routes, not
against a live API. Run `npm run verify` with Docker available before merging.

## 7. Post-gate change record — 2026-10-22: single-screen counter, dosage timing, test catalog

### What changed

- **One screen for selling.** The budget-plan and discount popups are gone. The counter is an
  entry bar (medicine → quantity → timing → Enter), an invoice grid that edits timing, quantity, and
  line discount inline, and a side panel holding the customer, the budget plan (`F3`), the invoice
  discount (`F9`), and the totals. Ticking lines opens a bulk bar to set timing or discount at once.
  The payment, receipt, and reprint dialogs are unchanged.
- **No default quantity.** Choosing a search result stages it and moves focus to an empty quantity
  box; Enter on an empty box asks for a quantity instead of adding 1. The box takes units (`20`) or
  days of the chosen timing (`5d`). A barcode scan still adds one unit per scan, as at any till.
- **Dosage timing (optional).** Typed shorthand, with preset chips for the mouse: `101` = 1+0+1,
  `h` = ½, `q` = ¼, `t` = ¾, and a trailing `a`/`b` for after/before meal; written forms such as
  `1/2+0+1/2` are also accepted (`packages/shared/src/dosage.ts`). It is stored in canonical text on
  `sale_draft_items` and `sale_items` (migration `016_phase6_dosage_instructions.sql`), validated by
  `createDraftSchema`, and printed on the receipt in English and Urdu, and in ASCII on the thermal
  printer. It never changes quantity, price, stock, or tax. The budget plan reads each line's daily
  units from its timing, falling back to 1 a day.
- **Lag.** Search state lives in the entry bar and the clock in its own component, so typing and
  the clock no longer re-render the ticket; grid rows are memoized. Search debounce dropped from
  180 ms to 120 ms and keeps the previous results while the next request runs. Catalog search
  ranks name prefixes, then all-words matches across name, generic, strength, and company, ahead of
  fuzzy trigram matches, and escapes LIKE wildcards.
- **Test catalog.** `scripts/generate-test-catalog.mjs` writes
  `docs/examples/medicine-catalog-test-large.csv`: 3,178 products from 178 molecules in 21 dosage
  forms, with EAN-13 barcodes in the 896 prefix. Prices are plausible test values, not DRAP prices.
  The loader now links each SKU to the manufacturer named in the file.

### Evidence

| Command                                                                             | Exit | Notes                                                    |
| ----------------------------------------------------------------------------------- | ---- | -------------------------------------------------------- |
| `npm run db:migrate` (local cluster)                                                | 0    | Applied `016_phase6_dosage_instructions.sql`             |
| `load:medicines … medicine-catalog-test-large.csv --with-demo-stock --quantity 200` | 0    | 3,178 created, 3,178 manufacturers linked, 3,178 batches |
| `npm run format:check`                                                              | 0    |                                                          |
| `npm run lint`                                                                      | 0    |                                                          |
| `npm run typecheck`                                                                 | 0    |                                                          |
| `npm run test:unit`                                                                 | 0    | Adds dosage, quantity/discount shorthand, printer tests  |
| `npm run test:e2e`                                                                  | 0    | 15 passed; counter journeys rewritten for the new flow   |
| `npm run build`                                                                     | 0    |                                                          |
| `npm run test:integration`                                                          | 1    | Docker not running: no container runtime                 |

Catalog search on the local cluster with that data took 4–17 ms per query (12 queries, second
run). A direct `PosService.createDraft` call against the local cluster stored `h0h a` as
`½+0+½ after meal` and the schema rejected `12`.

### Unverified

Finalizing a sale with a timing and printing its receipt was exercised only through unit tests and
mocked e2e routes, not against the live API. The new integration test "stores the patient timing in
canonical form and rejects an unreadable one" needs Docker and has not run. The API reads
`@pharmacy/shared` from its build output, so `npm run build:packages` (part of `npm run dev`) must
run before the API accepts timings.

## 8. Post-gate change record — 2026-10-22: super admin, invoice service, printing, FBR switch

### What changed

- **Super admin (software owner).** Migration `017_phase6_platform_owner_and_invoicing.sql` adds the
  `SUPER_ADMIN` role and the `platform.super_admin` permission, which no other role holds (the seed
  excludes it from OWNER and MANAGER too). `/platform` (API and screen) manages every shop's profile and
  FBR registration, creates shops (with policies and an admin terminal), activates or deactivates shops,
  approves live FBR sending, creates and edits users in any shop with any role, resets passwords,
  unlocks accounts, and reads roles, the audit log, and the server's FBR configuration. A shop owner
  cannot see, edit, reset, or grant the super admin. The account is created on the server only:
  `SUPER_ADMIN_USERNAME=… SUPER_ADMIN_PASSWORD=… npm run bootstrap:super-admin --workspace @pharmacy/api`
  (it receives the role in every shop).
- **Shop profile.** Name, address, phone, email, drug sale license, NTN/CNIC, STRN, FBR POS ID,
  registered name, province: set by the super admin, printed on invoices, read only for the owner.
  Editing the fiscal identity through `/admin/fiscal-settings` now requires the platform permission.
- **FBR switch (shop owner).** `PATCH /admin/shop/fbr-invoicing`, refused until the registration is
  complete. A sale is fiscalized only when the server has an FBR mode and the switch is on. The receipt
  prints the FBR block (POS ID, FBR number, QR of the FBR number) only while the switch is on; with it
  off no FBR block or QR is printed.
- **Live FBR sending (ADR 0004).** The worker now submits through the existing `FbrHttpGateway` only for
  shops whose live sending the super admin approved (with a reason, audited). It marks the invoice
  `SUBMITTING` before the request and turns a leftover `SUBMITTING` into `FAILED_NEEDS_REVIEW` instead of
  sending again, records every attempt, and stores FBR's number as the QR payload. Unapproved shops keep
  the previous blocked behaviour and error code.
- **Invoice service and layout.** One invoice model renders both the HTML invoice and the ESC/POS
  bytes, so the preview is what prints: shop profile, lines with batch/expiry, discounts, dosage timing
  (English and Urdu on HTML, ASCII on thermal), totals, payments, FBR block, return QR, footer. The owner
  edits the layout under Admin → invoice layout (paper 58 mm / 80 mm / A4, text size, title, notes,
  14 show/hide switches, copies) with a live sample preview and test print. Stored layouts are read
  leniently so a damaged layout still prints with defaults.
- **Universal printing.** Per-counter printer profile: installed printer through the print dialog (any
  Windows-driver printer, A4 or thermal), raw ESC/POS over WebUSB, Web Serial (COM and paired Bluetooth
  serial), or a LAN printer's port 9100 relayed by `POST /printing/network`, which only reaches private
  IPv4 addresses on ports 9100–9109. Optional auto-print and cash drawer. The receipt waits up to about
  20 seconds for the FBR number before printing "pending".
- **Shorter passwords.** Minimum 6 characters for staff, bootstrap, and seed passwords
  (`PASSWORD_MIN_LENGTH`); repeated failures still lock the account.

### Evidence

| Command                                                         | Exit | Notes                                                       |
| --------------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| `npm run db:migrate` (local cluster)                            | 0    | Applied `017_phase6_platform_owner_and_invoicing.sql`       |
| Throwaway database on the local cluster (created, then dropped) | 0    | 25 of 25 end-to-end checks passed; see below                |
| `npm run format:check`                                          | 0    |                                                             |
| `npm run lint`                                                  | 0    |                                                             |
| `npm run typecheck`                                             | 0    |                                                             |
| `npm run test:unit`                                             | 0    | Adds invoice layout, invoice model, ESC/POS, printer, relay |
| `npm run test:e2e`                                              | 0    | 18 passed, including three new platform/invoice journeys    |
| `npm run build`                                                 | 0    |                                                             |
| `npm run test:integration`                                      | 1    | Docker not running: no container runtime                    |

The throwaway-database run used the real services, migrations, worker, and a stand-in FBR gateway (no
request to FBR): FBR switch refused before registration, owner cannot see or touch the super admin,
receipt carries shop profile and dosage, unapproved shops are never sent, an approved shop gets the
FBR number and QR on the receipt and is never sent twice, switching FBR off hides the block and stops
fiscalization, the saved layout reaches the receipt, and every control is audited. The same flow is
kept as `tests/integration/phase6-platform-invoicing.integration.test.ts`.

### Unverified

No request was made to the real FBR API, and no physical printer was driven: USB, serial, and
network printing were verified against test doubles and a local TCP socket. WebUSB cannot claim a
printer whose Windows driver holds it; such printers print through the print dialog. The new
integration test needs Docker and has not run in this session.

## 9. Post-gate change record — 2026-10-22: cash counter modes and readability

### What changed

- **Cash sessions per shop (super admin).** Migration `018_phase6_cash_counter_modes.sql` adds
  `branches.cash_sessions_enabled` (default on), `cash_sessions.auto_managed`, and the cash counter
  queue columns on `sale_drafts`. `PATCH /platform/shops/:id/cash-sessions` switches it, audited;
  switching back on closes the automatic sessions.
- **Sessions off.** The order desk's F8 becomes "Print invoice": `POST /pos/drafts/:id/complete-invoice`
  reserves if needed and finalizes a cash sale. Every sale, refund, and cash account payment still
  belongs to a cash session: `resolveCashSession` keeps one automatic session per counter user per
  business day (opening 0), closing yesterday's with counted equal to expected. Manual day opening is
  refused while sessions are off.
- **Sessions on.** The order desk's F8 is "Send to cash counter" unless that desk has its own started
  day ("Take payment" as before). `POST /pos/drafts/:id/send-to-cashier` queues the reserved order.
  The cash counter page lists waiting bills (refreshed every 3 seconds), shows change for the cash
  received, and clears each bill with `POST /pos/cash-counter/:id/clear` (re-reserving stock if the
  hold expired; a retried request id returns the same sale) or cancels it, releasing stock. Start day
  asks for the drawer's cash; end day shows over/short against the expected drawer while counting.
  Variance approval for managers is unchanged.
- **Finalize idempotency** now looks a sale up by terminal and client request id (the request id is
  unique per attempt), since the server may choose the session.
- **Readability.** Larger prices and totals in search results, the invoice grid, the side panel,
  the pay button, the payment dialog, and the admin, user, and super admin forms.

### Evidence

| Command                                                         | Exit | Notes                                                 |
| --------------------------------------------------------------- | ---- | ----------------------------------------------------- |
| `npm run db:migrate` (local cluster)                            | 0    | Applied `018_phase6_cash_counter_modes.sql`           |
| Throwaway database on the local cluster (created, then dropped) | 0    | 21 of 21 cash counter checks passed                   |
| `npm run format:check`                                          | 0    |                                                       |
| `npm run lint`                                                  | 0    |                                                       |
| `npm run typecheck`                                             | 0    |                                                       |
| `npm run test:unit`                                             | 0    |                                                       |
| `npm run test:e2e`                                              | 0    | Adds cash counter, send, direct invoice, toggle tests |
| `npm run build`                                                 | 0    |                                                       |
| `npm run test:integration`                                      | 1    | Docker not running: no container runtime              |

The throwaway-database run (shared with `tests/integration/phase6-cash-counter.integration.test.ts`
through `tests/integration/scenarios/cash-counter.ts`) covered: send without a till, idempotent send,
the queue with lines, clear needs a started day, cash and change recorded, retried clear replays,
second clear refused, drawer = opening + sales, cancel releases stock, expired hold re-reserved,
sessions off invoices into an automatic day session reused within the day and rolled over the next
day with no variance, manual open refused, switching back on closes automatic sessions, and
auditing.

### Unverified

The flows were driven through services and mocked browser routes, not by people at real counters.
Automatic sessions roll over on the first sale of a new business day, not at midnight.

## 10. Post-gate change record — 2026-10-22: owner page fix, budget page, shelf planner

### What changed

- **Owner page crash (root cause).** The worker stored `expiryValueAtRisk` and `deadStockValue` in
  the daily snapshot as unrounded `quantity × cost` (for example `10770616.50000000000`). The owner
  dashboard formats money exactly and refuses more than two decimals, so it threw while rendering
  and the error boundary replaced the screen. The API logs looked normal because the failure was in
  the browser after the data arrived. Fixes: the worker rounds both values to paisa, the dashboard
  API rounds snapshots already stored, the dashboard shows a malformed figure as text instead of
  failing, and the error boundary clears when the operator moves to another screen.
- **Budget page.** The standalone `/budget` screen and its navigation entry are removed; the budget
  plan lives only in the counter's side panel. The unused page components and their styles went with
  it.
- **Shelf planner** (`/shelves`, "Shelves" in the navigation). Migration
  `019_phase6_shelf_planner.sql` adds `shop_floor_plans` (room, counter, doorway, version),
  `shelf_fixtures` (racks, island stands, fridges, locked cabinets, displays with size, rotation,
  levels, medicines per level, storage, lock), `shelves.fixture_id`/`level_number` (each level is an
  ordinary shelf coded `A-1` for the top level, so counter search and older code keep working), and
  `shelf_layout_proposals` (one pending suggestion per branch, applied or rejected as a whole or
  item by item).
  - The engine in `packages/shared/src/shelf-planner.ts` is shared by API and screen. It validates
    layouts (inside the walls, no overlaps, unique labels, doorway clear, room to pick in front of
    every fixture), finds walking routes around obstacles from where staff stand behind the counter,
    prices every level in seconds per pick (round trip at 1 m/s, bending or reaching, opening a
    fridge or a lock), and plans placements: _Fresh_ (fast sellers on the quickest levels, then
    every medicine grouped by company, form, or A to Z from the quickest rack outward) or _Improve_
    (keep the current arrangement; fix wrong storage, shelve unshelved stock next to its group, swap
    fast sellers on slow shelves with slow sellers on quick ones only when it saves at least a
    minute a month). Fridge-only medicines go only on cold fixtures and controlled medicines only on
    locked ones. It also suggests turning fixtures that face a wall, swapping a busy far rack with a
    quiet near one of the same size, and adding racks, a fridge, or a cabinet on free wall space when
    stock does not fit.
  - API (`apps/api/src/shelf-planner`): `GET /shelf-planner`, `PUT /shelf-planner/layout`
    (optimistic version check; fixtures or levels still holding medicines cannot be removed or change
    storage), `GET /shelf-planner/shelves/:id/medicines`, `GET /shelf-planner/medicines`,
    `POST /shelf-planner/placements` and `/placements/remove`, `GET /shelf-planner/proposals/current`,
    `POST /shelf-planner/proposals`, `POST /shelf-planner/proposals/:id/apply` (refused when the
    layout changed since the suggestion; moving racks needs `inventory.shelf.manage`), and
    `POST /shelf-planner/proposals/:id/reject`. Planner writes lock the branch's floor plan row
    first. Every change is audited.
  - Screen: a first-run size step with common Pakistani shop sizes and a starter layout; a plan
    editor with drag, wall and edge snapping, keyboard nudging, turning, copying, removal, undo and
    redo; a speed or fullness heat map; the walking route to the selected rack; a 3D view with
    clickable levels; per-level medicine lists with type-to-add and take-off; a "Where is…?" search
    that lights up the shelf; suggestion review with per-item ticks, per-medicine target changes, a
    preview of rack changes on the plan, and a printable move list. Feet or centimetres; read-only for
    staff without manage rights.
- **Admin shelves.** Shelves that belong to a planner rack cannot be edited from Admin. Assigning a
  primary shelf there now clears the old primary only in the caller's branch; before, it cleared the
  medicine's primary shelf in every branch.
- **Integration fixtures repaired.** With Docker available the full integration suite ran for the
  first time since commit `1087fc3`. Two committed tests had never passed: the Phase 6 operations
  test gave both test terminals the same code and inserted sales without a cashier, session, draft,
  or line; the stock-ledger refund test called a cash refund with a user holding no permissions, so
  the permission check fired before the session check it meant to test. The fixtures now build
  complete sales and grant the cash-refund permission; no gate or assertion was weakened.

### Evidence

| Command                                                         | Exit | Notes                                                         |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------- |
| Throwaway database on the local cluster (created, then dropped) | 0    | 24 of 24 shelf planner checks before the suite could run      |
| `npm run db:migrate` (local cluster)                            | 0    | Applied `019_phase6_shelf_planner.sql`                        |
| `npm run format:check`                                          | 0    |                                                               |
| `npm run lint`                                                  | 0    |                                                               |
| `npm run typecheck`                                             | 0    |                                                               |
| `npm run test:unit`                                             | 0    | 17 shelf planner engine tests added                           |
| `npm run test:integration`                                      | 0    | 14 files, 77 tests, including shelf planner and cash counter  |
| `npm run test:e2e`                                              | 0    | 25 tests; 4 new: draw and save, suggestion review, 3D, finder |
| `npm run build`                                                 | 0    |                                                               |

The shelf planner scenario (`tests/integration/scenarios/shelf-planner.ts`) covers: an empty shop,
stock counts, saving the starter shop as version 1, a coded shelf per level, shelves priced by
seconds per pick, stale saves refused, overlaps refused, fridge medicines refused on ordinary
shelves, search and shelf lists, a rack holding stock cannot be removed, swapping rack labels keeps
shelves with their racks, fridge and lock rules in suggestions, reviewers cannot move racks,
accepting shelves every medicine, no double apply, a tidy shop needs no improving, rejecting,
layout changes retiring open suggestions, overflow asking for a new rack, moves onto an unaccepted
rack refused, building an accepted rack with its shelves, and auditing. The owner-page cause was
confirmed against the local snapshots (`10770616.50000000000` stored, `10770616.50` after the fix).

### Unverified

- Seconds per pick rest on fixed assumptions (1 m/s walking, bending and reaching penalties, door
  and lock time); they have not been timed against staff in a real shop.
- Local data has no sales, so fast-mover moves and rack swaps are proven by engine tests and
  fixtures, not by real sales history.
- "Medicines per level" is the owner's estimate of how many different boxes fit side by side.
- The 3D view uses CSS 3D transforms and was checked in Chrome only, not in other browsers or on
  low-end counter PCs.

## 11. Post-gate change record — 2026-10-22: stock work, features per shop, several counters

This round's migration is named `020_phase7_features_inventory.sql`. The name refers to this work
package, not to roadmap Phase 7 ("close the money loop": supplier ledger, purchase returns,
expenses), which remains open. Nothing here claims a roadmap phase or gate. The full audit, the
production plan, and the measured computing cost are in `docs/SYSTEM_AUDIT_2026-10-22.md`.

### What changed

- **Features per shop.** `branches.plan_code` (Basic, Standard, Pro; existing shops Pro) and
  `shop_features` (per-shop on/off overrides and settings). The catalogue and validation live in
  `packages/shared/src/features.ts`; the auth guard refuses a route whose feature is off
  (`@RequireFeature`). The super admin sets plan and overrides per shop; the shop owner tunes the
  settings of features the shop has. The web hides switched-off features from menus and screens.
- **Scan-and-receive.** `packages/shared/src/gs1.ts` reads GS1 DataMatrix and EAN codes;
  `GET /stock/scan`, `POST /stock/barcodes`, `POST /quick-receipts` (a direct order and its
  receipt in one transaction through the existing receipt code, idempotent). The Stock screen
  receives by scanning, keeps the delivery across reloads, and gives new stock an A to Z place.
- **Counter search.** Dosage form, 2D codes matched exactly, stock held by other counters
  subtracted, active shelves only. Exact same-medicine alternatives
  (`packages/shared/src/formulation.ts`, `GET /catalog/medicines/:id/substitutes`) and "customer
  asked for it" (`customer_requests`, append-only) when a medicine is missing; "Sell first" badge.
- **Stock alerts and buying.** Low stock from selling speed, stuck stock, expiring stock, customer
  request report, and an order list grouped by last supplier that creates purchase orders.
- **Several cash counters.** Bills may be sent to a chosen cash counter; a cashier claims a bill
  for two minutes while taking payment and other counters are refused by the server.
- **Shelves.** Level names (`shelves.label`), A to Z ranges and placement with minimal shifting,
  a list view and printed shelf labels; the 3D view gained pan, pinch, keyboard control,
  look-at-rack, view presets and Simple graphics.
- **Fixes found by the audit:** supplier list readable with `inventory.purchase`; integration
  fixtures repaired earlier this week now run in Docker with the rest of the suite.

### Evidence

| Command                              | Exit | Notes                                                                     |
| ------------------------------------ | ---- | ------------------------------------------------------------------------- |
| `npm run db:migrate` (local cluster) | 0    | Applied `020_phase7_features_inventory.sql`                               |
| `npm run format:check`               | 0    |                                                                           |
| `npm run lint`                       | 0    |                                                                           |
| `npm run typecheck`                  | 0    |                                                                           |
| `npm run test:unit`                  | 0    | 221 tests; adds GS1, formulation, features, A to Z and receiving tests    |
| `npm run test:integration`           | 0    | 16 files, 82 tests in Docker; adds stock-work and features-per-shop       |
| `npm run test:e2e`                   | 0    | 33 tests; adds receiving, alternatives, plans, alerts, counters, 3D, list |
| `npm run build`                      | 0    |                                                                           |

### Unverified

- No real GS1 scanner was used; codes were typed as scanners send them (with and without the
  group separator). Confirm with the shop's scanner model before relying on batch capture.
- The 3D frame rate was measured on the development PC only (60 frames/s, 20 racks); Simple
  graphics exists for weak PCs but was not timed on one.
- Alternatives depend on catalogue text (generic, strength, form); `generic_id` is empty for all
  local medicines, so the rule is deliberately strict and may miss true alternatives.

## 12. Counter regression repairs — 2026-10-23

This repairs existing Phase 6 workflows; it does not open another roadmap phase or certify the
outstanding physical and pilot exit gates.

### Findings and changes

- The web request helper declared `application/json` even for bodyless POSTs. Fastify rejects
  those before the reservation controller runs. JSON content type is now added only when a body
  is present; authorization headers are preserved. The integration regression demonstrates both
  the old parser rejection and the corrected request reaching the domain service. The order-desk
  browser fixture also enforces this parser rule so routing tests cannot conceal the defect.
- The old hold implementation stored only one ticket and rendered it only when the active cart
  was empty. There are now three separately identified, persistent hold slots, visible during
  subsequent sales. Operators can reopen a selected bill or delete it with confirmation. A full
  hold list refuses a fourth bill without changing the active bill. New-sale/clear and checkout
  retain the hold list. Existing single held tickets migrate on load without an expiry cutoff.
  Quantities, dosage, discounts and the attached customer are retained in the held snapshot;
  supervisor credentials are cleared when switching tickets.
- Storage writes precede state changes. A failed hold/reopen/delete reports an error and keeps
  the prior ticket data. Reopening refuses to overwrite an active or processing/reserved bill.
  Prices and stock availability are revalidated by the existing server checkout path.
- A cashier still cannot approve their own drawer variance. The cash screen now explains the
  requirement for another authorized manager and disables self-approval. Approval retries reuse
  the same request ID while this screen remains mounted. The browser regression covers a dropped
  connection followed by a successful retry with the same ID. Pending-variance query errors are
  also displayed.

### Execution evidence

- Runtime: `node --version` → `v24.21.0`; `npm --version` → `11.19.0` (exit 0).
- Local readiness probe of `http://127.0.0.1:3001/api/v1/health/ready` returned HTTP 200 with
  `status=ready`, `database=connected`; web port 5173 returned HTTP 200. CORS OPTIONS probes for
  both configured development origins (`localhost:5173`, `127.0.0.1:5173`) returned 204 with the
  corresponding allowed origin for GET and POST (exit 0).
- Initial sandboxed web tests exited 1 before executing tests because Vitest cache renames were
  denied with EPERM. The same web command outside the sandbox exited 0: 16 files, 75 tests.
- Intermediate `npm run verify` attempts exited 1 on lint errors in newly added tests; these
  were corrected without weakening gates. The first focused browser run exited 1 (14 passed,
  one keyboard regression caused by moving focus into search after holding). Removing that
  focus change restored Delete behavior; the focused keyboard rerun exited 0 (one passed).

| Command                                                     | Exit | Result                                                                                                                         |
| ----------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run verify` (outside sandbox)                          | 0    | Format, lint, typecheck, 226 unit tests, 83 integration tests in 16 files, 35 browser workflows, and production builds passed. |
| `npx eslint apps/web/src/PosWorkspace.tsx --max-warnings 0` | 0    | Rechecked final ticket-switching and keyboard edits made during regression testing.                                            |
| `git diff --check`                                          | 0    | No whitespace errors.                                                                                                          |

### Limits and follow-up

- Held bills remain in this browser's local storage with no automatic expiry, including across
  reloads and browser restarts. They are not server backups or cross-device records. Clearing
  browser/site data, changing browser profiles/origins, or losing the device loses these drafts.
  Held bills do not reserve stock indefinitely; stock is reserved at checkout.
- The reported service-unreachable incident did not recur during the live readiness/CORS probes.
  Its original cause is not established. Connectivity recovery is covered by the approval browser
  test, but that does not prove an unavailable API process or a LAN fault has been repaired.
- Browser workflows use controlled HTTP fixtures; database integration tests use isolated,
  migrated PostgreSQL in Docker. No live customer sale, cash count or approval was changed.
- The full browser run logged two undefined-query warnings for fixture responses (`cash-counters`
  and `suppliers`) in the existing stock/features specs; all assertions passed. Follow up by
  completing those unrelated fixtures rather than treating the run as browser-console-clean.
- Physical printer/drawer, second LAN terminal, power-loss and pilot gates remain unchanged.
