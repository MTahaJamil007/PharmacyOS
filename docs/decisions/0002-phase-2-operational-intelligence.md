# ADR 0002: Phase 2 operational intelligence

- **Status:** Implemented foundation
- **Date:** 2026-08-20
- **Decision owner:** PharmacyOS architecture

## Context

- Phase 2 must derive recommendations from the existing transactional core without becoming a checkout dependency.
- The repository already owns sales, sale lines, batch stock, purchase orders, return records, cash sessions, audit events, and a durable PostgreSQL outbox.
- Several Phase 1 concepts existed only as schema, not complete API/UI vertical slices. Phase 2 therefore extends those records and exposes the minimum dependent workflows instead of introducing duplicate sources of truth.

## Decision

- Keep deterministic calculations in PostgreSQL-backed domain services and shared exact-arithmetic functions.
- Run expiry, reorder, availability, and shelf refreshes through the existing durable worker/outbox.
- Persist recommendation inputs and human decisions; never rewrite finalized sale, receipt, movement, or return history.
- Use one active shelf/reorder recommendation per branch and medicine, enforced with partial unique indexes.
- Resolve receipt QR tokens through an authenticated endpoint; the token is a random UUID with no embedded invoice or customer data.
- Permit AI to explain only results returned by nine whitelisted aggregate tools. AI has no SQL or write tool, is optional, and cannot affect application health or POS availability.
- Keep the Gemini model identifier and key environment-configured. No provider model is embedded in business logic.

## Module dependency map

| Module                | Reads authoritative data                                               | Writes durable data                              | Depends on                    |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| Shelf intelligence    | `sales`, `sale_items`, medicine/shelf metadata                         | `shelf_recommendations`, audited location review | Auth/RBAC, worker             |
| Expiry intelligence   | `inventory_batches`, branch policy                                     | `expiry_work_items`                              | Auth/RBAC, worker             |
| Supplier intelligence | Accepted purchase orders/items, current quotes                         | `supplier_quotes`                                | Procurement permission        |
| Reorder v2            | Sales velocity, availability snapshots, batch stock, lead-time history | `reorder_suggestions`, draft `purchase_orders`   | Worker, supplier data         |
| Budget regimen        | Current FEFO sellable prices, entered regimen                          | Optional `budget_regimen_audits`                 | POS catalog, exact arithmetic |
| Returns               | Finalized sale lines, prior linked returns                             | Returns/refunds/stock movements/FBR outbox       | Auth/RBAC, cash sessions      |
| Owner AI              | Whitelisted aggregate queries only                                     | `ai_assistant_audits` metadata                   | Optional Gemini provider      |

## Data and transaction rules

- Money stays `NUMERIC` in PostgreSQL and decimal strings/integer minor units in TypeScript.
- Review, draft-PO conversion, return approval/refund, and stock disposition use short transactions with row locks and stable lock ordering.
- Foreign keys use restrictive deletion for regulated history; branch-scoped configuration/recommendations may cascade only when the branch itself is removed.
- Background runs and outbox deduplication keys make scheduled refreshes retry-safe.
- New query indexes follow the actual work queues and authorization scopes.

## Consequences and known boundaries

- The local application remains fully operational when AI or the public internet is unavailable.
- The worker performs bounded aggregate SQL suitable for the existing low-cost deployment; representative-volume benchmarks remain a release gate.
- Real receipt QR rendering, production FBR submission/credit-note adapters, backup automation, and full cash-session operations are deployment/Phase 1 completion dependencies, not silently simulated here.
