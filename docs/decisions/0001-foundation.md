# ADR 0001: Local-first modular monolith foundation

## Status

Accepted on 2026-08-20.

## Decisions

- PostgreSQL is the only source of permanent business truth.
- API and worker share typed configuration and database packages, but deploy as separate processes.
- Critical inventory and financial transactions use explicit SQL through repositories; controllers never own business rules.
- Redis is optional support and is absent from sale finalization.
- Audit events and stock movements are append-only at the database layer.
- Public IDs remain internal `bigint` identities for the single-database MVP.
- FBR submission is a durable outbox job and never blocks the local sale transaction.
- Money crosses API boundaries as decimal strings and is stored as `numeric`, never floating point.

## Consequences

- A database restore recovers operational truth without reconstructing it from queues or caches.
- Inventory concurrency is visible and testable at the SQL transaction boundary.
- A later cloud or multi-branch product should be a separate architecture decision, not an accidental extension of this schema.
