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
