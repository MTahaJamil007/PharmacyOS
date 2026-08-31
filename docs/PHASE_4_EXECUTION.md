# Phase 4 Execution — Operational Completeness

- **Roadmap source:** `docs/DEVELOPMENT_PLAN.md`
- **Started:** 2026-09-01
- **Branch:** `development`
- **Status:** in progress
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

## Exit gate

The owner-day scenario from the roadmap must execute without direct SQL: open till, customer credit sale, account payment, discounted sale, stock adjustment, till close, and deterministic daily report. Physical Phase 3 validation remains a separate pilot prerequisite and cannot be inferred from this phase.
