# Phase 5 Execution — Fiscal, Observability, Performance, and Pilot

- **Roadmap source:** `docs/DEVELOPMENT_PLAN.md`
- **Started:** 2026-09-01
- **Branch:** `development`
- **Repository-controlled status:** implemented and focused gates passed
- **Overall exit gate:** blocked on external/physical evidence listed below

## Delivered scope

### Fiscal and exact tax

- Added seller NTN/CNIC, STRN, POS registration, business/province/scenario settings and medicine/sale-line HS code, exact tax rate, FBR unit, and sale-type snapshots.
- Defined the required `FiscalInvoiceGateway` interface and a real DI HTTP adapter with official sandbox/production paths, bearer authentication, timeouts, response bounds, safe error classification, reference-data calls, and exact decimal JSON serialization without floating point.
- Treats counter prices as tax-inclusive and extracts tax using integer arithmetic with deterministic invoice-discount allocation. Database constraints prevent tax from being added twice or exceeding the paid line/total.
- Stores a full fiscal payload at sale finalization without blocking the LAN sale. Sandbox no longer fabricates `SANDBOX-<id>` or a submitted timestamp.
- Outbound transmission is intentionally not wired pending explicit operator approval. Enabled jobs record an append-only permanent attempt and `FAILED_NEEDS_REVIEW`; no external request is made and no false invoice number exists.
- Credit-note/return mapping remains review-required until a licensed integrator approves its semantics.

### Observability and authorization hot path

- Added production structured logs, correlation IDs, secret/password redaction, bounded-label Prometheus metrics, and public LAN metrics containing aggregates only.
- Added durable branch-scoped alerts for failed outbox jobs, fiscal failures, threshold cash variance, and backup/restore failure; acknowledgment is audited and resolution state is constrained.
- Replaced the per-request five-table permission join with a session permission snapshot. Database triggers immediately revoke affected sessions when role assignments or role permissions change.

### Transaction and query performance

- Replaced cash-variance query fan-out with one set-based aggregate.
- Replaced goods-receipt per-line batch/update/movement round trips with deterministic locking plus one set-based CTE; a 25-line integration receipt proves exact rows and stock movements.
- Reworked catalog search into exact barcode/name short-circuits and bounded KNN trigram candidate sets with partial indexes.
- Reduced repeated catalog inventory scans and preserved one branch-local clock per query.

### Operations and pilot preparation

- Added fiscal identity and medicine tax controls in Administration plus owner alert visibility.
- Added ADR 0004 and `PILOT_RUNBOOK.md` covering hardware, UPS, installation, staff training, 14-day parallel operation, incident stop conditions, and rollback.
- Compose keeps PostgreSQL/Redis on the internal backend while only API/worker receive an egress network; internet loss still cannot block LAN checkout.

## Focused objective evidence

| Command / check                                   | Exit | Evidence                                                                                                                                                                                                                        |
| ------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                          |    0 | Clean lockfile install: 709 packages added, 716 audited, 0 vulnerabilities. npm emitted transitive deprecation notices for `glob@10.5.0` and `eslint@9.39.5`; no install failure.                                               |
| `npm run typecheck`                               |    0 | Root and all API/web/worker/config/database/shared strict TypeScript projects passed.                                                                                                                                           |
| `vitest ... phase5-hardening.integration.test.ts` |    0 | 4 real PostgreSQL/API scenarios: exact 18/118 inclusive tax snapshot, four alert sources plus metrics/acknowledgment, 25-line set-based receipt, safe non-fabricated sandbox attempt, and permission-change session revocation. |
| `npm run test:performance`                        |    0 | 10,000 medicines, 200,000 historical batches; fuzzy search p95 82.13 ms, exact barcode 44.69 ms, finalize 155.50 ms, dashboard 18.87 ms. Targets are 150/80/300/2,000 ms.                                                       |
| `npm run verify`                                  |    0 | Formatting, lint, strict types, 77 unit tests, 59 Docker/PostgreSQL integration tests, 9 Playwright workflows, and all production builds passed. Vite emitted only the existing non-blocking large-chunk warning.               |
| `docker compose ... config --quiet`               |    0 | Production Compose including internal backend and API/worker egress networks is valid.                                                                                                                                          |
| `docker compose ... build worker`                 |    0 | Production worker image built with config/database/shared/worker artifacts; build and runtime dependency audits reported 0 vulnerabilities.                                                                                     |
| `git diff --check`                                |    0 | No whitespace errors; Git emitted only the Windows LF-to-CRLF advisory for `.env.example`.                                                                                                                                      |

The performance fixture uses an isolated PostgreSQL 18.4 container. It disables only the deferred inventory-ledger row trigger while bulk-loading 200,000 zero-quantity historical rows that already reconcile to an empty ledger, immediately re-enables it, and uses fully ledgered live stock for measured finalizations. This avoids spending the benchmark on redundant fixture validation without weakening production schema or measured operations.

## Defects found and closed during execution

- Taxed sale finalization initially declared medicine fiscal fields in TypeScript but failed to select them in SQL, producing a 500. The real integration scenario exposed it; the reservation query now joins the immutable medicine fiscal source.
- The inherited schema treated `tax_total` as tax-exclusive while retail prices and fiscal payloads were tax-inclusive, which would have charged tax twice. Migration 015 replaces the total/line constraints with explicit tax-inclusive invariants.
- Alert constraints originally made an acknowledged alert impossible to resolve without erasing acknowledgment. The state checks now require timestamps for their active state while permitting resolved rows to retain audit history.
- The first representative run failed at search 980.30 ms and barcode 844.81 ms. Barcode short-circuiting reduced barcode to 44.69 ms; bounded KNN candidates and partial GiST indexes reduced a genuine partial fuzzy search to 82.13 ms.
- Sandbox previously reported success without an HTTP call. It now records an auditable blocked attempt and never creates a fiscal number.

## External and physical blockers

The overall Phase 5 exit gate is **not passed**. The repository cannot manufacture the following evidence:

- explicit approval to transmit seller and invoice/buyer fields to the configured FBR/PRAL endpoint;
- licensed-integrator review, real sandbox token/scenario, persisted validate/submit responses, official invoice number, and credit-note reconciliation;
- Pakistani tax-professional confirmation of print-before-fiscalization and receipt/QR requirements;
- physical scanner, 80 mm printer, cash drawer, UPS, second trusted-LAN terminal, and pharmacist workflow evidence;
- encrypted backup and live restore on the target external disk;
- one pharmacy's signed 14-day parallel pilot and daily reconciliations.

Until those pass, `FBR_MODE=DISABLED` is the safe deployment setting and PharmacyOS is not approved for production pilot cutover.

## Authoritative fiscal references

- FBR DI API technical documentation v1.12: <https://download1.fbr.gov.pk/Docs/20257301172130815TechnicalDocumentationforDIAPIV1.12.pdf>
- FBR digital invoicing FAQs: <https://www.fbr.gov.pk/faqs/173967/173969>
- FBR licensed integrator list: <https://www.fbr.gov.pk/list-of-license-interprator/173967/173971>
