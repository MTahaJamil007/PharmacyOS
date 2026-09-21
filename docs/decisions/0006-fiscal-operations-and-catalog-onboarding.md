# ADR 0006 — Fiscal Operations Surface, Backup Evidence, and Catalog Onboarding

- **Status:** accepted
- **Date:** 2026-09-21
- **Scope:** the operator-facing surfaces Phase 6 requires before a pilot cutover
- **Basis:** `docs/PHARMACY_OS_COMPLETION_ROADMAP.md` Phase 6, `docs/SYSTEM_AUDIT_2026-09-21.md` §4.2

## Context

ADR 0004 deliberately withheld outbound fiscal transmission: the gateway exists, every attempt is persisted, and `SANDBOX` never fabricates an invoice number. What it did not provide was any way to _read_ that state. `fbr_invoices` and `fbr_invoice_attempts` were written by the worker and readable only through `psql`. `fbr.view_status` and `fbr.retry` were seeded and enforced nowhere.

The same was true of `backup_runs` (two dashboard tiles, no history), `ai_assistant_audits` (written, never read), and `returns.refund_cash` (seeded, never checked).

Separately, Phase 6's master-data step assumed a pharmacy could load a real catalog. The only path was `POST /admin/medicines`, one medicine at a time.

## Decision

1. **A fiscal record that already carries an official invoice number can never be retried.** `POST /fiscal/invoices/:id/retry` returns `409`, and the list marks such records non-retryable. This is ADR 0004's ambiguity rule made operable: the danger is not a failed submission, it is a _duplicate_ one.

2. **Retry re-queues; it does not transmit.** The endpoint resets the existing durable outbox row (`FBR_SUBMIT`, deduplication key `sale:<id>`) to `PENDING` with attempts zeroed, and sets the invoice back to `PENDING`. The worker still owns every outbound call, so the counter stays independent of the fiscal endpoint and a retry cannot block a request thread on a remote timeout.

3. **A retry requires a written reason of at least ten characters and is audited** as `FISCAL.RETRY_REQUESTED` with the previous status. Resubmitting to a tax authority is a decision a person makes, and the record must say who decided and why. Retries are idempotent on `clientRequestId`, so a double-click or a network retry queues one job, not two.

4. **The backup surface is read-only.** A restore is destructive, needs the host filesystem and the external disk, and belongs to `docs/RUNBOOK.md`. Exposing a restore button in a browser that any `backup.restore` holder can reach would be a worse failure mode than the problem it solves. The application shows the evidence trail — last successful backup, last successful restore drill, recent runs with destination, encryption, size, duration, and checksum — and nothing more.

5. **The assistant audit exposes usage, not content.** `ai_assistant_audits` stores only a hash of the question. The surface therefore reports who used which deterministic tool, with what provider, latency, and outcome. It cannot be used to read what an owner asked.

6. **Catalog import validates before it writes, always.** `VALIDATE` never writes and returns a per-row, per-field issue list. `APPLY` re-validates and refuses to write anything at all if any row is still rejected — a partial import of a catalog is worse than none, because the operator cannot tell which half is authoritative. The whole apply runs in one transaction and is idempotent on `clientRequestId`.

7. **Import matches an existing medicine by SKU or barcode.** A file that names the same SKU or barcode on two rows is rejected on both, naming the first occurrence, rather than silently applying the last one and losing the earlier row.

8. **Parsing happens in the browser; validation happens on the server.** The client maps common heading spellings (`Brand Name`, `Salt`, `EAN`, `Rx`, `Pack`), handles RFC 4180 quoting and CRLF, reports ignored columns instead of dropping them silently, and omits blank cells so the server applies its own defaults. The server re-parses every row with the same schema the single-medicine endpoint uses; the client's mapping is a convenience, never the authority.

9. **`RequireAnyPermission` is introduced for read-only surfaces reachable by two roles.** The owner dashboard accepts `reports.view_financial` or `analytics.owner.read`. Forcing an owner to hold a manager's permission to see their own dashboard would be a worse model than a second decorator.

10. **A cash refund requires `returns.refund_cash` in addition to `returns.refund`.** Handing physical cash across the counter is a different authority from approving a card or bank reversal. Enforced in `ReturnsService.refund`, not on the route, because the same route serves all refund methods.

11. **Service-level permission enforcement stays where it is correct.** `sale.discount.override`, `sales.budget_regimen.verify`, and `customer.credit` are checked inside their services and were wrongly listed as orphaned in the audit. A route guard on the discount endpoint would break the workflow it is meant to protect, because a basic cashier must be able to call it and supply a supervisor's credentials.

## Consequences

- An operator can answer "did it go through?" and "can we get the shop back?" from the application. That was the last routine reason to open `psql`.
- The retry guard means some genuinely-lost submissions will need integrator reconciliation rather than a button. That is the intended trade: a duplicate fiscal invoice is harder to unwind than a missing one.
- Two permissions (`fbr.view_status`, `ai.audit.read`) are held by roles that previously saw no Operations tab, so those roles now have a new destination. `CASHIER` holds `fbr.view_status` by seed and will see the fiscal panel for their own branch; this is intentional — a cashier needs to know whether an invoice failed.
- The import writes to `medicines` and `medicine_barcodes` outside the single-medicine audit path. It emits one `CATALOG.IMPORTED` audit row with counts rather than one row per medicine, so per-medicine provenance for an imported row is the import event, not a creation event.
- Catalog import is capped at 2,000 rows per call. Larger catalogs are split; this keeps one transaction bounded and keeps a validation report readable.
