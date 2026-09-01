# PharmacyOS — Project Status, Testing, and Next Steps

- **Prepared:** 2026-09-01
- **Repository:** `MTahaJamil007/PharmacyOS`
- **Branch reviewed:** `development`
- **Implementation baseline:** `a3c11f2871c0b0fe7413ef1505eaf243d40c8b48`
- **Scope:** single-shop, on-premise, LAN-resilient pharmacy operations
- **Roadmap authority:** [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)
- **Purpose:** one operational handoff for what is implemented, what is proven, what remains, how to run the system, and how to decide whether it is safe to pilot

## 1. Executive status

PharmacyOS has a substantial, tested software implementation. The current automated gate passes locally and in hosted CI, representative database performance is within the roadmap targets, and the production Docker images/configuration have been validated.

PharmacyOS is **not yet approved for production pilot cutover**. The remaining blockers require physical equipment, a second LAN terminal, an external backup disk, fiscal authorization and professional review, and a 14-day parallel pharmacy pilot. Automated simulations are valuable regression evidence but do not prove that a particular scanner, printer, drawer, UPS, certificate installation, or external disk works on site.

### Current decision

| Decision area                              | Status                                     | Meaning                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Continue software development              | **Allowed**                                | The repository-controlled quality gate is green.                                                                                                 |
| Internal demonstration with synthetic data | **Allowed**                                | Keep `FBR_MODE=DISABLED`; do not use real customer identity unless privacy handling is approved.                                                 |
| On-site acceptance testing                 | **Ready when hardware/site are available** | Follow this document, [`RUNBOOK.md`](./RUNBOOK.md), and [`PILOT_RUNBOOK.md`](./PILOT_RUNBOOK.md).                                                |
| Real FBR/PRAL transmission                 | **Blocked**                                | Requires explicit data-transmission approval, a licensed integrator, approved credentials/scenarios, tax advice, and additional wiring/evidence. |
| Production pilot cutover                   | **Blocked**                                | The Phase 1/3 physical checks and full Phase 5 exit gate are incomplete.                                                                         |

## 2. Phase-by-phase status

“Software passed” and “operational exit passed” are deliberately separate. A passing repository test cannot replace an on-site observation.

| Phase | Scope                                                                                    | Software evidence                                                                                  | Operational exit status                                                   | Outstanding evidence                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Version control and honest quality gate                                                  | **Passed**; clean install/verification and later hosted CI are green                               | **Passed**                                                                | None currently known.                                                                                                                 |
| 1     | LAN deployment, TLS, Compose, backups, worker reliability                                | **Passed** in an isolated Docker stack, including encrypted backup and a four-second restore drill | **Not passed**                                                            | Trusted second LAN terminal; real sale and receipt; physical external-disk backup; restore from that physical copy.                   |
| 2     | Concurrency, ledger integrity, exact money, auth, validation, test harness               | **Passed** locally and in GitHub Actions run `33427582589`                                         | **Passed** for its defined software gate                                  | Maintain these regressions on every change.                                                                                           |
| 3     | Counter-grade POS, scanner/keyboard, payments, printing, resilience, Urdu/RTL foundation | **Passed** in software and deterministic 20-sale simulation; GitHub Actions run `33439305020`      | **Physical gate not passed**; user waiver allowed Phase 4 sequencing only | Real scanner, printer, drawer, 20-sale pharmacist test, and speed comparison.                                                         |
| 4     | Credit ledger, reports/dashboard, discounts/pricing/stock, administration                | **Passed** locally and in GitHub Actions run `33463951177`                                         | **Passed** for the software owner-day scenario                            | Phase 3 physical evidence remains carried forward; source reports must be interpreted within documented limits.                       |
| 5     | Fiscal boundary, tax, observability, performance, pilot preparation                      | **Repository work passed** locally and in GitHub Actions run `33495305485`                         | **Not passed**                                                            | Fiscal approval/integrator/tax review, real sandbox evidence, all physical checks, external-disk restore, training, and 14-day pilot. |

Detailed evidence is in [`PHASE_0_EXECUTION.md`](./PHASE_0_EXECUTION.md), [`PHASE_1_EXECUTION.md`](./PHASE_1_EXECUTION.md), [`PHASE_2_EXECUTION.md`](./PHASE_2_EXECUTION.md), [`PHASE_3_EXECUTION.md`](./PHASE_3_EXECUTION.md), [`PHASE_4_EXECUTION.md`](./PHASE_4_EXECUTION.md), and [`PHASE_5_EXECUTION.md`](./PHASE_5_EXECUTION.md).

## 3. Implemented feature inventory

### 3.1 Platform, deployment, and engineering controls

| Feature                    | Implemented behavior                                                                                                          | Verification state                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Monorepo architecture      | NestJS/Fastify API, React web client, durable worker, shared contracts/math, PostgreSQL migrations, and Docker infrastructure | Builds and strict type-checks pass.                                                      |
| Version control and CI     | `development` branch, scoped commits, pre-commit formatting/linting, and GitHub Actions quality gate                          | Hosted Phase 5 gate passed at the implementation baseline.                               |
| Dependency reproducibility | Locked npm workspaces with exact production-path dependency versions                                                          | `npm ci` passed with zero reported vulnerabilities at the last gate.                     |
| Database migrations        | Fifteen immutable, checksum-verified migrations with least-privilege application role                                         | Clean PostgreSQL 18 migration/rollback integration tests pass.                           |
| Production stack           | Caddy, web, API, worker, PostgreSQL, Redis, migration, and backup services with health and resource controls                  | Isolated Compose start and current Compose validation pass.                              |
| LAN TLS                    | Caddy internal CA, HTTP-to-HTTPS redirect, HSTS, CSP, no-sniff, and frame denial                                              | Server-side test passed; trust on a second physical terminal remains.                    |
| LAN resilience             | Local checkout does not depend on internet-based AI or fiscal services                                                        | Automated; must still be observed on the shop LAN.                                       |
| Secret handling            | Ignored `.env`, local secret rotation, separate DB roles, and external age identity                                           | Automated/configuration review passed; production custody is an operator responsibility. |

### 3.2 Identity, authorization, and administration

| Feature         | Implemented behavior                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication  | Login, logout, rate limiting, account lockout, sliding/absolute session expiry, and re-authentication on the client.                                   |
| RBAC            | Permission-protected endpoints, branch/terminal-scoped sessions, session permission snapshots, and immediate revocation after role/permission changes. |
| User management | Create/deactivate users, assign roles, change/reset passwords, revoke sessions, and protect the last active owner.                                     |
| Pharmacy setup  | Manage medicines/barcodes, suppliers, shelves and shelf assignments, terminals, operational policies, fiscal identity, and medicine tax metadata.      |
| Auditability    | Administration and sensitive workflow actions emit durable audit evidence.                                                                             |

### 3.3 Counter POS and receipts

| Feature                   | Implemented behavior                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog lookup            | Exact barcode/name short-circuits plus bounded fuzzy search, with branch inventory context.                                                 |
| Scanner/keyboard workflow | Timing-aware keyboard-wedge scanner buffer, Enter-to-add, search debounce, `*N` multiplier, Delete, and working F2/F4/F6/F8 shortcuts.      |
| Cart and reservation      | Draft creation, FEFO reservation, expiry-safe batch selection, persisted/held cart, and real reservation status.                            |
| Sale finalization         | Idempotent finalization, deterministic invoice numbering, exact totals, append-only stock/cash/fiscal evidence, and retry-safe request IDs. |
| Payments                  | Cash tender and change, card/bank payments, split tender, and customer credit where authorized.                                             |
| Discounts                 | Exact line/invoice discounts, configurable approval threshold, supervisor verification, and immutable approval record.                      |
| Receipts                  | Browser 80 mm layout, opaque return-token QR, tax/fiscal snapshots, receipt recovery after finalization, sale search, and audited reprint.  |
| Direct print boundary     | Web Serial ESC/POS data, native QR, paper cut, and drawer pulse, with browser print fallback and visible failures.                          |
| Counter resilience        | React error boundary, 401 re-authentication modal, persisted checkout attempt ID, live clock, measured API/LAN state, and lazy routes.      |
| Language foundation       | English/Urdu message catalog, persisted locale, and document `lang`/`dir` switching. Full Urdu content is not complete.                     |

### 3.4 Cash, returns, inventory, and procurement

| Domain              | Implemented behavior                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cash sessions       | Open/current/close till, cash movements, expected cash, counted cash, variance, approval, and branch/terminal ownership.                                          |
| Returns             | Opaque-token lookup, request, approval, refund, concurrency-safe quantity control, sellable restock, linked quarantine segments, and scrap-safe ledger behavior.  |
| Stock ledger        | Append-only movements, database-enforced running arithmetic/sign/branch rules, deterministic lock ordering, and rejection of unledgered quantity mutation.        |
| Expiry/shelf safety | Attention list, expiry risk, quarantine, scrap/write-off, active-reservation protection, shelf recommendations, and review workflow.                              |
| Stock operations    | Batch listing, counted adjustment, scrap, price/MRP update, and immutable price history.                                                                          |
| Procurement         | Supplier quotes, purchase-order draft/order/receipt, multi-line set-based goods receipt, supplier comparison, reorder suggestions, review, and draft-PO creation. |
| Reorder reliability | Reservation-expiry scheduler, branch/expiry-aware demand math, stale worker-lock reaper, retries, and failed-job visibility.                                      |

### 3.5 Customers, reports, and decision support

| Feature                  | Implemented behavior                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer accounts        | Branch-scoped customer records, normalized phone search, credit limits, opening balances, and soft deactivation.                                         |
| Credit ledger            | Append-only exact running balance for opening balance, credit sale, payment, and adjustment; database-enforced limits and branch ownership.              |
| Account payments         | Partial/full payment with idempotency; cash payments reconcile into the active till.                                                                     |
| Statements/receivables   | Customer statements, aged receivables, and owner receivable totals.                                                                                      |
| Deterministic reports    | Sales, gross-profit estimate, low stock, expiry risk, purchasing, supplier prices, shelf recommendations, returns, and cash reconciliation without AI.   |
| Owner dashboard          | Twelve-metric snapshot, seven-day chart, top movers, dead stock, expiry exposure, receivables, cash variance, fiscal failures, and backup/restore state. |
| Operational intelligence | Reorder/expiry/shelf decisions and a budget/regimen calculator using exact shared arithmetic.                                                            |
| Optional AI explanation  | Read-only, tool-bounded owner assistant grounded in deterministic reports; disabled by default and never required for sales/reports.                     |

### 3.6 Fiscal, observability, backup, and recovery

| Feature            | Implemented behavior                                                                                                                                                                            | Important boundary                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Tax model          | Tax-inclusive pricing, exact tax extraction, deterministic discount allocation, per-line tax/HS/UOM/sale-type snapshots, and seller fiscal identity                                             | Tax/catalog values require professional validation.                                                           |
| FBR gateway        | `validateInvoice`, `submitInvoice`, and `getReferenceData`; official path patterns, bearer auth, timeout/response bounds, exact JSON decimal serialization, and safe ambiguous-failure handling | The gateway exists but outbound worker transmission is intentionally **not wired** without explicit approval. |
| Fiscal durability  | Full local payload snapshot and append-only attempts; sandbox never fabricates an invoice number                                                                                                | Real sandbox validate/submit evidence is pending. Returns/credit-note mapping is pending integrator approval. |
| Logging/metrics    | Structured redacted production logging, correlation IDs, bounded Prometheus metrics at `/api/v1/metrics`, and no invoice/customer payloads in metrics                                           | External monitoring/retention policy must be configured at the site.                                          |
| Operational alerts | Branch-scoped alerts for failed jobs/fiscal work, threshold cash variance, and failed backup/restore; audited acknowledgment                                                                    | Acknowledgment does not resolve the underlying incident.                                                      |
| Backups            | Nightly encrypted custom `pg_dump`, SHA-256 sidecars, local/external 7 daily–4 weekly–3 monthly retention                                                                                       | Actual external SSD evidence is pending.                                                                      |
| Restore drill      | Weekly isolated restore through the application role, durable `backup_runs` record, cleanup, and a 15-minute maximum                                                                            | Passed digitally in Docker; must pass from the physical external copy.                                        |

## 4. Objective automated evidence already completed

This is the latest consolidated repository evidence. Re-run it after any code, migration, dependency, or deployment change.

| Check                      | Last result                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked install             | `npm ci` exited `0`; 709 packages added, 716 audited, 0 vulnerabilities.                                                                                |
| Full quality gate          | `npm run verify` exited `0`: format, lint, strict types, 77 unit tests, 59 PostgreSQL integration tests, 9 Playwright workflows, and all builds passed. |
| Representative performance | `npm run test:performance` exited `0` with 10,000 medicines and 200,000 historical batches.                                                             |
| Fuzzy search p95           | 82.13 ms; target `<150 ms`.                                                                                                                             |
| Exact barcode p95          | 44.69 ms; target `<80 ms`.                                                                                                                              |
| Sale finalize p95          | 155.50 ms; target `<300 ms`.                                                                                                                            |
| Dashboard p95              | 18.87 ms; target `<2,000 ms`.                                                                                                                           |
| Production configuration   | `docker compose ... config --quiet` exited `0`.                                                                                                         |
| Worker image               | Production worker Docker image built successfully with zero reported dependency vulnerabilities.                                                        |
| Hosted clean-clone gate    | GitHub Actions run `33495305485` passed on implementation commit `a3c11f2`.                                                                             |

Known non-blocking tooling notes:

- Vite still emits a large-chunk advisory. The owner/QR paths are already lazy-loaded away from the POS route, but further vendor/chart splitting should be evaluated rather than hiding the warning.
- npm reports transitive deprecation notices for `glob@10.5.0` and `eslint@9.39.5`. The last audit reported no vulnerabilities; upgrade only when the compatible dependency chain is available and the complete gate remains green.
- Performance evidence is a controlled PostgreSQL fixture, not a substitute for measuring the actual server, disk, LAN, and browser during the pilot.

## 5. Remaining requirements and tests from earlier phases

### 5.1 Mandatory release blockers

| Origin    | Test/evidence not yet completed         | Required pass condition                                                                                                                     |
| --------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1   | Trust TLS on a second LAN terminal      | No certificate warning; HTTP redirects to HTTPS; correct hostname and terminal clock.                                                       |
| Phase 1   | Complete a real sale from that terminal | Open till, search/scan, reserve, finalize, reload, and confirm sale/payment/stock/invoice evidence.                                         |
| Phase 1/3 | Print with the selected 80 mm printer   | Original and searched reprint are unclipped, exact, readable, and contain the expected return/fiscal QR; reprint audit exists.              |
| Phase 1   | Backup to the target external disk      | Encrypted dump and checksum are on the mounted physical device, not an accidental local directory.                                          |
| Phase 1   | Restore from the physical external copy | Checksum/decryption/restore/application-role validation pass in under 15 minutes and `backup_runs` records success.                         |
| Phase 3   | Scanner compatibility                   | Thirty configured and ten unknown rapid scans produce one controlled lookup each with no dropped/duplicated characters.                     |
| Phase 3   | Drawer compatibility                    | Drawer opens only for configured authorized cash events; failure does not alter a completed sale/refund.                                    |
| Phase 3   | Pharmacist counter gate                 | Twenty consecutive scanner-and-keyboard-only sales, with original/reprint, and a recorded speed/usability comparison to the current system. |
| Phase 5   | UPS test                                | Under supervised mains removal, the server, network, and counter remain available for the agreed duration and shut down safely.             |
| Phase 5   | FBR sandbox                             | Approved validate/submit request, persisted attempts/responses, official invoice number/QR, and ambiguous-failure reconciliation.           |
| Phase 5   | Return/credit-note fiscal flow          | Licensed integrator approves mapping; test submission and local reconciliation pass.                                                        |
| Phase 5   | Fourteen-day parallel pilot             | Daily signed cash, stock, credit, tax, fiscal, alert, backup, and performance reconciliations; no unresolved P0/P1 issue.                   |

### 5.2 Required approvals and external inputs

- **Explicit outbound-data approval:** the operator must knowingly approve transmission of configured seller identity, invoice lines, and possible buyer fields before the worker is wired to the FBR/PRAL endpoint.
- **Licensed fiscal integrator:** approve endpoints, scenarios, credentials, reference data, retries, ambiguity handling, invoice/QR behavior, and return/credit-note reconciliation.
- **Pakistani tax adviser:** confirm applicable registration, rates, HS codes, units, sale types, print-before-fiscalization policy, and receipt/QR requirements.
- **Privacy owner:** decide collection, access, retention, backup, and receipt-display policy for customer name/phone/address and any fiscal buyer identity.
- **Pilot pharmacy:** provide the actual catalog, staff/roles, hardware, operating procedures, current-system totals, and signed acceptance authority.

Until these are complete, use:

```dotenv
FBR_MODE=DISABLED
```

Possession of a token is not approval to transmit data.

### 5.3 Implemented foundations that still need improvement

| Priority                 | Improvement                                                                                                                                             | Why it matters                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Before pilot             | Validate and clean the real medicine catalog, barcodes, pack/base units, batches, expiry dates, shelves, prices, HS codes, tax rates, and opening stock | Bad master data will invalidate otherwise-correct software results.                                                    |
| Before pilot             | Define named roles and least-privilege assignments; remove shared counter accounts                                                                      | Accountability and session revocation depend on individual identities.                                                 |
| Before pilot             | Establish log/metric retention, alert ownership, disk monitoring, time synchronization, and incident contacts                                           | The application exposes evidence, but the site must act on it.                                                         |
| Before pilot             | Complete customer-data privacy and retention rules                                                                                                      | Credit ledgers and backups may contain personal information.                                                           |
| Before fiscal activation | Wire approved gateway calls into the worker and persist real validation/submission transitions                                                          | This was deliberately withheld pending authorization; local payload creation alone is not fiscal integration evidence. |
| Before fiscal activation | Finalize FBR credit-note/return semantics and ambiguous-submit reconciliation                                                                           | Blind retry can duplicate fiscal invoices.                                                                             |
| During pilot             | Measure p95 on actual server/LAN volume and investigate drift from the representative baseline                                                          | Lab performance does not include target disk/network contention.                                                       |
| After stabilization      | Complete Urdu translations and validate RTL with pharmacy staff                                                                                         | Direction plumbing exists; content coverage and terminology still require human review.                                |
| After stabilization      | Evaluate additional web vendor/chart chunk splitting                                                                                                    | Reduces cold-load cost without weakening the gate.                                                                     |
| After stabilization      | Document statutory accounting/export needs beyond the operational gross-profit estimate                                                                 | Current profit is an operational estimate, not statutory accounts.                                                     |

### 5.4 Explicitly deferred or outside the current pilot scope

These are not silently missing; they require a future product decision and roadmap phase:

- Prescription image/capture workflow.
- Controlled-drug register.
- True browser-offline operation and bidirectional synchronization.
- Multi-shop deployment and consolidated multi-branch operations.
- Full Urdu translation and pharmacist-approved terminology.
- Statutory accounting/general-ledger replacement.

## 6. What to do next

Execute these steps in order. Do not start the 14-day pilot before steps 1–6 have objective evidence.

| Order | Owner                                | Action                                                                                                                              | Evidence to retain                                                                                              |
| ----: | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
|     1 | Pharmacy owner / implementation lead | Obtain the target server, second terminal, supported scanner, 80 mm ESC/POS printer, compatible drawer, UPS, and external SSD       | Model/serial, firmware/driver, connection, warranty/support contact, and assigned terminal.                     |
|     2 | Implementation lead                  | Prepare the production host, static address/hostname, secrets, external mount marker, age identity custody, and `FBR_MODE=DISABLED` | Host revision, image digests, configuration check exit code, and secret-custodian record without secret values. |
|     3 | Implementation lead                  | Run the Phase 1 LAN/TLS, real sale/receipt, external backup, and physical-copy restore tests                                        | Timestamped checklist, operators, terminal/browser, commands/exit codes, backup run IDs, and restore duration.  |
|     4 | Pharmacist / cashier                 | Run the scanner, printer, drawer, keyboard-only 20-sale, return, split-payment, credit, and reprint acceptance cases                | Signed hardware matrix, invoice IDs, exceptions, elapsed time, and current-system comparison.                   |
|     5 | Owner / inventory lead               | Import and reconcile master/opening data; create named staff accounts; perform the full owner-day rehearsal                         | Counts/totals, exception list, signed reconciliation, and role matrix.                                          |
|     6 | Integrator / tax adviser / owner     | Approve fiscal/privacy policy and an identified sandbox session; then authorize the remaining worker wiring                         | Signed approvals, approved configuration, test scenario, and redacted official evidence.                        |
|     7 | Release authorities                  | Run the 14-day parallel pilot described in [`PILOT_RUNBOOK.md`](./PILOT_RUNBOOK.md)                                                 | One signed daily reconciliation per operating day plus incident/acceptance records.                             |
|     8 | Release authorities                  | Make the cutover decision                                                                                                           | Written PASS/BLOCK decision against the stop conditions in section 10.                                          |

## 7. How to run PharmacyOS

### 7.1 Development prerequisites

- Node.js `>=22.22.2`; CI and container builds currently use Node `24.19.0`.
- npm `>=10.9.0`.
- Docker Engine/Compose for PostgreSQL integration tests and the production workflow.
- PostgreSQL 18 with `pg_trgm`, `unaccent`, and `pgcrypto` when running the database outside Docker.

### 7.2 Local development

Run from the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
npm run secrets:rotate-local
npm ci
npm run db:migrate
npm run db:seed
npm run bootstrap:owner --workspace @pharmacy/api
npm run dev
```

Before migration, replace every placeholder in `.env`, especially both PostgreSQL passwords/URLs. Never paste secrets into tickets, screenshots, test evidence, or committed files.

Default local addresses:

- Web: `http://localhost:5173`
- API: `http://localhost:3001/api/v1`

Optional synthetic development data:

1. Set `ALLOW_DEVELOPMENT_SEED=true`.
2. Set a unique `DEVELOPMENT_SEED_PASSWORD` of at least 12 characters.
3. Run `npm run db:seed:development`.

UI-only preview without a database:

```powershell
$env:VITE_PREVIEW_MODE='true'
npm run dev --workspace @pharmacy/web
```

Preview mode is for interface review only. It is not transaction, permission, database, or deployment evidence.

### 7.3 Production-like Docker deployment

Follow [`RUNBOOK.md`](./RUNBOOK.md) rather than improvising. At minimum:

```powershell
Copy-Item .env.example .env
npm run secrets:rotate-local
pwsh -File infra/scripts/New-BackupIdentity.ps1
docker compose --env-file .env -f infra/docker/compose.yaml config
docker compose --env-file .env -f infra/docker/compose.yaml up --detach --build
docker compose --env-file .env -f infra/docker/compose.yaml ps
docker compose --env-file .env -f infra/docker/compose.yaml exec api node apps/api/dist/bootstrap-owner.js
```

Before `up`:

- Replace every placeholder and set the production hostname/timezone.
- Configure a real external-disk path and `.pharmacyos-backup-target` marker.
- Move the age private identity away from the database and backup disks and preserve a separate controlled offline copy.
- Keep `FBR_MODE=DISABLED` until the approvals in section 5.2 are complete.

Only Caddy ports 80/443 should be exposed to the LAN. Never expose PostgreSQL, Redis, or the API container directly. Never run `docker compose down --volumes` on a pharmacy system.

### 7.4 First terminal activation

1. Export Caddy’s public root certificate:

   ```powershell
   docker compose --env-file .env -f infra/docker/compose.yaml cp web:/data/caddy/pki/authorities/local/root.crt ./pharmacyos-root.crt
   ```

2. Install it into the trusted root store on each Windows terminal from an elevated shell:

   ```powershell
   certutil -addstore -f Root .\pharmacyos-root.crt
   ```

3. Restart the browser; open `https://<PHARMACY_HOSTNAME>` and confirm there is no certificate warning.
4. Confirm `http://<PHARMACY_HOSTNAME>` redirects to HTTPS. Never click through a TLS warning.

## 8. How to test the software

### 8.1 Efficient development loop

Run the narrowest relevant test while editing, then the full gate once before commit/handoff.

| Purpose                    | Command                    | Notes                                                                                                  |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Format check               | `npm run format:check`     | Does not modify files.                                                                                 |
| Lint                       | `npm run lint`             | Zero warnings allowed.                                                                                 |
| Strict types               | `npm run typecheck`        | Includes root and every workspace.                                                                     |
| Unit tests                 | `npm run test:unit`        | Fast pure/service/component coverage.                                                                  |
| Database/API integration   | `npm run test:integration` | Requires Docker; uses disposable PostgreSQL 18 and cleans it up.                                       |
| Browser workflows          | `npm run test:e2e`         | Runs Playwright core workflows.                                                                        |
| Production builds          | `npm run build`            | Builds shared packages before apps.                                                                    |
| Complete required gate     | `npm run verify`           | Format, lint, types, unit/integration, E2E, and builds.                                                |
| Representative performance | `npm run test:performance` | Separate, slower gate; run for database/search/transaction/performance changes and release candidates. |

Do not edit an already-applied migration. Add a new migration and keep checksum verification green.

### 8.2 Docker deployment checks

```powershell
docker compose --env-file .env -f infra/docker/compose.yaml config --quiet
docker compose --env-file .env -f infra/docker/compose.yaml up --detach --build
docker compose --env-file .env -f infra/docker/compose.yaml ps
docker compose --env-file .env -f infra/docker/compose.yaml logs --tail 200 migrate api worker backup web
```

Expected:

- `postgres`, `redis`, `api`, `worker`, `backup`, and `web` are running and healthy.
- `migrate` exits successfully.
- HTTPS readiness returns `200` with trusted TLS and security headers.
- No application service connects with the PostgreSQL administrator role.
- Disconnecting internet access does not prevent LAN login, search, reservation, sale, receipt, cash, customer, inventory, or deterministic report workflows.

### 8.3 Backup and restore checks

```powershell
docker compose --env-file .env -f infra/docker/compose.yaml exec backup backup-service backup
docker compose --env-file .env -f infra/docker/compose.yaml exec backup backup-service restore-drill
docker compose --env-file .env -f infra/docker/compose.yaml exec postgres psql -U postgres -d pharmacy_os -c "select id, backup_type, status, destination, encrypted, size_bytes, started_at, finished_at, error_message from backup_runs order by id desc limit 20;"
```

Pass only when:

- Both local and physical external encrypted artifacts and checksum sidecars exist.
- The external path is the mounted external device.
- The latest logical backup and restore drill are `SUCCEEDED`.
- Restore finishes in less than 15 minutes and validates access through `pharmacy_app`.

### 8.4 Manual functional acceptance suite

Use named test users and synthetic customer data. Retain the relevant invoice, batch, cash-session, customer, alert, and backup IDs.

| Workflow            | Minimum test                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication/RBAC | Login/logout; wrong password/lockout; re-auth after expiry; each role sees only allowed routes; permission/role change revokes the active session; cross-branch IDs are rejected.                      |
| Cash                | Open till; cash in/out; cash and split sales; customer cash account payment; refund; close exact; close with variance; approve variance; verify summary and alert threshold.                           |
| POS                 | Search by partial name and exact barcode; rapid scanner input; keyboard-only sale; FEFO across batches; `*N`; Delete; all F-keys; cash change; card/bank/split/credit; basic and overridden discounts. |
| Resilience          | Reload with an active cart; force re-auth; interrupt receipt fetch after finalization; retry with the same request ID; disconnect internet; confirm no duplicate sale/invoice/payment/stock movement.  |
| Receipt             | Print and reprint cash/split/credit/return cases; confirm exact subtotal/discount/tax/total/tender/change; scan return token; verify reprint audit; test printer-offline fallback.                     |
| Returns             | Lookup token; request/approve/refund; partial return; recalled batch; quarantine/scrap; repeat same request ID; confirm no duplicate refund or sellable-state corruption.                              |
| Inventory           | Receive a multi-line PO; compare supplier/reorder output; count up/down; change price/MRP; scrap; quarantine expiry; verify current quantity and append-only movements reconcile.                      |
| Customer credit     | Create/find customer; limit-allowed credit sale; over-limit rejection; partial/full payment; statement and aged balance; deactivate; verify exact running balance.                                     |
| Owner day           | Open till, customer/credit sale, account payment, discount, stock count, price change, return, close till, run worker refresh, then inspect dashboard/reports/alerts without SQL.                      |
| Administration      | Create/deactivate user; assign role; password change/reset; medicine/barcode, supplier, shelf, terminal, policy, fiscal, and tax edits; verify audit evidence and last-owner protection.               |
| Observability       | Check readiness, aggregate metrics, structured correlation IDs, redaction, four alert sources, acknowledgement identity, failed-job surface, and worker recovery.                                      |

### 8.5 Physical and pilot suite

Use the detailed matrices in [`PILOT_RUNBOOK.md`](./PILOT_RUNBOOK.md). At minimum:

- Record model, driver/firmware, connection, browser, terminal, operator, timestamp, and result for every device.
- Run 30 known plus 10 unknown barcode scans.
- Run 20 consecutive keyboard/scanner-only sales with printing and searched reprint.
- Test cash drawer behavior on authorized cash sale/refund and failure fallback.
- Supervise a UPS mains-loss test.
- Perform external-disk backup, disconnect/reconnect, checksum, and restore.
- Run the full owner-day rehearsal.
- After fiscal approval, run one identified sandbox sale and one approved return/credit-note case.
- Complete 14 consecutive parallel operating days with signed daily reconciliation.

## 9. Evidence recording template

For every remaining test, add a row to the relevant phase record or a controlled pilot log.

| Field                   | Required value                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Test ID and requirement | Phase/gate and exact scenario.                                                                                         |
| Date/time/timezone      | Use `Asia/Karachi` unless the site policy says otherwise.                                                              |
| Build                   | Git commit and Docker image digest.                                                                                    |
| Environment             | Server OS, Docker versions, database version, hostname, terminal/browser, and device models.                           |
| Operator/witness        | Named accountable people.                                                                                              |
| Data                    | Synthetic or redacted IDs/counts/totals; never include passwords, tokens, private keys, or unnecessary buyer identity. |
| Procedure               | Commands/user actions and the expected result.                                                                         |
| Result                  | Pass/fail, actual output, exit code, elapsed time, and relevant durable record IDs.                                    |
| Defect/decision         | Incident reference, corrective action, retest result, and acceptance signatures.                                       |

## 10. Release stop conditions

Block pilot start, stop an active pilot, or reject cutover on any of the following:

- Authorization bypass or cross-branch/terminal data access.
- Duplicate sale, invoice, refund, account payment, stock receipt, or fiscal submission.
- Stock quantity that does not reconcile to the append-only movement ledger.
- Unsafe shelf, recalled-batch, expiry, quarantine, or scrap behavior.
- Money, discount, tax, tender, change, cash, or customer-balance rounding/reconciliation error.
- Secret/private-key/token exposure or unnecessary customer identity in logs/receipts/evidence.
- Failed or unproven restore from the actual external backup device.
- Unresolved ambiguous fiscal submission.
- Unacceptable counter latency or repeated operational timeouts on the target system.
- Any unresolved P0/P1 issue during the 14-day pilot.

Do not repair authoritative production rows manually to force reconciliation. Stop writes, preserve evidence, use audited workflows, and follow the rollback process in [`RUNBOOK.md`](./RUNBOOK.md).

## 11. Documentation map

| Document                                                                                             | Use                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)                                                       | Active sequence, scope, risks, and formal exit gates.                                 |
| [`PROJECT_STATUS_AND_NEXT_STEPS.md`](./PROJECT_STATUS_AND_NEXT_STEPS.md)                             | Consolidated current status, feature inventory, test plan, and next actions.          |
| [`RUNBOOK.md`](./RUNBOOK.md)                                                                         | Installation, TLS, backup/restore, upgrade, rollback, and incident response commands. |
| [`PILOT_RUNBOOK.md`](./PILOT_RUNBOOK.md)                                                             | Hardware acceptance, staff training, 14-day parallel pilot, and release decision.     |
| `PHASE_0_EXECUTION.md` … `PHASE_5_EXECUTION.md`                                                      | Objective command history, implementation details, limitations, and gate evidence.    |
| [`decisions/0004-phase-5-fiscal-observability.md`](./decisions/0004-phase-5-fiscal-observability.md) | Fiscal activation, observability, and network-boundary decisions.                     |
