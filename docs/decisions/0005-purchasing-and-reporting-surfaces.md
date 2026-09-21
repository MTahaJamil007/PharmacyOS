# ADR 0005 — Purchasing and Deterministic Reporting Surfaces

- **Status:** accepted
- **Date:** 2026-09-21
- **Scope:** web client coverage of the procurement lifecycle and the deterministic report endpoints
- **Basis:** `docs/SYSTEM_AUDIT_2026-09-21.md`

## Context

`inventory_batches` is inserted from exactly three code paths: `procurement.receivePurchaseOrder`, which creates new acquisition batches, and the returns and expiry services, which split batches that already exist. Goods receipt is therefore the only way stock enters the system.

The web client called two of the ten procurement endpoints — reorder suggestion listing and review. A pharmacy running the shipped application could sell, count, scrap, reprice, and report on stock, but could not buy any. Opening stock could only be created by a seed script or by calling the API directly.

Separately, Phase 4 correctly extracted the nine deterministic report endpoints out from behind the owner AI endpoint, restoring the architecture's rule that reporting must not depend on AI. The owner-facing surface stopped at the dashboard snapshot, so those endpoints remained reachable only by an HTTP client.

Primary navigation was filtered only for `/admin`, so every other operator saw destinations their role could not use.

## Decision

1. **Purchasing is a first-class workspace**, covering supplier selection, purchase-order construction, order approval, multi-line goods receipt, receipt history, and supplier quote capture. It is guarded by `inventory.purchase`, with the order-approval action additionally guarded by `procurement.purchase_draft.approve`.

2. **Client-side purchase arithmetic reuses `@pharmacy/shared` exact helpers and mirrors the server's own rule** — line gross is quantity times unit cost, the discount is subtracted in minor units, and a discount may never exceed gross. The screen cannot display a total the server would reject, and no money value touches floating point. This is the same discipline applied to the POS cart in Phase 2.

3. **Write paths hold one `clientRequestId` in component state across retries** for purchase-order creation, order approval, and goods receipt. Regenerating the identifier on retry defeats the server's replay detection; this is the defect pattern recorded as C20 for checkout and it is not reintroduced here.

4. **A goods-receipt line is submitted only when it carries a batch number, an expiry date, a sale price, and a positive quantity.** Incomplete rows are dropped rather than sent and rejected, so a partial receipt is a normal operation rather than an error.

5. **Deterministic reports get their own workspace**, rendering both payload shapes the endpoints return — a single aggregate fact object and a list of rows — through one generic table. Every report displays the `dataBasis` string the server computed alongside the figures, so a number is never shown without its definition. CSV export is generated in the browser and never leaves the LAN.

6. **`shelf-recommendations` and `supplier-prices` are deliberately excluded** from the reports workspace. Shelf recommendations already have a dedicated review surface in the inventory module, and supplier price comparison requires a specific medicine and belongs on the purchasing screen.

7. **Primary navigation is permission-aware.** A destination appears only when the session carries at least one permission it needs. In preview mode, where there is no session, every destination is shown.

8. **No API, migration, worker, or infrastructure file was changed.** Every server-side capability these screens use already existed and was already tested.

## Consequences

- A pharmacy can now complete the full stock lifecycle — order, receive into a batch, sell, return, count, reprice, scrap — without a database client.
- The owner can read and export every deterministic report with `AI_ENABLED=false`, which is what architecture §12 required.
- The `INVENTORY_MANAGER` role holds `inventory.purchase` but not `procurement.purchase_draft.approve`, so it can draft and receive but not order. The screen states this on the order rather than failing with a 403. Whether that split is intended segregation of duties or an oversight in the seed is recorded as open in the audit.
- Procurement endpoints return snake_case `Record<string, unknown>` rather than the camelCase typed contracts used elsewhere. The new shared interfaces describe the actual shapes; aliasing the columns to match the rest of the API is deferred to Phase 8.
- `createPurchaseOrder` returns no `receipts` key while `getPurchaseOrder` does. The client types distinguish them so the difference cannot be assumed away.
- Two new lazy routes add to the bundle; both are code-split away from the counter route.
