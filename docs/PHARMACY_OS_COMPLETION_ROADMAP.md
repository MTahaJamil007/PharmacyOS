# PharmacyOS — Completion Roadmap

> **Status:** Active for Phases 6–9. Continues `docs/DEVELOPMENT_PLAN.md`, which remains authoritative for Phases 0–5 and for the open operational exit gates carried into Phase 6.
> **Date:** 2026-09-21
> **Basis:** `docs/SYSTEM_AUDIT_2026-09-21.md`
> **Scope decision (unchanged):** single shop · on-prem LAN · LAN-resilient, not offline-first · stabilize before expanding

---

## Where this starts

Phases 0–5 of `DEVELOPMENT_PLAN.md` delivered the transactional core: exact money, append-only stock/cash/credit ledgers, correct idempotency and FEFO under concurrency, a counter-grade POS, deterministic owner reporting, a fiscal boundary, observability, and a backed-up production stack. Every line item in the architecture document's MVP scope is implemented in software.

Two categories of work stand between that and a pharmacy running its business on this system:

**A. Operational evidence** that cannot be produced by writing code — hardware, a second terminal, a physical backup disk, fiscal authorization, and a parallel pilot. This is Phase 6 and it is unchanged from the Phase 1/3/5 exit gates.

**B. Domain breadth** — the modules a pharmacy uses daily that the MVP scope never included. Supplier payables. Purchase returns. Expenses. Stock-take sessions. This is Phases 7–8, and it is what makes the product an _operating system_ rather than a very good POS.

Phase 9 is deferred scope, listed so it stays visible.

**Sequencing rule, unchanged: no phase starts until the prior gate has objective evidence.** The one deliberate exception is that Phase 7 back-end work may run in parallel with Phase 6, because Phase 6 is gated on equipment and people rather than on code — but **nothing from Phase 7 may be installed at the pilot site until the Phase 6 gate is green.**

Effort is developer-weeks for one experienced full-stack developer.

---

## Phase 6 — Prove it on real equipment · ~4 weeks elapsed, ~1.5 weeks of engineering

> **Status, 2026-09-21:** the software half is **implemented and its gates pass** — the fiscal operations surface (7.1, pulled forward), backup evidence, bulk catalog import (8.3, pulled forward), and the closure of every genuinely orphaned permission. The operational half is **not started**: no hardware, no site, no fiscal approval, no pilot. Evidence and the operator checklists are in `docs/PHASE_6_EXECUTION.md`.

This phase converts the open exit gates from Phases 1, 3, and 5 into signed evidence. The only code it needed was the surfaces an operator must have _before_ cutover; everything else is procurement, scheduling, and the pilot itself.

### 6.1 Site and hardware (blocking, not engineering)

Acquire and record model, firmware, connection, and assigned terminal for: the production server, a second counter terminal, a supported barcode scanner, an 80 mm ESC/POS printer, a compatible cash drawer, a UPS, and an external SSD. `docs/PILOT_RUNBOOK.md` already specifies the matrix.

### 6.2 Close the Phase 1 operational gate

- Trust the Caddy internal CA on the second terminal; confirm no certificate warning, HTTP→HTTPS redirect, correct hostname, and correct terminal clock.
- Complete a real sale from that terminal: open till → scan → reserve → finalize → reload → confirm sale, payment, stock movement, and invoice evidence.
- Back up to the mounted physical external disk and confirm the encrypted dump and SHA-256 sidecar are on the device, not in a local directory that looks like one.
- Restore from that physical copy through the application role, under 15 minutes, recorded in `backup_runs`.

### 6.3 Close the Phase 3 physical gate

- Scanner: 30 configured and 10 unknown rapid scans, each producing exactly one controlled lookup, no dropped or duplicated characters.
- Printer: original and searched reprint, unclipped and readable at 80 mm, carrying the expected return and fiscal QR, with a reprint audit row.
- Drawer: opens only for configured authorized cash events; a drawer failure never alters a completed sale or refund.
- Pharmacist gate: 20 consecutive scanner-and-keyboard-only sales with a recorded speed and usability comparison against the system being replaced.

### 6.4 Fiscal activation (external lead time — start immediately)

Engage the licensed integrator and the tax adviser now; both have lead times measured in weeks. Obtain explicit written outbound-data approval, then wire the approved gateway calls into the worker, persist real validate/submit transitions, and finalize credit-note/return semantics and ambiguous-submit reconciliation. **Until all of that is signed, `FBR_MODE=DISABLED` stays.**

**7.1 (fiscal operations surface) shipped in this phase, ahead of activation.** Turning on transmission without a screen that can see and retry a failed submission would put the operator in psql on their first bad day. The retry path refuses any invoice that already holds a fiscal number, and never calls the gateway inline.

### 6.5 Master data, roles, and the pilot

Import and reconcile the real catalog — barcodes, pack and base units, batches, expiry dates, shelves, prices, HS codes, tax rates, opening stock. **The bulk catalog import from 8.3 shipped in this phase** so this step is a validated file rather than thousands of forms; nothing is written until validation reports zero rejected rows. Create named individual accounts and remove shared counter logins. Run the UPS test. Then the 14-day parallel pilot per `PILOT_RUNBOOK.md`, with one signed daily reconciliation per operating day.

**Exit gate:** the `DEVELOPMENT_PLAN.md` Phase 5 release gate, unchanged. **BLOCK** on any authorization bypass, duplicate refund, inventory corruption, unsafe shelf placement, money or rounding error, secret leak, or failed restore. **PILOT** only when all P0 pass, critical P1 journeys pass, performance is acceptable at representative volume, and backup/restore is proven from physical media.

---

## Phase 7 — Close the money loop · ~5 weeks

The system currently tracks what it sold, what it holds, and what customers owe. It does not track **what the pharmacy owes, what it sent back, or what it spent.** Until it does, no figure it reports is a business result — only a sales result.

Apply the same discipline the customer ledger already uses: append-only, running balance, invariants in the database rather than in the service layer.

### 7.1 Fiscal operations surface · **shipped in Phase 6**

Pulled forward because 6.4 depends on it. Delivered: status counts and a filtered invoice list behind `fbr.view_status`, per-invoice attempt history from `fbr_invoice_attempts`, and a reason-required, idempotent, audited retry behind `fbr.retry` that resets the durable outbox row instead of calling the gateway inline. See `docs/PHASE_6_EXECUTION.md` §1.1.

### 7.2 Supplier ledger and accounts payable · ~2 weeks

Mirror `customer_ledger_entries` on the purchase side.

- `supplier_ledger_entries` — append-only, one row per goods receipt (payable increase), supplier payment, debit note, or adjustment, each carrying `balance_after`. Enforce the running-balance arithmetic and branch ownership with a trigger, exactly as `009_phase2_stock_ledger_integrity.sql` does for stock.
- `supplier_payments` — partial and full payment against one or more invoices, idempotent, and reconciling into the active cash session when paid in cash, the way customer payments already do.
- Credit terms and due dates on `suppliers`; aged payables by 30/60/90 days.
- Supplier statement, payables report, and a payables total on the owner dashboard beside receivables.
- **Invariant:** a goods receipt and its payable entry are written in one transaction. There is no "received but unbilled" state that the ledger cannot explain.

### 7.3 Purchase returns and debit notes · ~1.5 weeks

Close the loop that `expiry_work_items.SUPPLIER_RETURN_CANDIDATE` already opens and then abandons.

- `purchase_returns` and `purchase_return_items`, referencing the original `goods_receipt_items` so a return is always against something actually received — the same shape as the sales-return workflow.
- Dispositions: expired, damaged, over-supplied, wrong item.
- Every line writes a `SUPPLIER_RETURN` stock movement that decrements the batch, and a debit-note entry that decrements the supplier payable. Both in one transaction.
- Batch splitting for partial returns, reusing the mechanism returns already has.
- Wire it to the expiry work item: **flag → propose supplier return → approve → despatch → credit received**, so near-expiry stock has a path to recovered value instead of only to scrap.
- A "supplier return candidates" view grouped by supplier, because claims are submitted per distributor, not per batch.

### 7.4 Expenses and the day book · ~1 week

- `expense_categories` (rent, utilities, salaries, staff advance, delivery, maintenance, other) and `expenses` — amount, category, payment method, optional supplier, reference, approver.
- A cash expense posts a `CASH_OUT` movement against the open session, so the till reconciles against reality rather than against sales alone.
- Day book: opening cash, sales, collections, expenses, supplier payments, closing cash — one page the owner reads at close.
- Extend the profit report so it can show gross profit _and_ an operating figure after recorded expenses, each clearly labelled. **Label it an operational estimate, not statutory accounts.**

**Exit gate:** an owner records a supplier invoice on credit, pays part of it from the till, returns an expired batch to that supplier and sees the payable fall by the credit amount, records the day's expenses, and reads a day book whose closing cash equals the counted drawer — with every one of those movements traceable to an append-only ledger row. Proven by integration tests including a concurrency test on supplier payment and debit-note posting.

---

## Phase 8 — Daily operations depth · ~4 weeks

Phase 7 makes the books correct. Phase 8 makes the daily work fast.

### 8.1 Stock-take sessions · ~1.5 weeks

Per-batch counted adjustment exists; the monthly routine does not.

- `stock_take_sessions` and `stock_take_items` — scope by shelf, category, or supplier; snapshot expected quantities at open; enter counts by scan or keyboard; review a variance summary with value at risk; post in one approved batch.
- Every posted variance writes the `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` movements the existing per-batch path already writes. **No new privileged write path into stock.**
- Blind-count mode (expected quantity hidden during entry) so the count measures the shelf rather than the screen.
- A session in progress must not block sales. Record the variance against the snapshot and reconcile movements that occurred during the count rather than freezing the shelf.

### 8.2 Barcode and shelf labels · ~1 week

- Label templates for the batch (name, strength, price, expiry, barcode) and the shelf, rendered to the existing print boundary.
- Print on goods receipt and on price change; batch-print a shelf or a whole receipt.
- Generate an internal barcode for items that arrive without one, so every item is scannable at the counter.

### 8.3 Administration and operational completeness · ~1 week

- ~~Retire the remaining orphaned permissions.~~ **Done in Phase 6.** `backup.restore`, `ai.audit.read`, `fbr.view_status`, `fbr.retry`, and `returns.refund_cash` are all enforced, and `analytics.owner.read` opens the owner dashboard.
- ~~Document the `INVENTORY_MANAGER` purchase-approval split.~~ **Done in Phase 6:** recorded as deliberate segregation of duties.
- ~~Bulk catalog import and correction.~~ **Done in Phase 6**, pulled forward because 6.5 needs it.
- Alias procurement responses to camelCase to match the rest of the API contracts. Still open.

### 8.4 Urdu completion and counter ergonomics · ~0.5 weeks

- Complete the Urdu catalog and have a pharmacist review the terminology. The plumbing landed in Phase 3; the content did not.
- Validate RTL on every screen added since, including the two added in this audit.

**Exit gate:** a pharmacy completes a month-end stock take through the session workflow, prints shelf and batch labels for a full goods receipt, imports a corrected catalog file, and operates a full day in Urdu — with no orphaned permission left in the seed.

---

## Phase 9 — Deferred scope

Not scheduled. Each needs a product decision before it gets a phase.

| Item                                      | Note                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prescription capture                      | Deferred since the original plan. Revisit only with a clear regulatory driver.                                                                                                                                            |
| Controlled-drug register                  | Regulatory; needs legal input on the required register format before any schema is designed.                                                                                                                              |
| Multi-shop                                | `branch_id` is already on every transactional table and the cross-branch leaks were fixed in Phase 2, so this is a phase, not a rewrite. Needs inter-branch transfer, consolidated reporting, and a replication decision. |
| True offline operation                    | **Revisit before Phase 7 ships, not after.** Retrofitting synchronization after the supplier and customer ledgers exist is materially harder than before. If unreliable power or multi-site is the target, decide now.    |
| Statutory accounting / general ledger     | The system should export to an accountant's tool, not become one. Define the export format instead.                                                                                                                       |
| Loyalty, e-commerce, supplier portal, SMS | Explicitly excluded by architecture §4. Excluded here too.                                                                                                                                                                |

---

## Sequencing and risk

**Critical path:** Phase 6 hardware → 7.1 fiscal surface → 6.4 fiscal activation → pilot. Phase 7.2–7.4 can be built during Phase 6 because Phase 6 is gated on equipment and people rather than on code.

| Phase | Engineering | Elapsed                        |
| ----- | ----------- | ------------------------------ |
| 6     | ~1.5 weeks  | ~4 weeks (procurement + pilot) |
| 7     | ~5 weeks    | ~5 weeks                       |
| 8     | ~4 weeks    | ~4 weeks                       |

**~10.5 developer-weeks of engineering; ~13 weeks elapsed to a complete, piloted pharmacy operating system**, assuming hardware and the fiscal integrator are engaged at the start of Phase 6 rather than when their phase arrives.

**Risks:**

- **The fiscal integrator is still the longest external dependency.** Start it on day one of Phase 6.
- **Phase 7 touches money that has never been modelled here.** Supplier payables and debit notes interact with cash sessions, stock, and expiry in ways the current test suite does not cover. Treat 5 weeks as a floor and write the concurrency tests first, as Phase 2 did.
- **Master data quality will decide whether the pilot succeeds.** Correct software over a wrong catalog produces confidently wrong numbers. 8.3's bulk import should be pulled forward into Phase 6 if the pilot pharmacy's catalog is large.
- **The offline decision has a deadline.** Before Phase 7 ships, not after.

## Standing rules

Carried forward from `AGENTS.md` and `DEVELOPMENT_PLAN.md`, unchanged:

- Money and quantities stay exact. Never floating point.
- Stock, cash, customer-credit, and now supplier-credit ledgers are append-only, with invariants in the database.
- Idempotent writes lock before the replay read and reuse the same `clientRequestId` on retry.
- Migrations are immutable after application.
- Internet-dependent integrations never block a LAN sale.
- Run `npm run verify` before handing off a change, and **record actual exit codes**. A gate is not passed because the code exists.
