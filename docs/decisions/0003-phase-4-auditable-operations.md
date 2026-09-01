# ADR 0003 — Auditable Phase 4 Operations

- **Status:** accepted
- **Date:** 2026-09-01
- **Scope:** customer credit, discounts, prices, stock adjustments, reports, and administration

## Context

Phase 4 introduces liabilities and operational overrides that cannot be reconstructed safely from a mutable current value. Customer credit, discounts, price changes, and physical stock corrections affect money, inventory, permissions, or regulatory evidence. The owner dashboard also has to remain available with AI and internet integrations disabled.

## Decision

1. Customer credit is an append-only, branch-scoped ledger. Each entry stores an exact signed delta and balance-after snapshot. The database serializes writes per customer, validates the running balance and limit, and blocks mutation or deletion.
2. Credit sale and account payment paths lock their idempotency key before replay checks. Transaction lock order is cash session, sale draft or customer, then inventory rows in deterministic order.
3. Discounts require immutable approval evidence. Policy-level approval and supervisor override are distinct permissions; the database rejects a discounted finalized sale without matching approval.
4. Batch price/MRP changes require append-only history in the same transaction. A deferred constraint rejects an update whose latest history row does not match the batch.
5. Count and scrap operations create immutable adjustment records and matching stock movements. Inventory quantity remains a projection of its ledger and cannot be overwritten without evidence.
6. Reports are deterministic application services exposed independently of AI. The worker writes branch-local daily dashboard projections; source sales, cash, stock, credit, and backup ledgers remain authoritative.
7. Financial and quantity values remain exact decimal strings at API boundaries and PostgreSQL `numeric` values at rest. Presentation-only chart conversion to JavaScript numbers occurs after authoritative totals are returned.
8. Administration uses soft deactivation, explicit branch ownership, session revocation, last-owner protection, and append-only audit events. Audit metadata must be a JSON object, never a stringified JSON value.

## Rejected alternatives

- A mutable `customers.balance` column was rejected because it loses event history and makes replay/concurrency reconciliation ambiguous.
- Application-only credit, discount, price, and quantity checks were rejected because alternate write paths could bypass them.
- Replacing price or stock values without history was rejected because the source of a discrepancy would be unknowable.
- AI-only reporting was rejected because the shipped configuration disables AI and internet access must not block LAN operations.
- Synchronous dashboard aggregation on every owner page load was rejected because it couples read latency to transactional volume.

## Consequences

- Writes create more rows and require disciplined lock ordering, but every liability or override has durable evidence.
- Dashboard data can lag by up to the worker schedule and must identify itself as a projection.
- Direct SQL maintenance that ignores ledger/history contracts will fail database constraints by design.
- The UI must display exact strings for authoritative values and treat number conversion as visualization only.
- Future multi-branch work can retain these contracts because every transactional boundary carries explicit branch ownership.
