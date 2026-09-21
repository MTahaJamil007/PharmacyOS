# PharmacyOS — Build Audit

- **Date:** 2026-09-21
- **Branch audited:** `development`
- **Baseline commit:** `83d6831`
- **Method:** direct reading of the source tree, migrations, controllers, worker, and infrastructure; route-by-permission cross-check; command execution where the environment allowed it
- **Business plan of record:** `pharmacy-management-system-technical-architecture.md` §3 (Product vision) and §4 (MVP scope), as narrowed by `docs/DEVELOPMENT_PLAN.md`

---

## 1. The business plan, restated

The architecture document states the product goal plainly: **a pharmacy operating system for local Pakistani pharmacies that wins on speed, correctness, and reliability — not on AI.** The named outcomes are faster medicine search than legacy systems, batch and expiry accuracy, correct stock after sales/purchases/returns, multi-counter work without inventory confusion, cashier control and end-of-day cash reconciliation, owner visibility without Excel, FBR-ready invoicing, and an interface usable by low-computer-literacy staff.

`DEVELOPMENT_PLAN.md` narrowed that to a shippable shape: **single shop, on-premise LAN, LAN-resilient rather than offline-first**, with customer credit (udhaar/khata), non-AI owner reporting, and discounts/pricing/stock adjustments named as the must-have domain gaps. Prescription capture and the controlled-drug register were explicitly deferred.

The scope line that matters most for this audit is the MVP "included" list in architecture §4. Everything on it is either implemented or named below as a gap.

## 2. Headline finding

**The engineering foundation is strong and the transactional core is real. The gap between the repository and a complete pharmacy operating system is no longer correctness — it is coverage.**

Three things are true at once:

1. **What exists is built to an unusually high standard for this class of product.** Money is exact BigInt/`numeric` throughout. Stock, cash, and customer-credit ledgers are append-only and enforced by database triggers, not by application discipline. Idempotent write paths lock before the replay read. FEFO allocation uses deterministic lock ordering. Migrations are checksum-protected after application. Discount approval authority is re-checked in a trigger against `role_permissions`, so a compromised service layer still cannot post an unapproved discount.

2. **Phases 0–5 of the active plan are genuinely implemented, not just claimed.** The defect register in `DEVELOPMENT_PLAN.md` Part 2 (B1–B10, C1–C20) was the state of the code on 2026-08-29. I re-checked the P0 and the structural P1 items against the current tree and they are addressed: the LAN `crypto.randomUUID()` crash has a fallback in `packages/shared/src/client-request-id.ts`, TLS/HSTS/CSP are configured at the Caddy edge, Compose has a one-shot checksum-verified migrate service and per-service resource ceilings, the backup service and restore drill exist and write `backup_runs`, the worker has a stale-lock reaper and enqueues `EXPIRE_RESERVATIONS`, stock-movement arithmetic is asserted by a trigger, and a global exception filter maps `23505` to 409. The repository is not carrying an undisclosed defect backlog.

3. **Several implemented back-end capabilities had no way to reach them from the application, and one of those was a day-one blocker.** This is the finding that changed my plan of work; section 4 covers it.

## 3. What is built — measured

| Dimension                  | Count                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Application source         | ~19,000 lines across `apps/{api,web,worker}` and `packages/{config,database,shared}`                                                           |
| Test source                | ~6,100 lines across 45 files                                                                                                                   |
| HTTP endpoints             | 86, across 19 controllers                                                                                                                      |
| Database migrations        | 15, immutable and checksum-verified                                                                                                            |
| Database tables            | 60                                                                                                                                             |
| Background job types       | 8 (`FBR_SUBMIT`, `FBR_RETURN`, `EXPIRE_RESERVATIONS`, and five refresh/snapshot jobs)                                                          |
| Integration suites         | 10 PostgreSQL-backed suites (migrations, idempotency, stock ledger, RBAC, money, auth, owner-day, Phase 5 hardening, validation, intelligence) |
| Browser workflows          | 4 Playwright specs                                                                                                                             |
| Seeded permissions / roles | 40 permissions across 7 roles                                                                                                                  |

### 3.1 Domain coverage against architecture §4 "Included in MVP"

| MVP line item                             | State                    | Evidence                                                                                              |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Fast POS                                  | **Complete**             | `pos.service.ts`, `PosWorkspace.tsx`, scanner buffer, F-keys, held cart, error boundary               |
| Multi-attribute medicine search           | **Complete**             | `catalog.service.ts` exact-barcode short-circuit plus bounded trigram search                          |
| Batch-level stock                         | **Complete**             | `inventory_batches`, per-batch price history, per-batch adjustment                                    |
| Expiry tracking                           | **Complete**             | `expiry_work_items`, buckets, quarantine and scrap with ledger rows                                   |
| FEFO allocation                           | **Complete**             | `pos.service.ts` reservation with ascending-id lock ordering                                          |
| Multi-counter cart creation               | **Complete**             | Branch/terminal-scoped drafts and reservations with expiry                                            |
| Cashier payment and invoice finalization  | **Complete**             | Idempotent finalize, deterministic invoice numbering, append-only evidence                            |
| Basic discounts with role approval        | **Complete**             | `discount_approvals` with a DB trigger that verifies approver authority                               |
| Cash / card / bank / mixed payment        | **Complete**             | Split tender, tendered amount, change due, customer credit                                            |
| Return workflow against original sale     | **Complete**             | Opaque return token, disposition control, batch splitting for partial quarantine                      |
| Stock ledger                              | **Complete**             | `stock_movements`, append-only, arithmetic and sign asserted in the database                          |
| Automatic reorder suggestions             | **Complete**             | Worker-generated, branch- and expiry-aware, reviewable, convertible to a draft PO                     |
| Cash session open / close / variance      | **Complete**             | `cash-sessions.service.ts`, terminal-locked idempotency, variance approval                            |
| FBR-ready data model and adapter boundary | **Partial**              | Gateway, tax snapshots, and durable attempts exist; **outbound transmission is deliberately unwired** |
| Simple owner dashboard                    | **Complete**             | `dashboard.service.ts`, 12 metrics, 7-day chart, backup/restore state                                 |
| RBAC and audit logs                       | **Complete**             | Permission-guarded routes, session permission snapshots, `audit_events`                               |
| Local deployment with backups             | **Complete in software** | Compose stack, encrypted nightly dump, weekly isolated restore drill                                  |

**Every MVP line item is implemented in software.** The two qualifications are FBR outbound transmission (withheld pending authorization — a decision, not a defect) and the fact that backup/restore is proven in Docker but not yet on physical external media.

### 3.2 Phase status, restated honestly

| Phase | Software | Operational exit                                                        |
| ----- | -------- | ----------------------------------------------------------------------- |
| 0     | Passed   | Passed                                                                  |
| 1     | Passed   | **Open** — second LAN terminal, physical external disk, restore from it |
| 2     | Passed   | Passed                                                                  |
| 3     | Passed   | **Open** — real scanner, printer, drawer, pharmacist 20-sale gate       |
| 4     | Passed   | Passed for its software owner-day scenario                              |
| 5     | Partial  | **Open** — fiscal authorization, sandbox evidence, UPS, 14-day pilot    |

Nothing in this audit contradicts `PROJECT_STATUS_AND_NEXT_STEPS.md`. Its separation of "software passed" from "operational exit passed" is the right frame and I have kept it.

## 4. Gaps found in this audit

### 4.1 Closed during this audit

**Goods receipt had no user interface, and it is the only path by which stock can enter the system.**
`inventory_batches` is inserted from exactly three places: `procurement.receivePurchaseOrder` (new acquisition batches), and `returns`/`intelligence` (batch _splits_ of stock that already exists). The web client called only two of the ten procurement endpoints — `getReorderSuggestions` and `reviewReorderSuggestion`. So a pharmacy running the shipped application could sell, count, scrap, price, and report on stock, but could not **buy** any. Opening stock could only be created by a seed script or by calling the API directly. For a product whose pitch is "replaces the legacy POS/management software", that was a day-one blocker rather than a missing nicety.

**Nine deterministic report endpoints had no user interface.** `reports.*` was reachable only by an HTTP client. Phase 4 correctly extracted the reports out from behind the AI endpoint, but the owner-facing surface stopped at the dashboard snapshot.

**Navigation was not permission-aware.** Only `/admin` was filtered. A cashier saw Owner, Inventory, and Budget tabs that could only answer 403.

Section 5 records what I implemented for these.

### 4.2 Orphaned permissions — closed in Phase 6

> **Update, 2026-09-21:** all five genuinely unenforced permissions now have a surface. See `docs/PHASE_6_EXECUTION.md` §1.4. This section is kept as the original finding, with the corrections marked.

Five seeded permissions had no enforcement anywhere in the application, worker, or client. Two of them mattered:

| Permission                     | Missing surface                                                                                                                                                                                                         | Closed by                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `fbr.view_status`, `fbr.retry` | **No fiscal status screen.** `fbr_invoices` and `fbr_invoice_attempts` were written but unreadable outside psql. With transmission switched on, the operator would have had no way to see or retry a failed submission. | `GET /fiscal/invoices`, `.../attempts`, `.../retry` |
| `backup.restore`               | No backup history view; `backup_runs` was surfaced only as two dashboard tiles.                                                                                                                                         | `GET /operations/backups`                           |
| `ai.audit.read`                | `ai_assistant_audits` was written and never read.                                                                                                                                                                       | `GET /owner-ai/audits`                              |
| `returns.refund_cash`          | Refund routes gated on `returns.refund` only; the cash-specific permission was unused.                                                                                                                                  | `ReturnsService.refund` rejects `CASH` without it   |

`analytics.owner.read` was consulted only as a fallback inside `OwnerToolsService` and never opened a route of its own; the owner dashboard now accepts it as an alternative to `reports.view_financial`.

**Three entries in the original list were wrong.** `sale.discount.override`, `sales.budget_regimen.verify`, and `customer.credit` are each enforced inside their service — `pos.service.ts` checks the override permission before accepting a supervisor-approved discount, `budget-regimen.service.ts` checks the verify permission before persisting a self-verified audit, and the credit payment path checks `customer.credit`. Service-level enforcement is the **correct** design for all three: a basic cashier must be able to call the discount endpoint and supply a supervisor's credentials, so a route guard would break the workflow it is meant to protect. The original claim did not survive re-reading the services.

### 4.3 Open — domain modules a complete pharmacy OS needs and this one does not have

These are absent from the schema, the API, and the UI. I verified each by searching the whole tree.

| Missing module                                     | Why a Pakistani pharmacy needs it                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purchase return / debit note to supplier**       | Returning near-expiry and damaged stock to the distributor for credit is routine. `expiry_work_items` can already be flagged `SUPPLIER_RETURN_CANDIDATE` — and then the workflow simply stops. Expired stock can currently only be scrapped as a loss.                                                            |
| **Supplier ledger / accounts payable**             | Pharmacies buy on credit from distributors. `goods_receipts` records what arrived; nothing records what is _owed_, what was paid, or the aged payable position. The customer side (khata) has a full append-only ledger; the supplier side has none.                                                              |
| **Expense / day book**                             | Daily cash expenses (rent, utilities, staff advances, delivery) come out of the till. Without them the cash session reconciles against sales only, and the owner's "profit" excludes every cost that is not cost-of-goods.                                                                                        |
| **Stock take session**                             | Per-batch counted adjustment exists. A _session_ — freeze a shelf or category, issue count sheets, enter counts, review the variance summary, post in one approved batch — does not. Monthly stock take is a universal pharmacy routine and today it would be hundreds of individual adjustments with no summary. |
| **Barcode / shelf label printing**                 | New batches arrive without printed labels; there is no label path at all.                                                                                                                                                                                                                                         |
| **Prescription capture, controlled-drug register** | Explicitly deferred by the plan. Listed here so the deferral stays visible rather than becoming an omission.                                                                                                                                                                                                      |
| **Multi-shop**                                     | `branch_id` is on every transactional table and the cross-branch leaks were fixed in Phase 2, so this is a later phase and not a rewrite. Consolidated reporting and inter-branch transfer do not exist.                                                                                                          |

### 4.4 Open — smaller observations

- **`INVENTORY_MANAGER` cannot complete a purchase cycle alone.** The role holds `inventory.purchase` but not `procurement.purchase_draft.approve`, so it can draft and receive but cannot mark an order as ordered. **Resolved in Phase 6:** this is intended segregation of duties — the person who receives stock is not the person who commits the shop's money — and is now recorded in `docs/PHASE_6_EXECUTION.md` §1.5. The purchasing screen states it on the order rather than failing with a 403.
- **`createPurchaseOrder` returns no `receipts` key** while `getPurchaseOrder` does. The shapes are close enough to be mistaken for each other; the client type now distinguishes them.
- **Procurement responses are `Record<string, unknown>` with snake_case keys**, unlike the camelCase typed contracts used elsewhere. The new shared interfaces describe them but the service should eventually alias the columns to match the rest of the API.
- **`main` is 6 commits behind `development`.** Every phase since Phase 1 lives only on `development`.
- **Vite still reports a >500 kB chunk.** The owner and QR paths are lazy-loaded; the remaining weight is vendor code.
- **Docker was not running on this machine**, so the 10 PostgreSQL integration suites could not be executed in this session. They passed in GitHub Actions run `33495305485` at commit `a3c11f2`, and none of the changes in this audit's own section 5 touch the API, worker, database, or migrations. **That exemption does not extend to the Phase 6 work**, which does change the API — see `docs/PHASE_6_EXECUTION.md` §3.

## 5. Changes implemented in this audit

All changes are client-side and additive; no API, migration, worker, or infrastructure file was modified.

| Change                                                                                                                                                                                                         | Files                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Purchasing workspace — supplier selection, purchase-order builder with exact line arithmetic, order approval, multi-line goods receipt with batch/expiry/price per line, receipt history, supplier quote entry | `apps/web/src/modules/procurement/{ProcurementScreen.tsx,ProcurementRoute.tsx,purchase-order.ts}`              |
| Deterministic reports workspace — seven reports, date ranges, generic table rendering for both aggregate and row-list payloads, CSV export, data-basis disclosure                                              | `apps/web/src/modules/reports/{ReportsScreen.tsx,ReportsRoute.tsx,report-table.ts}`                            |
| Typed client contracts for procurement, suppliers, and reports                                                                                                                                                 | `packages/shared/src/api-contracts.ts`, `apps/web/src/api.ts`                                                  |
| Permission-aware primary navigation                                                                                                                                                                            | `apps/web/src/components/AppShell.tsx`                                                                         |
| Routes, English/Urdu navigation strings, styles                                                                                                                                                                | `apps/web/src/App.tsx`, `apps/web/src/i18n.tsx`, `apps/web/src/styles.css`                                     |
| 14 unit assertions on purchase-order and report-table logic                                                                                                                                                    | `apps/web/src/modules/procurement/purchase-order.test.ts`, `apps/web/src/modules/reports/report-table.test.ts` |
| 2 browser workflows: order → approve → receive into a batch, and reading a deterministic report                                                                                                                | `tests/e2e/procurement-and-reports.spec.ts`                                                                    |

Purchase-order money arithmetic reuses `@pharmacy/shared` exact helpers and mirrors the server's own rule (gross minus discount in minor units, discount may not exceed gross), so the screen cannot display a total the server would reject. Both write paths hold one `clientRequestId` in state across retries rather than regenerating it.

### Verification

Run from the repository root on 2026-09-21:

| Command                    | Exit code   | Result                                           |
| -------------------------- | ----------- | ------------------------------------------------ |
| `npm run format:check`     | 0           | clean                                            |
| `npm run lint`             | 0           | clean, `--max-warnings 0`                        |
| `npm run typecheck`        | 0           | strict, all six workspaces                       |
| `npm run test:unit`        | 0           | 91 unit tests (77 baseline + 14 added)           |
| `npm run test:e2e`         | 0           | 11 Playwright workflows (9 baseline + 2 added)   |
| `npm run build`            | 0           | all production builds; new routes are code-split |
| `npm run test:integration` | **not run** | Docker Desktop was not running on this machine   |

**Unverified in this session:** the 10 PostgreSQL integration suites, the performance suite, and every operational item in section 4 of `PROJECT_STATUS_AND_NEXT_STEPS.md`. `npm run verify` must be re-run in full, with Docker available, before this work is merged.

## 6. Overall assessment

**Roughly 85% of the MVP-scope product is built, and close to 100% of its transactional core.** What remains splits cleanly in two:

- **Operational evidence** — hardware, a second terminal, a physical backup disk, fiscal authorization, and a 14-day parallel pilot. None of this is code. It is the honest blocker to a production cutover and it has been correctly identified by the existing documents.
- **Domain breadth** — supplier payables, purchase returns, expenses, stock-take sessions, label printing, and the fiscal operations surface. This is code, it is well-scoped, and it is what separates "an excellent POS with inventory" from "the operating system a pharmacy runs its business on."

The next plan is `docs/PHARMACY_OS_COMPLETION_ROADMAP.md`.
