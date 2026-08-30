# PharmacyOS Completion Plan

**Plan date:** 20 August 2026  
**Scope:** Complete the current Phase 1 transactional dependencies, finish Phase 2 operational workflows, prove correctness, and prepare a controlled pharmacy pilot.  
**Current release decision:** **Not pilot-ready**  
**Source of truth:** Current repository, migrations 001–005, ADRs, and `PharmacyOS_Phase_2_Test_and_Feature_Audit.docx`.

## 1. Status definitions

| Status                    | Meaning                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Done**                  | Code exists, is integrated, and passed the lightweight static/build gate. Production behavior may still require broader release testing. |
| **Partial**               | A usable foundation or backend exists, but an essential workflow, UI, external adapter, or release proof is missing.                     |
| **Not started**           | No operational implementation exists beyond possible schema placeholders.                                                                |
| **Release proof pending** | Code is present, but representative integration, concurrency, security, performance, or recovery evidence is absent.                     |

## 2. Executive status

| Area                           | Current status                     | Completion requirement                                                                                                               |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Engineering foundation         | **Done**                           | Keep all quality gates passing while completing vertical workflows.                                                                  |
| Authentication and RBAC        | **Done / proof pending**           | Run endpoint-by-endpoint allowed/denied regression for all roles.                                                                    |
| POS transaction core           | **Implemented / proof pending**    | Cash checkout and printable token-only QR receipt are wired; run database-backed regression/concurrency tests.                       |
| Inventory and batch foundation | **Implemented / UI proof pending** | Transactional partial/full goods receipt, acquisition lots, and stock movements are coded; finish operator UI and integration proof. |
| Returns                        | **Implemented / proof pending**    | Printable QR, item selection, disposition, request, approval, and cash refund UI exist; add non-cash UI and concurrency proof.       |
| Cash reconciliation            | **Implemented / proof pending**    | Open, movement, expected cash, count/close, independent variance approval, audit, and UI are coded.                                  |
| Procurement                    | **Partial**                        | Implement receiving, supplier comparison/quote screens, draft editing, approval, and order lifecycle.                                |
| Shelf intelligence             | **Done / proof pending**           | Test scoring, safety eligibility, stale recommendations, and concurrent reviews.                                                     |
| Expiry-loss prevention         | **Partial**                        | Add action/assignment UI and verify timezone/job behavior.                                                                           |
| Reorder forecasting v2         | **Done / proof pending**           | Add draft-PO completion UI and test all forecast/duplicate cases.                                                                    |
| Budget regimen calculator      | **Partial**                        | Finish pharmacist verification and checkout price-change acknowledgement.                                                            |
| Owner AI assistant             | **Done / provider proof pending**  | Configure sandbox provider and test authorization, failures, data leakage, and number reconciliation.                                |
| FBR integration                | **Partial**                        | Implement and certify the selected production adapter, including return/credit-note flow.                                            |
| Backups and recovery           | **Not started operationally**      | Implement encrypted automated backups and produce restore-drill evidence.                                                            |
| Observability and support      | **Partial**                        | Add metrics/export, alerts, correlation IDs, support views, and log-redaction proof.                                                 |
| Release test evidence          | **Partial**                        | Complete P0/P1/P2 verification and resolve every release blocker.                                                                    |

## 3. Work already completed

### 3.1 Repository and runtime foundation

- npm workspace monorepo for API, worker, web, configuration, database, and shared domain code.
- Strict TypeScript compilation across all workspaces.
- ESLint configured with zero-warning enforcement.
- Prettier formatting gate.
- Production builds for NestJS API, durable worker, and React/Vite web application.
- Docker images and Compose topology for PostgreSQL, Redis, API, worker, web, and Caddy.
- Checksum-protected ordered database migration runner.
- Disposable PostgreSQL 18 migration smoke script.
- Environment validation through a shared Zod configuration package.
- Architecture decision records and implementation documentation.

### 3.2 Security and identity foundation

- Password-based login with Argon2 hashing.
- Hashed session tokens, expiry, revocation, branch scope, and terminal scope.
- Backend-authoritative permission guards.
- Branch-role-permission data model.
- Seeded operational roles and Phase 1/Phase 2 permissions.
- Append-only audit-event foundation.
- Explicit separation between system administration and business approval permissions.

### 3.3 Catalog, inventory, and POS core

- Medicine, generic, manufacturer, category, alias, barcode, supplier, shelf, and batch schema.
- Indexed medicine and barcode search.
- Shelf/location lookup in catalog results.
- Current sellable quantity, nearest expiry, and FEFO price lookup.
- Draft sale creation using exact decimal strings.
- Atomic FEFO batch reservation.
- Reservation expiry and release workflow.
- Multi-payment sale finalization.
- Invoice sequencing.
- Idempotent sale finalization using client request IDs.
- Batch quantity updates and append-only stock movements.
- FBR invoice/outbox boundary.
- Counter-focused React POS shell.

### 3.4 Phase 2 database and policy foundation

- Storage-class and secured-storage constraints for medicines and shelves.
- Shelf pick priorities and primary/reserve location metadata.
- Branch operational-intelligence policy table.
- Shelf recommendation lifecycle and audit fields.
- Expiry work-item lifecycle and acquisition-cost value snapshots.
- Supplier quote and cost-normalization fields.
- Extended reorder policy and suggestion reasoning fields.
- Daily inventory availability snapshots.
- Opaque receipt return tokens.
- Database-enforced cumulative return quantity limit.
- Budget-regimen audit metadata.
- AI assistant audit metadata.
- Scheduled-job run history.
- Query-path indexes and partial unique indexes for active work queues.

### 3.5 Shelf optimization

- Deterministic demand scoring from finalized sale lines.
- Configurable lookback, minimum history, and required rank improvement.
- ABC/low-confidence classification.
- Storage/security eligibility filters.
- Saved scoring and reason snapshots.
- Weekly idempotent worker generation.
- Superseding of stale pending recommendations.
- RBAC-protected list, apply, and dismiss APIs.
- Revalidation of target shelf at approval time.
- Audited location application.
- Inventory review UI for pending recommendations.

### 3.6 Expiry-loss prevention

- Configurable expiry thresholds.
- Timezone-aware derived expiry query.
- Expired, 0–30, 31–60, and 61–90-day buckets.
- Value at risk using batch acquisition cost.
- Durable, idempotent expiry work items.
- Reviewed, supplier-return candidate, quarantined, and resolved actions.
- Daily worker refresh and automatic resolution of obsolete work items.
- Expiry attention counts and list UI.

### 3.7 Supplier intelligence and reorder v2

- Historical paid-cost derivation from purchase order items.
- Discount, bonus-unit, and base-unit normalization.
- Current supplier quote API with validity and source metadata.
- Product-level supplier comparison API.
- Daily sales-velocity refresh.
- Stockout-day-aware forecast confidence.
- Observed supplier lead time with configured fallback.
- Safety stock, target coverage, MOQ, and order-multiple calculation.
- Saved deterministic reasoning inputs.
- Expiry-risk flag.
- Daily idempotent suggestion generation.
- Review and dismiss workflow.
- Duplicate-safe conversion to draft purchase order.
- Reorder attention/review UI.

### 3.8 Budget-based regimen calculator

- Integer/scaled-decimal algorithm with no floating-point money calculation.
- Maximum complete-day search.
- Minimum sale-increment and pack rounding.
- Multiple-medicine support.
- Below-one-day handling.
- Current FEFO price snapshots and price-version metadata.
- Optional verification/audit persistence.
- POS-cart-based calculation UI.
- Explicit non-clinical safety language.

### 3.9 QR-assisted return backend

- Opaque random UUID generated during sale finalization.
- Token contains no invoice, customer, medicine, payment, or health data.
- Authenticated and permission-protected lookup.
- Original finalized invoice and remaining eligible quantity response.
- Idempotent linked return request.
- Authorized approval.
- One-refund-per-return database invariant.
- Return restock, quarantine, and scrap disposition handling.
- Stock movement and audit evidence.
- Sale status update to partially returned or returned.
- FBR return outbox linkage.
- Fast lookup UI.

### 3.10 Owner AI assistant

- Provider-independent interface.
- Gemini REST provider behind environment configuration.
- No model identifier in business logic.
- Nine whitelisted read-only tools.
- No arbitrary SQL or write-capable AI tools.
- Tool input validation and runtime permission re-check.
- Aggregate/sanitized operational facts.
- Server-only key handling.
- Database-backed per-user rate limiting.
- Request timeout and fail-closed provider handling.
- Durable question-hash/tool/provider/status/latency audit.
- Deterministic facts visually separated from generated explanation.
- Suggested operational questions.
- Graceful AI-disabled state.

### 3.11 Completed lightweight verification

- `npm run format:check` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed across all workspaces.
- `npm run build` — passed.
- Migrations 001–003 — applied successfully to disposable PostgreSQL 18.
- Resulting disposable schema — 52 public tables.
- Phase 2 audit DOCX — visually reviewed across all pages.

## 4. Remaining work by dependency order

The sequence below is mandatory. Later phases depend on earlier transactional workflows and should not be used to hide missing foundations.

## Phase A — Controlled local runtime and repeatable test data

**Execution status (2026-08-20): Implemented.** A production-guarded, repeatable fixture command now creates 500 medicines, shelves, suppliers, role-specific users, inventory, demand history, and 90 finalized sales. A disposable Docker smoke script proves migrations plus fixtures from an empty PostgreSQL database.

**Priority:** P0  
**Effort:** Medium  
**Depends on:** Current repository only

### Objectives

- Establish a repeatable local environment for database-backed development.
- Remove manual data setup from later integration testing.

### Tasks

- Create development-only fixture/seed data for:
  - Two branches and multiple terminal types.
  - Every seeded role.
  - At least 500 medicines.
  - Ambient, cold, secured, inactive, and new products.
  - Multiple suppliers per medicine.
  - Batches across all expiry buckets.
  - Ninety days of sales and stockout intervals.
  - Purchase orders, partial receipts, discounts, and bonus units.
  - Partial/full return history.
- Add safe reset-and-seed documentation for non-production databases.
- Add Docker Compose profiles or commands for development and test environments.
- Add API startup readiness check after migration and seed.
- Confirm Redis and worker startup/recovery.
- Remove fake hard-coded counter indicators from production UI paths.

### Acceptance criteria

- One documented command starts the local stack.
- One documented command creates representative non-production data.
- API readiness succeeds only when required core dependencies are available.
- Worker claims and completes at least one disposable operational job.
- No production credential is embedded in fixtures or Compose files.

## Phase B — Cash-session and reconciliation completion

**Execution status (2026-08-20): Implemented; integration/concurrency proof remains.** Idempotent open/movement/close/approval commands, exact database reconciliation, variance threshold policy, separation of duties, audit events, cashier UI, and supervisor queue are present. Counter checkout now requires and uses the authenticated open session.

**Priority:** P0  
**Effort:** Large  
**Depends on:** Phase A

### Objectives

- Complete the transaction dependency required by cashier checkout and cash refunds.

### Backend tasks

- Implement open-session endpoint:
  - Enforce terminal, branch, cashier, and permission scope.
  - Enforce one active session per cashier/terminal.
  - Capture exact opening float.
- Implement current-session/read endpoint.
- Implement cash-in and cash-out movement endpoints.
- Implement calculated expected-cash endpoint from authoritative payments, refunds, and movements.
- Implement closing/count submission endpoint.
- Implement variance calculation with exact money arithmetic.
- Implement configurable variance threshold.
- Implement manager variance approval endpoint.
- Add idempotency keys for open/close/approval transitions.
- Add stable errors for no active session, duplicate session, stale count, and unauthorized approval.
- Audit every transition and movement.

### Frontend tasks

- Cashier session-open screen before cash checkout.
- Active-session indicator.
- Cash-in/out dialog with mandatory reason.
- Close/count screen.
- Expected versus counted reconciliation screen.
- Manager variance approval queue.
- Clear offline/database-unavailable behavior.

### Acceptance criteria

- Cash checkout cannot use a missing, closed, wrong-terminal, or wrong-cashier session.
- Cash refund updates expected cash exactly once.
- Duplicate requests return the original result.
- Variance cannot be approved by system administrator unless separately granted business authority.
- Opening float, payments, refunds, movements, count, and variance reconcile exactly.

## Phase C — Goods receipt and procurement transaction completion

**Execution status (2026-08-20): Backend implemented; operator UI and integration proof remain.** Direct purchase-order creation, ordering, detail/list queries, duplicate-safe partial/full receipt, bonus/base-unit conversion, acquisition-lot batches, and append-only receipt/stock ledgers are coded.

**Priority:** P0  
**Effort:** Large  
**Depends on:** Phase A; recommended after Phase B

### Objectives

- Make purchase history authoritative through an operational receiving workflow.
- Provide trustworthy source data for supplier intelligence and reorder forecasting.

### Backend tasks

- Implement supplier CRUD with soft deactivation.
- Implement purchase-order draft editing.
- Implement authorized approval and ordered transition.
- Implement partial and full goods receipt.
- Capture supplier invoice number, batch number, expiry, quantity, unit cost, discount, bonus units, and unit conversion.
- Create or update inventory batches transactionally.
- Append purchase receipt stock movements.
- Reconcile purchase-order totals using exact numeric arithmetic.
- Prevent received quantity from exceeding ordered quantity without an explicit authorized exception workflow.
- Derive observed lead time only from valid order/receipt timestamps.
- Trigger supplier metric and reorder refresh after receipt.
- Add duplicate-safe receipt client request IDs.
- Add cancellation rules that never remove received history.

### Frontend tasks

- Supplier list/detail and deactivation.
- Draft purchase order editor.
- Approval/order action screen.
- Goods receipt entry with batch and expiry validation.
- Partial-receipt progress.
- Discount/bonus/unit-conversion entry.
- Receipt reconciliation and exception handling.

### Acceptance criteria

- Every accepted unit creates matching batch stock and stock-ledger evidence.
- Supplier effective cost reconciles to the receipt.
- Repeated receipt requests do not duplicate stock.
- Invalid expiry/batch/unit conversion is rejected before mutation.
- Partially and fully received states are derived correctly.

## Phase D — Complete Phase 2 operational user interfaces

**Priority:** P0/P1  
**Effort:** Large  
**Depends on:** Phases B and C for complete workflows

### D1. Expiry work queue

- Add bucket/status/assignee filters and pagination.
- Add reviewed, supplier-return candidate, quarantine, resolve, and assignment controls.
- Add batch/product detail link.
- Show acquisition-cost basis explicitly.
- Add stale-action error handling and refresh.
- Add keyboard navigation and batch-action limits.

### D2. Supplier price intelligence

- Add product supplier comparison screen.
- Separate paid historical cost from current quote visually.
- Show unit basis, validity, source, lead time, previous cost, and last purchase date.
- Add quote-entry/edit-expire workflow.
- Do not label the cheapest supplier as the best supplier.

### D3. Reorder-to-draft workflow

- Add complete suggestion detail with every saved input.
- Add supplier comparison within the reorder workflow.
- Allow authorized quantity/supplier adjustment.
- Add create-draft-PO action with idempotency key.
- Open the resulting draft for editing.
- Prevent silent overwrite of a human-edited draft.

### D4. Return workflow

- Add QR/camera/scanner input integration.
- Add selectable eligible sale items.
- Add quantity, reason, and disposition entry.
- Add approval queue and exception state.
- Add cash/card/bank refund processing.
- Add final return/refund receipt.
- Disable fully returned lines.
- Display previous partial returns.
- Make retries and duplicate scans visibly harmless.

### D5. Budget calculator completion

- Add explicit pharmacist verification action and identity.
- Show the regimen exactly as entered.
- Add configurable minimum sale increments from authoritative product/unit data.
- Save an audit only when policy requires it.
- Pass calculation/price versions into checkout.
- Recalculate when price changes and require acknowledgement.
- Never reserve inventory during calculation.

### D6. Owner assistant refinement

- Hide the route for users without `ai.owner.use`, while retaining backend enforcement.
- Add date-range controls for supported tools.
- Add medicine selector for supplier comparison questions.
- Link each result to its underlying deterministic report.
- Add explicit disabled, timeout, provider-error, malformed-response, and rate-limit states.
- Render model text as plain text only.

### Acceptance criteria

- Every implemented Phase 2 API has a complete authorized operator workflow or is explicitly documented as API-only.
- Every screen handles loading, empty, denied, stale, unavailable, error, and successful states.
- All critical workflows remain keyboard-operable.
- No frontend action bypasses backend validation or permissions.

## Phase E — Receipt rendering and QR completion

**Execution status (2026-08-20): Browser rendering implemented; hardware validation remains.** The counter renders an 80 mm print layout and QR with medium error correction from the opaque return token only. Reprint data is read from the finalized sale; printer/scanner matrix testing is still required.

**Priority:** P0  
**Effort:** Medium  
**Depends on:** POS core and Phase D4

### Tasks

- Select and pin a maintained QR-generation library.
- Generate the QR from the opaque return lookup URL/token only.
- Add receipt template for supported printer widths.
- Include invoice number, date, totals, fiscal status, and return QR without customer health data.
- Implement browser/print rendering and optional server PDF/receipt output if operationally required.
- Validate QR error correction and minimum physical size.
- Add reprint authorization and audit behavior.
- Confirm receipt reprint preserves the same active token.
- Define revocation/reissue policy.

### Acceptance criteria

- Decoded QR contains no customer, medicine, payment, invoice-total, or prescription information.
- Scanning resolves only after employee authentication and permission enforcement.
- Printed QR works on supported hardware and degraded print samples.
- Repeated scans do not create a return or refund automatically.

## Phase F — FBR production integration

**Priority:** P0 before production  
**Effort:** Large/external  
**Depends on:** Stable POS and return workflows

### Tasks

- Select one production integration mode.
- Implement adapter interface for validation, submission, retry classification, and reconciliation.
- Map PharmacyOS invoice data to the selected FBR contract.
- Validate payload before external submission.
- Add secure credential/configuration storage.
- Implement response schema validation.
- Implement retryable versus permanent failure handling.
- Implement fiscal number and QR persistence.
- Implement return/debit-note/credit-note path for accepted returns.
- Add reconciliation screen and manual retry with permission/audit.
- Prevent secrets or raw sensitive payloads from logs.
- Complete sandbox/certification process.

### Acceptance criteria

- A finalized sale reaches the correct fiscal status without blocking local sale completion on transient internet failure.
- Duplicate outbox delivery cannot produce duplicate fiscal invoices.
- Permanent failures enter a human review queue.
- Accepted returns follow the certified fiscal correction path.
- Sandbox and certification evidence is archived.

## Phase G — Owner AI provider validation

**Priority:** P1  
**Effort:** Medium  
**Depends on:** Deterministic reports and representative test data

### Tasks

- Configure a supported Gemini model through environment settings.
- Use a sandbox/test key with least possible exposure.
- Add provider-independent mocked tests.
- Test disabled/no-key behavior.
- Test timeout, 429, 5xx, malformed JSON, missing candidates, and empty text.
- Test every tool's authorization independently from the chat endpoint.
- Verify medicine-specific tools require valid medicine ID.
- Verify date limits and maximum row counts.
- Inject contradictory generated numbers and confirm deterministic facts remain authoritative.
- Review every provider-bound payload for customer/prescription/health information.
- Confirm prompts, keys, and private facts are absent from application logs and audit records.
- Add cost/token/latency monitoring where available.

### Acceptance criteria

- AI can be disabled without affecting health, POS, inventory, returns, or reports.
- Provider failure never creates a business number or action.
- No tool can write to the database.
- No unapproved data category is sent to the provider.
- UI clearly distinguishes tool facts from generated explanation.

## Phase H — Backup, restore, retention, and disaster recovery

**Priority:** P0 before pilot  
**Effort:** Large/deployment-specific  
**Depends on:** Stable schema and deployment topology

### Tasks

- Select encrypted backup destination appropriate to deployment.
- Implement scheduled PostgreSQL logical backup.
- Protect backup credentials and encryption keys.
- Define retention policy at or above regulated requirements.
- Record backup status, size, checksum, destination class, and errors.
- Alert on failed or overdue backup.
- Implement safe restore procedure to a separate clean database.
- Restore all Phase 1 and Phase 2 durable tables.
- Compare critical row counts and checksums.
- Start API/worker/web against restored data.
- Document recovery point and recovery time objectives.
- Document hardware loss, database corruption, and accidental deletion procedures.
- Ensure AI audit cleanup cannot delete regulated transactional data.

### Acceptance criteria

- Encrypted backup completes automatically.
- Failed backup produces an actionable alert.
- A clean-host restore succeeds from documented instructions.
- Restored sales, payments, stock movements, purchases, returns, fiscal records, recommendations, and audit evidence reconcile.
- Restore evidence is dated and retained.

## Phase I — Observability, security hardening, and operations

**Priority:** P0/P1  
**Effort:** Medium/Large  
**Depends on:** Stable workflows

### Observability tasks

- Add request correlation IDs.
- Propagate job and external-call correlation IDs.
- Add structured metrics for:
  - API/database health.
  - Worker heartbeat and queue depth.
  - Job success/failure/duration.
  - Shelf recommendation generation/application rates.
  - Expiry work-item counts.
  - Reorder suggestion/draft conversion rates.
  - QR lookup failures.
  - Return approval/refund failures.
  - FBR latency/failures.
  - AI provider latency/failures/rate limits.
- Add a support-status view for authorized administrators.
- Define alert thresholds and escalation steps.

### Security tasks

- Review authentication/session expiration and revocation.
- Add login and sensitive-endpoint rate limits.
- Review CORS, proxy trust, security headers, and request size/timeouts.
- Verify no stack traces reach clients.
- Review SQL interpolation and every dynamic filter.
- Review permission coverage for every controller method.
- Review audit completeness for approvals and high-risk actions.
- Review dependency vulnerability reports.
- Search logs/build artifacts for credentials, tokens, PII, payment data, and provider prompts.
- Document secret rotation for database, session, FBR, backup, and AI credentials.

### Acceptance criteria

- Operators can diagnose failed jobs/external calls without accessing secrets.
- Critical failures generate alerts.
- Every new endpoint has an explicit permission and validation contract.
- No critical/high unresolved security issue remains before pilot.

## Phase J — Automated correctness and regression suite

**Priority:** P0  
**Effort:** Large  
**Depends on:** Phases A–I as relevant

### J1. Unit tests

- Decimal and money arithmetic boundaries.
- Complete-regimen calculation:
  - Zero/below-one-day budget.
  - Exact budget.
  - Pack/minimum-increment rounding.
  - Fractional base units.
  - Multiple medicines.
  - Maximum horizon.
- Supplier effective-unit cost:
  - Discounts.
  - Bonus units.
  - Different compatible unit conversions.
  - Zero/invalid denominator rejection.
- Reorder calculation:
  - No history.
  - Stockout suppression/confidence.
  - Observed/fallback lead time.
  - Safety stock.
  - Target coverage.
  - MOQ.
  - Order multiple.
  - Near-expiry risk.
- Shelf scoring and storage/security eligibility.
- Expiry bucket boundaries.
- AI provider schema/failure mapping.

### J2. Database tests

- Empty reset and forward migration.
- Migration checksum enforcement.
- PK/FK/delete behavior.
- Partial unique indexes for active recommendations/suggestions.
- Append-only audit/stock movement enforcement.
- Cumulative return limit trigger.
- One refund per return.
- One active cash session.
- Idempotency unique constraints.
- Expired/quarantined stock cannot enter sellable allocation.
- Regulated records cannot be hard-deleted through application flows.

### J3. API integration tests

- Every endpoint against PostgreSQL.
- Allowed and denied roles.
- Invalid/unknown fields and stable errors.
- Transaction rollback after intermediate failure.
- Idempotent replay.
- Stale version/state conflicts.
- Pagination and bounded limits.
- Branch isolation.

### J4. Concurrency tests

- Two cashiers finalize the same client request.
- Concurrent FEFO reservations for limited stock.
- Two reviewers apply/dismiss the same shelf recommendation.
- Duplicate daily/weekly jobs.
- Concurrent reorder-to-draft conversion.
- Concurrent partial returns consuming the final eligible quantity.
- Repeated return refund.
- Two workers claiming the same outbox workload.

### J5. End-to-end tests

- Login → open cash session → search → reserve → finalize → print receipt.
- Morning inventory review.
- Expiry quarantine/action journey.
- Reorder → supplier comparison → draft PO → approval → receipt.
- Budget calculation → pharmacist verification → price change → checkout acknowledgement.
- QR scan → partial return → approval → refund → corrected receipt/FBR boundary.
- Owner question with deterministic facts and provider explanation.
- WAN loss while local transactional operations continue.

### Acceptance criteria

- All P0 tests pass repeatedly on a clean database.
- No flaky concurrency test is accepted without root-cause resolution.
- No test mutates production data or depends on production credentials.
- POS, inventory, returns, procurement, cash, FBR boundary, and AI-disabled regression all pass.

## Phase K — Performance and low-cost hardware validation

**Priority:** P1 before pilot  
**Effort:** Medium  
**Depends on:** Representative fixtures and stable queries

### Workloads to benchmark

- Medicine/barcode search.
- Draft creation and FEFO reservation.
- Sale finalization.
- Return lookup.
- Expiry queue.
- Reorder queue and generation.
- Shelf recommendation generation.
- Supplier history/comparison.
- Owner deterministic tools.
- Worker catch-up after downtime.
- Backup duration and database impact.

### Tasks

- Define representative data volume and hardware profile.
- Capture `EXPLAIN (ANALYZE, BUFFERS)` for critical queries.
- Verify index use and bounded row counts.
- Set API and job latency budgets.
- Limit background concurrency so POS remains responsive.
- Test worker/database contention during opening hours.
- Test database connection-pool exhaustion behavior.
- Measure memory, CPU, I/O, queue depth, and recovery time.

### Acceptance criteria

- Critical counter operations meet the agreed local latency budget under background workload.
- No unbounded scan appears on critical work queues at representative volume.
- Background jobs recover without starving POS/API resources.
- Performance changes do not weaken authorization or data constraints.

## Phase L — Pilot release gate

**Priority:** Final  
**Depends on:** All release-blocking phases

### Required artifacts

- Final architecture and data-model documentation.
- Endpoint and permission matrix.
- Operations/runbook documentation.
- Backup and restore evidence.
- FBR sandbox/certification evidence where applicable.
- Test command outputs and reports.
- Performance baseline report.
- Security and privacy review.
- Known-risk register.
- Rollback/forward-fix plan.
- Pilot deployment checklist.
- User training notes for cashier, inventory manager, manager, owner, and administrator.

### Release-blocking conditions

- Authorization bypass.
- Cross-branch data exposure.
- Duplicate sale, order, receipt, return, or refund.
- Inventory corruption or negative stock.
- Unsafe shelf/storage recommendation application.
- Money/rounding/reconciliation error.
- Expired stock becoming sellable.
- AI/provider secret or customer/health data leakage.
- Unrecoverable database/backup failure.
- Missing real FBR behavior where legally required for the target deployment.
- Unresolved critical/high security issue.

### Pilot acceptance criteria

- All P0 tests pass.
- Critical P1 workflows pass.
- Backup/restore is proven.
- Performance is acceptable on target hardware.
- Operational monitoring and support ownership are assigned.
- Remaining risks are non-critical, documented, and explicitly accepted.

## 5. Recommended execution batches

| Batch | Scope                                            | Why this order                                                                 | Exit condition                                                                   |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **1** | Phase A runtime/fixtures + Phase B cash sessions | Cash is a dependency for normal checkout and refunds.                          | Real cashier can open, transact, close, count, and reconcile.                    |
| **2** | Phase C goods receipt/procurement                | Creates authoritative supplier cost and stock receipt data.                    | PO can move safely from draft through receipt with exact stock/cost records.     |
| **3** | Phase D operational UI + Phase E QR receipt      | Completes staff-facing Phase 2 workflows.                                      | Inventory, procurement, regimen, and return journeys are operational end to end. |
| **4** | Phase F FBR + Phase G AI validation              | External integrations should be added after deterministic workflows stabilize. | FBR sandbox/certification and AI failure/security tests pass.                    |
| **5** | Phase H backups + Phase I observability/security | Production safeguards must exist before release testing.                       | Restore proof, alerts, support visibility, and security review exist.            |
| **6** | Phase J tests + Phase K performance              | Proves correctness and suitability on target hardware.                         | P0/P1 suites and performance budgets pass.                                       |
| **7** | Phase L pilot gate                               | Final evidence-based release decision.                                         | Every blocker is closed or release is stopped.                                   |

## 6. Definition of done for every implementation task

- Scope and dependencies are explicit before coding.
- Existing modules and naming are reused.
- Database changes are additive migrations with documented constraints/index rationale.
- Money uses exact decimal/integer arithmetic.
- Quantities use the existing base-unit strategy.
- Multi-record transitions are transactional.
- Retryable durable actions are idempotent.
- Backend permission is explicit.
- Input is validated and unknown/invalid transitions are rejected.
- Stable client-safe errors are returned.
- Audit evidence is created for approvals and sensitive actions.
- No regulated history is silently rewritten or hard-deleted.
- Required unit/database/integration/concurrency tests are added.
- Format, lint, typecheck, relevant tests, build, and migration checks pass.
- UI includes loading, empty, denied, error, stale, retry, and success states.
- Documentation and the completion plan are updated.
- Actual commands and results are recorded; planned tests are never reported as passed.

## 7. Immediate next task

**Start with Phase A and Phase B together:** create representative development fixtures, then implement the complete cash-session and reconciliation vertical slice.

This is the highest-value next step because:

- Checkout already requires an open cash session.
- Cash refunds depend on a valid cash session.
- Cash reconciliation is an assumed Phase 1 dependency that is currently missing operational APIs/UI.
- It unlocks reliable database-backed POS and return integration testing.
- It closes a release-critical transactional gap before additional analytics or UI polish.
