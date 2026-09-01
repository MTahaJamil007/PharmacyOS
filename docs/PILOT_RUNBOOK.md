# PharmacyOS Phase 5 Pilot Runbook

- **Scope:** one friendly Pakistani pharmacy, one server, and counter terminals on one LAN
- **Pilot duration:** 14 consecutive operating days in parallel with the existing system
- **Release authority:** pharmacy owner, implementation lead, licensed fiscal integrator, and tax adviser
- **Supporting runbook:** `docs/RUNBOOK.md`

## 1. Entry conditions

Do not start the pilot until every item below has named evidence and an owner:

| Condition           | Required evidence                                                                              | Current repository evidence                   |
| ------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| P0/P1 software gate | `npm ci`, `npm run verify`, migration checks, Phase 5 integration, and performance gate exit 0 | Automated locally; see `PHASE_5_EXECUTION.md` |
| Backup and restore  | Encrypted backup on the actual external disk and isolated restore under 15 minutes             | Pending target disk                           |
| LAN/TLS             | Trusted HTTPS sale from a second physical LAN terminal                                         | Pending second terminal                       |
| Fiscal              | Licensed-integrator sign-off and real sandbox validate/submit evidence                         | Pending approval, credentials, and integrator |
| Tax/receipt policy  | Written decision on printing before fiscalization and approved QR/invoice layout               | Pending tax adviser                           |
| Hardware            | Scanner, 80 mm printer, cash drawer, and UPS matrix passes on target devices                   | Pending hardware                              |
| Staff               | Named users complete role-appropriate training and supervised dry run                          | Pending pilot pharmacy                        |

Any authorization bypass, duplicate refund/fiscal invoice, inventory-ledger mismatch, money/rounding error, secret exposure, or failed restore is an immediate **BLOCK**.

## 2. Hardware acceptance matrix

Record manufacturer, model, firmware/driver, connection type, terminal, browser, timestamp, operator, and pass/fail.

| Device              | Test                                                          | Pass condition                                                                                       | Digital substitute already available                          |
| ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Barcode scanner     | Scan 30 configured and 10 unknown barcodes rapidly            | Each scan produces one exact lookup; unknowns remain controlled; no dropped/duplicated characters    | Keyboard barcode input and exact-barcode API performance test |
| 80 mm printer       | Print original and reprint for cash/split/credit/return cases | No clipping; exact totals/tax; return token and approved fiscal QR scan; reprint audit exists        | Browser/PDF receipt layout tests; not physical proof          |
| Cash drawer         | Complete cash sale/refund and invoke configured drawer action | Opens only for authorized cash events; failure does not corrupt sale state                           | Cash-ledger and receipt workflow tests; no electrical proof   |
| UPS                 | Remove mains power under supervised load                      | Server, switch/router, and counter path remain available for the agreed runtime and shut down safely | None                                                          |
| Server/external SSD | Backup, checksum, unplug/reconnect, restore drill             | Correct physical destination, encrypted artifact, valid checksum, restore under 15 minutes           | Docker restore automation only                                |
| Second terminal     | Trusted HTTPS owner-day workflow                              | No certificate warning; sale, reload, receipt, and stock evidence pass over LAN                      | Local browser test only                                       |

## 3. Installation and activation

1. Follow `docs/RUNBOOK.md` sections 2–5 exactly; record host revision and image digests.
2. Rotate all placeholder secrets. Keep FBR token and backup identity out of Git, logs, screenshots, and the external backup disk.
3. Load verified medicine HS codes, tax rates, units of measure, and sale types. Export and review the configured catalog before the first pilot sale.
4. Configure fiscal identity in Administration. Leave `FBR_MODE=DISABLED` until all fiscal activation conditions in ADR 0004 are signed.
5. Complete the physical matrix and immediate encrypted backup/restore drill.
6. Create named staff accounts with least privilege. Never share the owner account at the counter.
7. Execute the full owner-day rehearsal and reconcile sales, cash, stock, customer credit, fiscal state, alerts, backup, and audit events.

## 4. Staff training

| Role                  | Must demonstrate without assistance                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Cashier               | Sign in, open till, search/scan, reserve, cash/split/credit sale, receipt/reprint, find customer, close/count till, escalate variance     |
| Pharmacist/supervisor | Prescription confirmation policy, discount override, return/refund approval, unsafe-storage escalation, variance approval                 |
| Inventory operator    | Receive a multi-line PO, verify bonus/base units, count/adjust/scrap, price/MRP change, expiry and reorder review                         |
| Owner/admin           | User/role changes, fiscal/tax settings, dashboard/reports, alert acknowledgement, backup/restore evidence, incident and rollback decision |

Use anonymized training data. Do not enter real customer identity until production privacy handling is approved.

## 5. Fourteen-day parallel run

For every day, retain a signed reconciliation sheet with:

- opening/closing cash, captured payments, refunds, account payments, cash movements, variance, and approval;
- invoice count and gross/net/tax totals against the existing system;
- item/batch stock differences, receipts, adjustments, scrap, and expiry actions;
- customer-credit opening, sales, payments, and closing balance;
- submitted/pending/review fiscal counts and every attempt outcome;
- open/acknowledged operational alerts, failed jobs, API/worker health, and incident references;
- latest backup/restore status and the physical destination checked;
- p95 counter observations or a note confirming no latency complaint/time-out.

Investigate differences the same day. Never patch authoritative rows manually to force reconciliation; correct through audited workflows or stop and escalate.

## 6. Stop and rollback

Stop new PharmacyOS writes immediately for a release-blocking defect. Preserve logs, database volume, backup artifacts, timestamps, affected IDs, and operator statements.

1. Switch staff to the existing system and mark the exact cutover time.
2. Reconcile transactions created since the last common checkpoint; do not replay a write with a new client request ID.
3. Disable fiscal workers if duplicate/ambiguous submission is suspected; the licensed integrator must reconcile before retry.
4. Take an encrypted incident backup if the database remains consistent.
5. Roll back only to an application image explicitly compatible with the current forward-only schema. Otherwise restore the pre-change backup into an isolated database and perform controlled recovery.
6. Resume only after the defect has a reproducible test, the full gate passes, restore evidence is current, and release authorities sign off.

## 7. Exit decision

The pilot passes only after 14 consecutive days with reconciled cash, stock, credit, tax, and fiscal evidence; no unresolved P0/P1 defect; acceptable measured counter latency; successful backup/restore; trained staff; and signed hardware, fiscal, tax, and owner acceptance. A repository test cannot substitute for these observations.
