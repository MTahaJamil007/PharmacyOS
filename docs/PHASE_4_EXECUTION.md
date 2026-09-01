# Phase 4 Execution — Operational Completeness

- **Roadmap source:** `docs/DEVELOPMENT_PLAN.md`
- **Started:** 2026-09-01
- **Completed:** 2026-09-01
- **Branch:** `development`
- **Status:** software exit gate passed
- **Entry evidence:** Phase 3 software and digital-simulation gates passed. The user explicitly deferred unavailable physical scanner/printer/drawer and pharmacist validation to the Phase 5 pilot gate; `PHASE_3_EXECUTION.md` records the limitation.

## Delivery order

| Order | Workstream                   | Non-negotiable controls                                                                                                                               |
| ----- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Customers and credit         | Branch-scoped customers; append-only exact ledger; locked balance/limit checks; idempotent payments; statements and aged receivables.                 |
| 2     | Reports and dashboard        | Deterministic non-AI endpoints; permission separation; branch-local dates; persisted daily metrics; backup/restore and fiscal visibility.             |
| 3     | Discounts, prices, and stock | Server-authoritative discount approval; immutable price history; counted adjustments and scrap through the stock ledger; no direct quantity mutation. |
| 4     | Administration               | User/password, medicine, supplier, shelf, terminal, and policy management with soft deactivation, validation, audit events, and branch scoping.       |
| 5     | Web operations               | Fast customer attach at POS; owner dashboard; inventory/pricing/admin workspaces; shared compile-time contracts and accessible forms.                 |

## Evidence policy

- Every schema change is an additive immutable migration with exact numeric types, foreign-key indexes, database constraints, and least-privilege compatibility.
- Financial, credit, and stock mutations lock before replay/limit checks and write append-only evidence inside one short transaction.
- Focused integration tests prove branch isolation, permissions, idempotency, limits, and ledger reconciliation before the full repository gate runs.
- Commands, exit codes, hosted CI, limitations, and the final owner-day exit scenario are recorded here as they execute.

## Delivered scope

### 4.1 Customers and credit ledger

- Added branch-scoped customers with normalized phone lookup, soft deactivation, exact credit limits, and opening balances.
- Added an append-only customer ledger for opening balance, credit sale, payment, and adjustment entries. A database trigger serializes each customer's writes, proves the running balance, enforces branch ownership and credit limits, and prevents mutation or deletion.
- Added optional POS customer attachment, `CREDIT` tender, explicit credit and payment permissions, account payments, customer statements, and aged receivables.
- Cash account payments reconcile into the active cash session and expected till cash. Write retries reuse a client request ID and lock before replay checks.

### 4.2 Deterministic reports and owner dashboard

- Exposed sales, gross-profit estimate, low-stock, expiry-risk, purchase, supplier-price, shelf, returns, and cash-reconciliation reports without requiring AI.
- Implemented hourly durable `REFRESH_DASHBOARD_METRICS` jobs and branch-local persisted daily snapshots.
- Added the 12-metric owner ledger, seven-day chart, top movers, receivables, expiry/dead-stock exposure, fiscal failures, cash variance, and backup/restore evidence.
- Kept the AI assistant read-only and subordinate to deterministic report facts. Internet or AI failure does not block reports or LAN sales.

### 4.3 Discounts, prices, and physical stock

- Added exact line and invoice discounts, policy thresholds, supervisor credential verification, immutable approval evidence, and database validation that discounted sales reference a valid approval.
- Added batch sale-price/MRP controls and append-only price history. A deferred database constraint rejects a price change without a matching history row.
- Added counted stock and scrap workflows backed by exact stock movements and immutable adjustment records. Direct unledgered quantity changes remain invalid.
- Preserved separate rounding for each FEFO batch fragment and allocated discounts deterministically, so reservation and finalization totals are identical.

### 4.4 Day-two administration

- Added permissioned user creation, role assignment, password change/reset, deactivation, session revocation, and last-active-owner protection.
- Added medicine/barcode, supplier, shelf/medicine assignment, terminal, and operational-policy management.
- All administration writes validate input, enforce branch ownership where applicable, use short transactions, and emit JSON-object audit events.

### Web operations

- Added customer accounts, owner dashboard, inventory count/scrap/price, and administration routes with shared API contracts and responsive, keyboard-accessible forms.
- Added `recharts` `3.10.1` as an exact dependency. Owner-only charts remain lazy-loaded away from the counter route.
- Customer identity is not rendered on browser-printed receipts by default; exposing personally identifiable information on a take-away receipt requires an explicit privacy policy decision.

## Objective evidence

| Command / check                                                                                    | Exit | Evidence                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                           |    0 | Clean lockfile install; 709 packages installed, 0 reported vulnerabilities.                                                                 |
| `npx vitest run --config vitest.config.ts tests/integration/migration-harness.integration.test.ts` |    0 | 7/7 clean PostgreSQL migration, checksum, role, and rollback checks passed on Docker PostgreSQL 18.4.                                       |
| `npx vitest run --config vitest.config.ts tests/integration/phase4-owner-day.integration.test.ts`  |    0 | 2/2 real-database scenarios passed: the complete owner day plus every Phase 4.4 administration resource.                                    |
| `npx playwright test tests/e2e/phase4-owner-day.spec.ts`                                           |    0 | Owner-facing customer payment, cycle count, and deterministic dashboard screen workflow passed.                                             |
| `npm run verify` under Node `24.19.0` / npm `10.9.3`                                               |    0 | Formatting, lint, typecheck, 69 unit tests, 55 Docker/PostgreSQL integration tests, 9 browser workflows, and every production build passed. |
| `git diff --check`                                                                                 |    0 | No whitespace errors.                                                                                                                       |

The Windows npm launcher is installed beside Node 22.20.0 and emits engine warnings even when the shell resolves Node 24.19.0. The authoritative gate invoked that npm CLI through the Node 24.19.0 executable; application scripts and tests therefore ran on the required runtime.

## Defects found and closed during the gate

- Administration writes initially double-encoded audit metadata. PostgreSQL rejected the JSON string through `audit_events_metadata_check`; both services now use the driver's typed JSON-object helper, and the administration integration scenario proves the fix.
- Reservation initially reused a medicine-level draft total and lost a paisa when one quantity crossed two fractional FEFO batches. Reservation now derives its subtotal from the same separately-rounded, deterministically discounted fragments used at finalization; the pre-existing money regression test passes.
- Gross-profit reporting initially summed sale-item totals and omitted invoice-level discounts. Revenue now comes from final sale totals while cost basis remains the recorded acquisition cost.
- The worker scheduler test now proves the hourly dashboard job's type, deduplication key, and priority rather than only increasing an expected call count.
- Strict lint and declaration builds exposed broad UI response types and a private report-result contract; both were corrected with named, exportable types.

## Known limitations and carry-forward

- Physical scanner, 80 mm printer, cash-drawer, and pharmacist-speed evidence is still unavailable. It remains an explicit Phase 5 pilot prerequisite and is not represented as passed.
- The dashboard surfaces backup and restore rows but cannot manufacture live external-disk evidence. The Phase 1 live encrypted backup/restore drill remains pending hardware access.
- Dashboard snapshots are hourly projections. The UI explicitly shows `PENDING_REFRESH` until the durable worker creates the row; source ledgers remain authoritative.
- Gross profit is an operational estimate based on final sale total less recorded batch acquisition cost and refunds; it is not statutory accounting profit.
- Vite reports a non-blocking chunk-size warning for the chart-heavy owner route/main bundle. Phase 5 performance work must measure representative data and may split chart/vendor chunks further.

## Exit gate

**Passed for Phase 4 software on 2026-09-01.** The real-database exit scenario seeds only prerequisite identity and inventory fixtures, then uses public application APIs to open the till, create a customer, apply a discount, complete a credit sale, record and idempotently replay an account payment, count stock, change a price, close the till, read the statement/report, run the durable dashboard refresh, and read its snapshot. A separate browser gate proves the new owner-facing customer, inventory, and dashboard screens. No operational step requires direct SQL.

Physical Phase 3 validation remains a separate Phase 5 pilot prerequisite and cannot be inferred from this phase.
