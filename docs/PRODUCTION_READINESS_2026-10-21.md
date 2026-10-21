# PharmacyOS — Production Readiness Assessment

> **Date:** 2026-10-21
> **Branch:** `claude/peaceful-mendel-mfd4po` (based on `development` at `1087fc3`)
> **Scope:** single shop · on-premise LAN · the architecture and gates in `docs/DEVELOPMENT_PLAN.md` and `docs/PHARMACY_OS_COMPLETION_ROADMAP.md` are unchanged.

## 1. Verdict

**Ready for a supervised pilot in one pharmacy. Not ready to hand to 3–4 pharmacies unsupervised.**

The transactional core (exact money, append-only ledgers, idempotent checkout, FEFO stock, cash
reconciliation) was already well designed. Running the software the way a pharmacy would use it,
rather than only through its test suite, found several defects that would have stopped a shop on
day one: checkout could not reserve stock from the browser, every background job failed, every edit
screen failed across origins, the owner assistant failed on every question, and refunds could pay
out more than the customer paid. All of those are fixed, covered by tests that fail against the old
code, and re-verified against the running system.

What remains is not code. It is the on-site evidence the project's own gates already require:
real terminals, printer, scanner and drawer; a backup restored from a physical disk; FBR
authorization; and a 14-day parallel pilot. Selling before those are done means the first shop is
the test site. Section 6 gives a rollout plan that makes that explicit.

## 2. What changed

| Area       | Change                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface  | Rebuilt on one design system: grouped sidebar, top bar with till and server status, consistent forms, tables, dialogs and toasts; keyboard-first counter (F2/F4/F6/F7/F8, arrow keys, `*qty`), exact money everywhere, branch-local dates. Every screen was redesigned: counter, cash drawer, returns, customers, budget planner, inventory, purchasing, dashboard, reports, operations and settings. |
| Onboarding | Medicine list and opening-stock imports in 500-row parts; the whole file is checked before anything is written; problems are reported by spreadsheet line; day-first and month-only expiry formats are accepted; the same opening batch cannot be loaded twice.                                                                                                                                       |
| Purchasing | Order builder with medicine search, receiving with batch, expiry, sale price and MRP checks (sale price above MRP and expired batches are refused), cancellation with reason, supplier price comparison, and a reorder suggestion opens a pre-filled order when no supplier price is on record yet.                                                                                                   |
| Reports    | Nine typed reports (daily sales, item sales, profit, returns register, cash sessions, stock valuation, expiry, purchases, stock losses) with totals, CSV export of exact values and A4 print.                                                                                                                                                                                                         |
| Stock      | Stock overview with low/out/expiring filters, per-medicine batches and movement history, count/price/scrap actions, editable reorder levels.                                                                                                                                                                                                                                                          |
| Returns    | Refunds never exceed what was paid; khata sales cannot be refunded in cash while still owed; rejection; lookup by invoice number.                                                                                                                                                                                                                                                                     |

## 3. Defects found and fixed

Severity: **Critical** = a shop cannot operate or money/stock is wrong; **High** = a core workflow
fails; **Medium** = wrong or misleading information. "Original" means the defect was present before
this work began; "New UI" means it was introduced during the interface rebuild and caught before release.

| #   | Severity | Defect                                                                                                                                                                                                                                                | Origin                               | Fix and test                                                                                                                                                       |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Critical | Checkout could not reserve stock: the browser sent bodyless commands (reserve, reprint, approve return, acknowledge alert, sign out) with a JSON content type, which the server rejects with 400.                                                     | Original                             | Header sent only with a body. Unit test `apps/web/src/api.test.ts`; live sale verified.                                                                            |
| 2   | Critical | Every scheduled job failed ten times and raised a critical alert: dashboard metrics, availability snapshots, expiry risk, reorder suggestions, shelf recommendations. Job summaries were double-encoded into a jsonb column that must hold an object. | Original                             | `sql.json(toJsonValue(...))`. `tests/integration/background-jobs.integration.test.ts` drives all five jobs through the worker loop; it fails against the old code. |
| 3   | Critical | Refunds were computed without the invoice discount (a fully returned discounted sale refunded more than was paid); partial returns could over-refund through rounding; a khata sale could be refunded in cash while still owed.                       | Original                             | Cumulative refund limits; `RETURN_CREDIT` ledger entry (migration 017). `returns-refund.integration.test.ts`.                                                      |
| 4   | Critical | Any transaction that changed a batch twice was rejected at commit (deferred triggers compared against a stale row); this also broke the development seed.                                                                                             | Original                             | Migration 016. `stock-ledger.integration.test.ts`.                                                                                                                 |
| 5   | High     | All edit screens (PATCH/PUT: medicines, suppliers, customers, users, shop rules, tax registration, reorder levels) failed whenever the web app and API were on different origins: CORS allowed only GET/HEAD/POST.                                    | Original                             | CORS methods; HTTP setup shared by server and test harness. Test in `production-hardening.integration.test.ts`.                                                    |
| 6   | High     | The owner assistant returned 400 on every question (same jsonb defect as #2 in its audit row).                                                                                                                                                        | Original                             | Same fix; covered by `background-jobs.integration.test.ts`.                                                                                                        |
| 7   | High     | Reorder suggestions never appeared outside the development seed (no default reorder policies), and inventory managers could not list suppliers to order from.                                                                                         | Original                             | Worker creates default policies; `GET /suppliers` for purchasers. `production-hardening.integration.test.ts`.                                                      |
| 8   | High     | "Draft order" from a reorder suggestion dead-ended whenever no supplier price was on record — every medicine on day one.                                                                                                                              | Original                             | Opens a pre-filled order builder. Verified live.                                                                                                                   |
| 9   | High     | Catalog imports over ~700 rows were rejected by the request-size guard.                                                                                                                                                                               | Original                             | 500-row parts with whole-file validation.                                                                                                                          |
| 10  | High     | Goods receipt could turn a quarantined or recalled lot back to sellable, and recorded no price history.                                                                                                                                               | Original                             | Status preserved; INITIAL/MANUAL price history. `production-hardening.integration.test.ts`.                                                                        |
| 11  | High     | Privilege escalation: a system administrator could grant itself OWNER or reset the owner's password; the supervisor-approval prompt could be used to guess a supervisor's password without lockout.                                                   | Original                             | Authority checks; failed approvals count toward lockout. RBAC and hardening suites.                                                                                |
| 12  | High     | The API could not start under `npm run dev` (missing explicit injection).                                                                                                                                                                             | Original                             | Explicit `@Inject`.                                                                                                                                                |
| 13  | Medium   | Successful sign-ins counted toward the per-IP login limit, so a terminal where staff switch accounts could lock itself out.                                                                                                                           | Original                             | Success refunds its attempt. `auth-hardening.integration.test.ts`.                                                                                                 |
| 14  | Medium   | Reports and the owner dashboard bucketed sales by UTC day instead of the branch's business day; the new interface's date formatter also showed timestamps as the UTC day (a sale at 00:30 PKT appeared under the previous day).                       | Original (reports); new UI (display) | Branch-local business days on the server; terminal-local display.                                                                                                  |
| 15  | Medium   | Purchase-order lines showed no total or unit cost (stored costs have 8 decimals); "last received" ignored partial deliveries.                                                                                                                         | New UI                               | Normalised before exact arithmetic. e2e asserts the total.                                                                                                         |
| 16  | Medium   | Closing a drawer that was short within the allowed limit said "The day is reconciled"; the till chip kept the old expected cash after a sale or refund.                                                                                               | New UI                               | Shortage/overage stated; cache refreshed.                                                                                                                          |
| 17  | Medium   | Counter availability ignored other counters' reservations.                                                                                                                                                                                            | Original                             | Reservations subtracted.                                                                                                                                           |
| 18  | Medium   | Database constraint and trigger errors reached the operator as "Request violates a database constraint".                                                                                                                                              | Original                             | Readable messages for known constraints and trigger errors.                                                                                                        |

## 4. Verification evidence

All commands were run on 2026-10-21 in the development container (Node 22.22.0, PostgreSQL 18.4 via
Testcontainers, Chromium 141.0.7390.37).

| Command                                                                         | Exit code | Result                                                                             |
| ------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `npm run format:check`                                                          | 0         | Prettier clean                                                                     |
| `npm run lint`                                                                  | 0         | ESLint, `--max-warnings 0`                                                         |
| `npm run typecheck`                                                             | 0         | strict TypeScript, all workspaces                                                  |
| `npm run test:unit`                                                             | 0         | 125 tests in 36 files (api 26, web 50, worker 9, config 10, database 6, shared 24) |
| `npm run test:integration` (`TESTCONTAINERS_RYUK_DISABLED=true`)                | 0         | 101 tests in 14 suites against PostgreSQL 18.4                                     |
| `npm run test:e2e` (`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`) | 0         | 18 browser tests in 5 specs                                                        |
| `npm run build`                                                                 | 0         | all packages and apps                                                              |
| `npm run verify` (all of the above, in that order)                              | 0         | full gate passed in one run                                                        |

**Live end-to-end runs** against the development stack (API, worker, web, PostgreSQL 18) with the
development seed, driven in Chromium at 1366×768:

- Cashier day: open drawer → scan → split cash/card → receipt → return → supervisor approval → cash refund → count and close. Drawer arithmetic checked: 5,000.00 + 3 × 28.00 − 9.50 = 5,074.50.
- Dashboard after that day: net sales 104.50 (114.00 − 9.50 refund), cost 72.50 (11 units × 1,450.00 ÷ 220), profit 32.00 (30.6%).
- Supervisor-approved 20% discount and a khata sale: 70.00 − 14.00 = 56.00 on account; Rs 10 payment → owes 46.00; drawer up by exactly 10.00.
- Purchasing: order 10 packs × 20 units at 150.00 less 50.00 discount plus 1 bonus pack → receipt of 6 + 1 packs = 140 units at 6.59 per unit; sale price above MRP refused.
- Opening stock: a file with an impossible date, an unknown SKU and a sale price above MRP is rejected with nothing written; the corrected file loads 3 batches, 1,260 units, Rs 2,730.00 at cost (= 1,200 × 2.10 + 50 × 4.00 + 10 × 1.00); loading it again is refused.
- Inventory: reorder review, expiry action, shelf move, price/count/scrap on a batch, pre-filled order from a suggestion.
- Settings: staff account, medicine edit, supplier, shelf and medicine placement, terminal, shop rules, tax registration; the new cashier signs in on the new terminal and sees only counter screens.
- Operations: purchase-order cancellation, return rejection, alert acknowledgement, profit report CSV.
- Production build served with the Caddyfile's Content-Security-Policy: every screen and the receipt QR load with no CSP violations or console errors.
- All 39 read endpoints used by the interface return 200 for the owner role.

## 5. Not verified — must be done before go-live

These are the existing gates in `docs/DEVELOPMENT_PLAN.md` (Phases 1, 3 and 5) and Phase 6 of the
roadmap. None can be closed by writing code.

1. **Hardware.** Barcode scanner (rapid-scan test), 80 mm ESC/POS printer (receipt legibility, QR, reprint), cash drawer kick, UPS. Printing was verified only as a browser print preview; the thermal path (WebUSB) has unit tests but no device test.
2. **Second terminal over the LAN** with the Caddy internal CA trusted, no certificate warning, correct clock, and a complete sale.
3. **Backups on a physical external disk**, and a restore from that disk through the application role inside 15 minutes, recorded in `backup_runs`. The dashboard and Operations screen currently show "No successful backup" on the development stack; that alert must be green before go-live.
4. **FBR.** `FBR_MODE` must stay `DISABLED` until written outbound-data approval, licensed-integrator review and real sandbox evidence exist. Each shop also needs its NTN and POS registration entered under Settings → Shop rules & tax.
5. **Data migration** of each pharmacy's real catalogue and opening stock, reconciled by the owner before the first sale.
6. **14-day parallel pilot** with a signed daily reconciliation (`docs/PILOT_RUNBOOK.md`).

## 6. Known limitations

- **Urdu** switches the layout to right-to-left and translates navigation, sign-in and the counter's controls; most screen content is still English.
- **One branch per installation.** Multi-branch is out of scope by design.
- **No offline client.** The LAN and the shop server must be up for sales; the internet need not be.
- A purchase order created from a suggestion through the pre-filled builder is not linked back to the suggestion; the suggestion stays open until dismissed or regenerated.
- Controlled-drug registers, DRAP reporting, supplier payables, purchase returns, expenses and stock-take sessions are Phase 7–8 scope and are not implemented.
- The browser suite runs against mocked API responses; the live runs in section 4 were scripted for this assessment and are not part of `npm run verify`.

## 7. Recommended rollout for the pharmacies already pitched

1. **One pilot shop first.** Install on that shop's hardware, close items 1–3 of section 5 on site, import the real catalogue and opening stock, and run in parallel with the existing system for 14 days.
2. **Fix what the pilot finds** before the second install. Expect issues in scanner configuration, receipt layout on the actual printer, and catalogue data quality.
3. **Then the remaining shops one at a time**, each with its own hardware check, data import and a shorter parallel run.
4. **FBR activation** per shop only after the authorization in item 4 is in hand.
5. Agree a support arrangement (who answers when a counter stops, how backups are checked) before the first shop goes live.
