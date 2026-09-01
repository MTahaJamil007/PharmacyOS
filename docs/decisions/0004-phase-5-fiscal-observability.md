# ADR 0004 — Fiscal Adapter, Tax-Inclusive Pricing, and Observability

- **Status:** accepted; external transmission activation pending approval and licensed-integrator validation
- **Date:** 2026-09-01
- **Scope:** FBR boundary, tax snapshots, operational telemetry, and performance

## Context

PharmacyOS must preserve LAN sales when the internet or fiscal endpoint is unavailable. Before Phase 5, sandbox mode fabricated a fiscal number, tax totals were zero, attempts were not persisted, production logs were effectively absent, and catalog search missed its representative-volume target. FBR integration also carries seller and invoice/buyer data outside the shop, so enabling the outbound path requires an explicit operator decision and licensed-integrator review.

## Decision

1. Retail prices are tax-inclusive. `sales.tax_total` and `sale_items.tax_amount` are exact audited components of the amount paid; they are not added to the counter price a second time. Database constraints enforce total, line, and tax bounds.
2. Every sale snapshots seller identity, HS code, tax rate, unit of measure, sale type, and exact fiscal line values. Later catalog/configuration edits cannot rewrite a finalized fiscal snapshot.
3. `FiscalInvoiceGateway` owns exactly `validateInvoice`, `submitInvoice`, and `getReferenceData`. The HTTP adapter uses bearer authentication, bounded timeouts, official DI paths, decimal-string serialization without JavaScript floating point, and redacted secrets.
4. Local sale finalization writes the sale, tax, stock, payment, fiscal snapshot, and outbox job atomically. It never waits for the internet.
5. A transport failure after submission begins is ambiguous. It is not automatically retried because a blind retry can create a duplicate fiscal invoice. The record moves to `FAILED_NEEDS_REVIEW` for licensed-integrator reconciliation.
6. Sandbox success is never simulated. Until the operator explicitly approves outbound fiscal payload transmission, enabled fiscal jobs persist a permanent blocked attempt and `FAILED_NEEDS_REVIEW`; they never create an invoice number or submission timestamp.
7. Production logging is structured and redacts authorization, cookie, and password fields. Safe correlation IDs flow through response headers, exception logs, metrics, and fiscal attempts.
8. `/api/v1/metrics` contains bounded-label request metrics and aggregate alert gauges only. It exposes no credentials, invoice payloads, user identities, or customer data.
9. Operational alerts are durable branch-scoped records raised by database state transitions for failed jobs, fiscal failures, cash variance, and backup/restore failure. Acknowledgment is audited; resolution retains the acknowledgement history.
10. Authentication reads a permission snapshot from the session row. Role/permission changes revoke affected sessions in the database, preventing stale authorization while removing a five-table join from every request.
11. Search uses exact barcode/name short-circuiting and bounded GiST trigram candidates. Representative performance remains an executable gate, not a design claim.

## External activation conditions

- Written approval to transmit the configured seller identity and invoice/buyer fields.
- A licensed integrator confirms the endpoint, payload mapping, reference-data versions, credit-note workflow, retry/reconciliation rules, and credential custody.
- A Pakistani tax professional confirms whether a receipt may print before fiscalization for the pharmacy's registration/tier and approves the displayed QR/invoice layout.
- Real sandbox credentials and a scenario produce persisted validate/submit responses and an official invoice number.

## Consequences

- Internet failure cannot block checkout, but a receipt may show fiscal pending/review state until the external policy is approved.
- Tax catalog setup becomes an operational responsibility; an incorrect HS code or rate is preserved accurately rather than silently corrected later.
- Session revocation is immediate on authorization changes; users must sign in again.
- GiST indexes add modest catalog write/storage cost to keep counter reads within target.
- External fiscal, physical hardware, and two-week pilot evidence remain release gates even though the repository-controlled implementation passes its tests.
