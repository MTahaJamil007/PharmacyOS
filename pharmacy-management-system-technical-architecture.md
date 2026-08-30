# Pharmacy Management System Technical Architecture and Development Prompt Pack

Date: 2026-08-20  
Target market: low-cost local Pakistani pharmacies  
Target deployment: one local pharmacy branch with 2-3 sales counters, 1 cashier counter, and 1 owner/admin unit  
MVP scope: Fast POS, batch and expiry inventory, multi-counter/cashier workflow, instant medicine and shelf search, reliable returns, automatic reorder suggestions, cash reconciliation, FBR-ready invoicing, simple owner dashboard

---

## 1. Executive Decision

### Stack verdict

| Layer | Proposed stack | Verdict | Rating | Reason |
|---|---:|---:|---:|---|
| Frontend | React + TypeScript + Vite | Approved | 9/10 | Strong fit for fast browser-based POS, admin screens, and local LAN deployment. Build output is static and cheap to serve. |
| Backend | NestJS + TypeScript | Approved with discipline | 8.5/10 | Good modular structure, guards, validation, queues, and API boundaries. Must remain a modular monolith, not premature microservices. |
| Database | PostgreSQL | Strongly approved | 10/10 | Correct choice for inventory, payments, audit logs, financial records, batch/expiry, and transactional consistency. |
| Redis | Approved as non-critical support | 7.5/10 | Useful for cache, rate limits, sessions, and optional queues. It must not be the source of truth for sales, inventory, returns, or FBR jobs. |
| Worker | Required | 9/10 | Needed for FBR retry, reorder calculations, backups, reports, and cleanup jobs. Use database-backed outbox for critical jobs. |
| nginx/Caddy | Approved | 8/10 | Caddy is simpler for small deployments; nginx is more common. Either is fine. |
| Ubuntu + Docker Compose | Approved with operational guardrails | 8/10 | Good for local server deployment, but only if installation, backups, restore, and updates are automated. |
| Backup service | Mandatory | 10/10 | Without tested backups, the product is not fit for pharmacy use. |

### Core architectural decision

The system must be local-first:

- POS sales must work on the pharmacy LAN even when internet is down.
- Sales must not depend on Gemini, AI, cloud services, or live FBR availability.
- PostgreSQL is the only source of truth.
- FBR, analytics, reorder suggestions, and dashboard summaries are secondary workflows around the core transaction engine.

### Reality check on low-cost hardware

The requested budget is tight but not impossible if the pharmacy accepts refurbished hardware.

| Budget item | Realistic interpretation | Feasibility |
|---|---|---:|
| PKR 35K-40K "server" | Used/refurbished desktop such as Core i5 4th-6th gen, 8GB RAM, 256GB SSD | Feasible for MVP, but reliability risk is medium |
| PKR 20K "counter system" | Thin client/browser terminal only, usually without good printer/scanner/cash drawer | Feasible only if peripherals are separate or reused |
| Complete counter with printer/scanner/drawer | PC + monitor + barcode scanner + thermal printer + optional drawer | Usually closer to PKR 45K-75K+ |
| New branded desktop server | Modern official-warranty desktop | Not feasible under PKR 40K |

### Hardware rating

| Configuration | Example | Expected MVP rating | Notes |
|---|---|---:|---|
| Minimum viable | Core i5 4th/6th gen, 8GB RAM, 256GB SSD, no RAID, small UPS | 6.5/10 | Works for 2-3 counters, but disk/power failure risk is real. |
| Recommended low-cost | Core i5 8th gen or better, 16GB RAM, 512GB SSD, external backup SSD, UPS | 8/10 | Best balance for local pharmacies. |
| Strong small-business | Core i5 10th/11th gen or Ryzen 5, 16-32GB RAM, 2 SSDs, UPS, automated offsite backup | 8.8/10 | Better for selling as a serious product. |

Blunt conclusion: the tech stack is strong enough. The weak point is not React/Nest/Postgres. The weak points are cheap refurbished hardware, power cuts, weak backups, printer issues, bad data entry, and FBR integration complexity.

---

## 2. Current Technology Baseline

Use stable production versions, not "current" experimental versions.

| Component | Recommended baseline as of 2026-08-20 | Rule |
|---|---|---|
| OS | Ubuntu Server 26.04 LTS or 24.04 LTS | Prefer LTS only. Use 24.04 if device/vendor compatibility is better. |
| Node.js | Node 24 LTS | Do not run production on Node 26 Current until it becomes LTS. |
| React | React 19.2.x | Use stable React only. Do not use experimental/canary APIs. |
| Vite | Vite 8.x | Pin exact minor after scaffold. |
| TypeScript | TypeScript 7.x if Nest/tooling passes; otherwise pin latest compatible stable | Reliability beats version chasing. |
| NestJS | NestJS 11.x | Use Fastify adapter if benchmarks show value; Express adapter is acceptable for MVP. |
| PostgreSQL | PostgreSQL 18.x | Pin major version in Docker image. Never use `latest` in production. |
| Redis | Redis 8.x | Pin major/minor. Do not depend on Redis for permanent business state. |

Implementation note: after scaffolding, lock exact versions in `package-lock.json` or `pnpm-lock.yaml`. Do not let AI tools silently upgrade packages during feature work.

---

## 3. Product Vision

Build a pharmacy operating system for local pharmacies that improves the daily work they already do:

- Faster medicine search than legacy systems.
- Batch and expiry accuracy.
- Correct stock after sales, purchases, and returns.
- Multi-counter workflow without inventory confusion.
- Cashier control and end-of-day cash reconciliation.
- Owner visibility without requiring Excel.
- FBR-ready invoice architecture.
- Simple enough for low-computer-literacy staff.

This is not an "AI pharmacy" MVP. AI can come later. The first commercial version must win on speed, correctness, and reliability.

---

## 4. MVP Scope Boundaries

### Included in MVP

- Fast POS
- Medicine search by brand, generic, barcode, company, strength, and shelf
- Batch-level stock
- Expiry tracking
- FEFO sale allocation: first-expiry-first-out
- Multi-counter cart creation
- Cashier payment and invoice finalization
- Basic discounts with role approval
- Cash, card, bank transfer, and mixed payment support
- Reliable return workflow against original sale
- Stock ledger
- Automatic reorder suggestions
- Cash session opening, closing, variance, and approval
- FBR-ready invoice data model and adapter boundary
- Simple owner dashboard
- RBAC and audit logs
- Local deployment with backups

### Excluded from MVP

- AI assistant
- Gemini dashboard automation
- Patient prescription OCR
- Supplier portal
- Multi-branch replication
- E-commerce
- Loyalty program
- Advanced accounting
- Controlled substance regulatory module
- Full FBR certification guarantee
- Cloud SaaS multi-tenant version

These exclusions are intentional. Adding them early will slow the core product and increase failure risk.

---

## 5. System Architecture

### High-level topology

```text
Sales Counter 1  \
Sales Counter 2   \
Sales Counter 3    \          Local LAN
Cashier Counter ---->  Web UI in browser
Owner/Admin Unit  /             |
                                v
                         Caddy or nginx
                                |
                                v
                         NestJS API
                                |
              +-----------------+------------------+
              |                 |                  |
              v                 v                  v
          PostgreSQL          Redis              Worker
        source of truth    cache/session    FBR/reorder/backup
              |
              v
       Encrypted backups
       local + removable + optional cloud
```

### Deployment services

```text
pharmacy-stack/
  caddy-or-nginx
  pharmacy-web
  pharmacy-api
  postgres
  redis
  worker
  backup-service
```

### Service responsibilities

| Service | Responsibility | Critical path? |
|---|---|---:|
| `pharmacy-web` | Static React UI | Yes |
| `pharmacy-api` | Auth, RBAC, POS, inventory, payments, returns, reports | Yes |
| `postgres` | All permanent business state | Yes |
| `redis` | Cache, sessions, rate limits, optional fast queues | No |
| `worker` | FBR retry, reorder jobs, backup orchestration, report precomputation | No for sale completion; yes for background health |
| `backup-service` | Scheduled backups, retention, restore validation | Yes for business continuity |

Critical sales workflow must continue if Redis or worker is temporarily down.

---

## 6. Backend Architecture

Use a NestJS modular monolith.

### Required modules

| Module | Purpose |
|---|---|
| `auth` | Login, session, PIN unlock, password policy |
| `rbac` | Roles, permissions, guards, approval checks |
| `audit` | Append-only action logs |
| `catalog` | Medicines, generics, brands, companies, barcodes |
| `shelf` | Shelves, racks, bins, lookup, fast-moving flags |
| `inventory` | Batches, stock ledger, stock movements, expiry |
| `purchase` | Supplier purchase entry, batch receiving |
| `pos` | Cart, sale draft, reservations, checkout |
| `payments` | Cash/card/bank/mixed payments |
| `cash` | Cash sessions, cash movements, reconciliation |
| `returns` | Return requests, approvals, refunds, restock/quarantine |
| `reorder` | Sales velocity, reorder suggestions, supplier list |
| `fbr` | FBR-ready payloads, adapters, retry, audit |
| `dashboard` | Owner summary metrics |
| `terminal` | Counter/cashier terminal registration |
| `settings` | Branch settings, tax/FBR modes, invoice numbering |
| `backup` | Backup status and restore drill metadata |

### Internal layering

Each module should follow this structure:

```text
module/
  controller.ts       HTTP boundary only
  service.ts          business orchestration
  repository.ts       database access
  dto.ts              request/response validation
  policy.ts           permission and approval rules
  events.ts           domain events if needed
  tests/
```

Rules:

- Controllers must not contain business logic.
- Services must not build raw SQL strings.
- Repositories own database queries.
- All write endpoints validate DTOs.
- All financial and inventory writes run inside explicit transactions.
- External calls are outside database transactions.
- Every privileged action writes an audit event.

### ORM/database access decision

Recommended:

- Use Prisma for ordinary CRUD, migrations, and developer speed.
- Use raw SQL migrations for Postgres-specific indexes, constraints, generated columns, triggers, and extensions.
- Use repository methods with explicit SQL for stock allocation, sale finalization, cash reconciliation, and queue claiming where transaction control matters.

Do not expose Prisma models directly to controllers. Keep a repository layer so the system can use raw SQL where correctness demands it.

---

## 7. Frontend Architecture

### UI principles

The UI must be operational, not decorative.

- POS first screen opens directly to medicine search and cart.
- Search input must auto-focus.
- Barcode scanning must work as keyboard input.
- Common actions need keyboard shortcuts.
- Large touch/click targets for counters.
- No marketing landing page inside the product.
- No nested cards, no oversized hero sections, no visual clutter.
- Staff screens must use plain language.
- Owner dashboard can be cleaner and more analytical, but still simple.

### Suggested frontend structure

```text
apps/web/src/
  app/
  routes/
  modules/
    pos/
    cashier/
    inventory/
    returns/
    dashboard/
    settings/
  shared/
    api/
    components/
    hooks/
    permissions/
    formatters/
```

### Frontend libraries

| Need | Recommended library |
|---|---|
| Server state | TanStack Query |
| Local POS cart state | Zustand or module-local reducer |
| Forms | React Hook Form + Zod |
| Tables | TanStack Table |
| UI primitives | Radix UI or shadcn-style primitives |
| Styling | Tailwind CSS or existing design tokens |
| Charts | Recharts or ECharts |

Keep the frontend simple. Do not put sale finalization logic in the browser. The browser may hold a cart draft, but the backend must allocate stock and finalize sale atomically.

---

## 8. Database Design Principles

### Non-negotiable rules

- PostgreSQL is the source of truth.
- Use migrations only. No manual production schema changes.
- Use `bigint generated always as identity` for internal primary keys.
- Use `text`, not artificial `varchar(255)`, unless a real constraint exists.
- Use `timestamptz`, not timezone-less `timestamp`.
- Use `numeric(12,2)` for PKR money.
- Use `numeric(12,3)` for quantities if partial packs are supported.
- Never use floating point for money.
- Index every foreign key.
- Use composite indexes for common multi-column filters.
- Use partial indexes for active/pending rows.
- Keep transactions short.
- Do not call FBR, payment gateways, or external APIs inside inventory/payment transactions.
- Use append-only stock ledger for traceability.
- Use audit logs for security-sensitive changes.

### Recommended Postgres extensions

| Extension | Use |
|---|---|
| `pg_trgm` | Fast fuzzy medicine search |
| `unaccent` | Optional search normalization |
| `pg_stat_statements` | Query performance visibility |
| `pgcrypto` | Secure random values if needed |

### Core tables

This is the conceptual schema. Final migrations should be generated and reviewed separately.

#### Identity and access

| Table | Purpose |
|---|---|
| `users` | Staff accounts |
| `roles` | Role definitions |
| `permissions` | Atomic permissions |
| `role_permissions` | Mapping |
| `user_branch_roles` | User role per branch |
| `terminals` | Counter/cashier/admin devices |
| `sessions` | Login sessions |
| `audit_events` | Append-only user/system action log |

#### Catalog and shelf

| Table | Purpose |
|---|---|
| `medicines` | Sellable medicine master |
| `medicine_aliases` | Alternate names/spellings |
| `medicine_barcodes` | Barcode mapping |
| `generics` | Generic molecule/group |
| `manufacturers` | Manufacturer/company |
| `categories` | Product category |
| `shelves` | Shelf/rack/bin physical structure |
| `medicine_shelf_locations` | Medicine to shelf/bin mapping |

#### Inventory

| Table | Purpose |
|---|---|
| `suppliers` | Supplier records |
| `purchase_orders` | Purchase header |
| `purchase_order_items` | Purchase lines |
| `inventory_batches` | Batch, expiry, quantity, cost, sell price |
| `stock_movements` | Append-only ledger for every stock change |
| `stock_reservations` | Temporary reserved stock for cashier workflow |
| `expiry_alerts` | Generated expiry risk records |

#### Sales, payments, and returns

| Table | Purpose |
|---|---|
| `sale_drafts` | Counter-created carts |
| `sale_draft_items` | Draft items |
| `sales` | Final sale header |
| `sale_items` | Final sale lines with batch linkage |
| `payments` | Payment records |
| `cash_sessions` | Cashier shift/session |
| `cash_movements` | Cash in/out adjustments |
| `returns` | Return header |
| `return_items` | Returned lines |
| `refunds` | Refund payments/credit |

#### FBR and jobs

| Table | Purpose |
|---|---|
| `fbr_invoices` | Fiscalization state per sale |
| `fbr_invoice_attempts` | Request/response attempts |
| `fbr_reference_codes` | Cached FBR reference data |
| `outbox_jobs` | Durable background jobs |
| `job_attempts` | Worker execution logs |

#### Reorder and dashboard

| Table | Purpose |
|---|---|
| `reorder_policies` | Min/max, supplier, lead time, pack size |
| `sales_velocity_daily` | Aggregated sales velocity |
| `reorder_suggestions` | Generated suggested purchases |
| `dashboard_daily_metrics` | Precomputed owner metrics |

### Inventory correctness model

Use two layers:

1. `stock_movements`: append-only historical truth.
2. `inventory_batches.current_qty`: transactionally maintained current stock for fast POS.

Every sale, return, adjustment, and purchase must create stock movement rows. The current batch quantity is updated in the same transaction.

### Search indexes

Minimum search indexes:

```sql
create extension if not exists pg_trgm;

create index medicines_name_trgm_idx
on medicines using gin (name gin_trgm_ops)
where deleted_at is null;

create index medicines_generic_trgm_idx
on medicines using gin (generic_name gin_trgm_ops)
where deleted_at is null;

create index medicine_barcodes_code_idx
on medicine_barcodes (barcode);

create index medicine_shelf_locations_medicine_id_idx
on medicine_shelf_locations (medicine_id);
```

Inventory lookup indexes:

```sql
create index inventory_batches_available_idx
on inventory_batches (medicine_id, expiry_date, id)
where current_qty > 0 and deleted_at is null;

create index inventory_batches_expiry_idx
on inventory_batches (expiry_date)
where current_qty > 0 and deleted_at is null;
```

Sales dashboard indexes:

```sql
create index sales_branch_created_idx
on sales (branch_id, created_at);

create index sale_items_medicine_created_idx
on sale_items (medicine_id, created_at);
```

---

## 9. RBAC and Security Model

### Roles

| Role | Main access |
|---|---|
| Salesperson | POS cart, medicine search, shelf lookup |
| Cashier | Payment, final invoice, cash session, basic refunds |
| Pharmacist/Supervisor | Sales plus approvals, return inspection, controlled overrides |
| Inventory Manager | Purchases, batches, stock adjustments, shelves, expiry |
| Manager | Reports, staff oversight, cash variance approval |
| Owner | Everything plus financial dashboard and FBR status |
| System Admin | Configuration, backups, terminal setup, user setup |

### Permissions

Use permissions, not hardcoded role names, inside the code.

| Permission | Salesperson | Cashier | Supervisor | Inventory | Manager | Owner | Admin |
|---|---:|---:|---:|---:|---:|---:|---:|
| `pos.search` | Yes | Yes | Yes | Yes | Yes | Yes | No |
| `pos.create_draft` | Yes | Yes | Yes | No | Yes | Yes | No |
| `pos.send_to_cashier` | Yes | Yes | Yes | No | Yes | Yes | No |
| `sale.finalize_payment` | No | Yes | Yes | No | Yes | Yes | No |
| `sale.discount.basic` | Limited | Limited | Yes | No | Yes | Yes | No |
| `sale.discount.override` | No | No | Yes | No | Yes | Yes | No |
| `returns.request` | Yes | Yes | Yes | No | Yes | Yes | No |
| `returns.approve` | No | Limited | Yes | No | Yes | Yes | No |
| `returns.refund_cash` | No | Yes | Yes | No | Yes | Yes | No |
| `inventory.purchase` | No | No | Limited | Yes | Yes | Yes | No |
| `inventory.adjust` | No | No | Yes | Yes | Yes | Yes | No |
| `reports.view_basic` | No | Yes | Yes | Yes | Yes | Yes | No |
| `reports.view_financial` | No | No | No | No | Yes | Yes | No |
| `cash.open_session` | No | Yes | Yes | No | Yes | Yes | No |
| `cash.close_session` | No | Yes | Yes | No | Yes | Yes | No |
| `cash.approve_variance` | No | No | No | No | Yes | Yes | No |
| `fbr.view_status` | No | Yes | Yes | No | Yes | Yes | No |
| `fbr.retry` | No | No | No | No | Yes | Yes | Yes |
| `settings.manage_users` | No | No | No | No | No | Yes | Yes |
| `settings.manage_system` | No | No | No | No | No | Yes | Yes |
| `backup.restore` | No | No | No | No | No | Yes | Yes |

### Approval rules

Require supervisor/manager/owner approval for:

- High discount above configured threshold.
- Negative stock override.
- Editing sale after payment.
- Return after configured return window.
- Restocking returned medicine into sellable inventory.
- Stock adjustment.
- Cash variance approval.
- Deleting/deactivating medicines.
- Changing FBR settings.
- Restoring backup.

### Authentication rules

- No shared accounts.
- Staff login with password.
- Fast re-auth with PIN for terminal unlock.
- Session timeout on idle terminals.
- Owner/admin accounts require stronger password policy.
- Password hashing with Argon2id or bcrypt.
- JWT access token short lifetime.
- Refresh/session token stored securely.
- Every session bound to terminal and branch.

### Audit log events

Audit at minimum:

- Login/logout/failure.
- User/role/permission change.
- Sale finalization.
- Discount override.
- Refund and return approval.
- Stock adjustment.
- Purchase receiving.
- Batch expiry edit.
- Cash session open/close.
- Cash variance approval.
- FBR retry/status override.
- Backup restore.
- Settings change.

Audit logs are append-only. Do not allow ordinary app users to edit or delete audit rows.

---

## 10. Critical Workflows and State Machines

## 10.1 Multi-counter/cashier workflow

### State machine

```text
DRAFT
  -> SENT_TO_CASHIER
  -> RESERVED
  -> PAYMENT_IN_PROGRESS
  -> PAID
  -> FBR_PENDING
  -> FBR_SUBMITTED
  -> COMPLETED

DRAFT
  -> CANCELLED

RESERVED
  -> EXPIRED
  -> CANCELLED

PAID
  -> FBR_FAILED_RETRYABLE
  -> FBR_FAILED_FINAL_REVIEW
```

### Behavior

- Salesperson creates draft.
- Draft does not reduce stock.
- When sent to cashier, backend allocates stock by FEFO and creates short-lived stock reservations.
- Cashier sees pending drafts.
- Cashier confirms payment.
- Backend finalizes sale in one transaction:
  - validates reservation still valid,
  - locks relevant batch rows in stable order,
  - creates sale and sale items,
  - creates payment rows,
  - creates stock movement rows,
  - decrements batch quantities,
  - marks reservation consumed,
  - appends audit event,
  - creates FBR outbox job.
- Receipt can print immediately with local invoice number and FBR status.

### Expiry of reservations

- Default reservation TTL: 5-10 minutes.
- Expired reservations release stock automatically.
- Cashier can refresh/re-reserve if customer delayed.

## 10.2 Batch allocation

Allocation order:

1. Sellable status only.
2. Not expired.
3. Earliest expiry first.
4. Oldest received first.
5. Lowest batch id as tie-breaker.

Pseudocode:

```text
for each cart item:
  required_qty = item.qty
  batches = available batches ordered by expiry_date, received_at, id
  for batch in batches:
    take = min(required_qty, batch.available_qty)
    reserve/take from batch
    required_qty -= take
  if required_qty > 0:
    reject item with available quantity
```

Never allow silent negative stock. Negative stock override, if enabled, must require explicit permission and audit.

## 10.3 Sale finalization transaction

Transaction rules:

- Lock batch rows in ascending `inventory_batches.id`.
- Do not call FBR inside the transaction.
- Do not print inside the transaction.
- Do not wait for Redis inside the transaction.
- Keep the transaction under 300ms on local server for normal carts.
- Use idempotency key from cashier terminal to prevent double sale on retry.

Required idempotency:

```text
terminal_id + cashier_session_id + client_request_id
```

If the browser retries after network hiccup, the backend must return the existing sale result, not create another sale.

## 10.4 Returns workflow

### State machine

```text
REQUESTED
  -> APPROVED
  -> REJECTED

APPROVED
  -> RECEIVED
  -> REFUNDED
  -> CLOSED

RECEIVED
  -> RESTOCK_SELLABLE
  -> QUARANTINE
  -> SCRAP
```

### Return rules

- Return must reference original sale.
- Return item must reference original sale item and batch.
- Refund amount must not exceed original paid amount for returned quantity.
- Returned medicine must not automatically return to sellable stock.
- Supervisor/pharmacist decides:
  - restock sellable,
  - quarantine,
  - scrap/non-sellable.
- Restocking creates stock movement.
- Refund creates payment/refund record.
- FBR credit/debit note readiness must be modeled, even if adapter is not live.

This protects the pharmacy from fake returns and unsafe resale.

## 10.5 Cash reconciliation

### State machine

```text
NOT_OPENED
  -> OPEN
  -> CLOSING
  -> CLOSED
  -> VARIANCE_APPROVED
```

### Cash session data

- Branch.
- Terminal.
- Cashier.
- Opening float.
- Cash payments.
- Cash refunds.
- Cash in/out movements.
- Expected cash.
- Counted cash.
- Variance.
- Closing notes.
- Manager approval if variance exceeds threshold.

Only one active cash session per cashier-terminal pair.

## 10.6 Reorder suggestions

Initial reorder logic should be simple and explainable:

```text
average_daily_sales = sales over last N days / N
lead_time_demand = average_daily_sales * supplier_lead_time_days
safety_stock = average_daily_sales * safety_days
reorder_point = lead_time_demand + safety_stock
suggested_qty = max(0, reorder_point - current_sellable_stock)
round suggested_qty to pack size
```

Also flag:

- fast-moving medicine,
- low stock,
- out of stock,
- expiring soon,
- dead stock,
- supplier unavailable,
- stock enough but wrong shelf placement.

Reorder suggestions are recommendations, not automatic purchase orders.

## 10.7 Shelf lookup

MVP shelf feature:

- Search medicine.
- Show shelf, rack, bin, and optional row.
- Show stock by batch/expiry.
- Show fast-mover indicator.
- Suggest "move closer" only as advisory based on sales velocity.

Do not overbuild automatic shelf optimization in MVP.

---

## 11. FBR-Ready Invoicing Architecture

### Reality

FBR integration must be treated as a compliance adapter, not a simple checkbox.

Current public FBR materials show:

- Digital invoicing technical assistance and API documentation exist on FBR pages.
- FBR FAQs say notified registered persons must integrate POS/ERP/invoicing systems through a licensed integrator.
- PRAL may act as a licensed integrator for registered persons on demand.
- Technical documents describe real-time invoice validation/submission, reference data, tokens, invoice numbers, and QR requirements.
- Older POS fiscal component flows may involve Windows/IIS/.NET and local fiscal services, so a pure Ubuntu-only design must not assume every FBR path works natively on Linux.

### MVP stance

Build FBR-ready, not FBR-certified.

The system must:

- Store all tax/FBR fields needed for invoices.
- Generate deterministic invoice payloads.
- Support sandbox mode.
- Persist request/response attempts.
- Retry failed submissions.
- Print local invoice even if FBR is temporarily unavailable, with clear fiscal status.
- Allow later adapter swap without changing sale logic.

### Adapter interface

```ts
interface FiscalInvoiceGateway {
  validateInvoice(payload: FiscalInvoicePayload): Promise<FiscalValidationResult>;
  submitInvoice(payload: FiscalInvoicePayload): Promise<FiscalSubmissionResult>;
  getReferenceData(type: FiscalReferenceType): Promise<FiscalReferenceRecord[]>;
}
```

Supported modes:

| Mode | Use |
|---|---|
| `DISABLED` | Non-FBR customer or development |
| `SANDBOX` | Developer testing |
| `PRAL_DI_API` | Direct/PRAL digital invoicing path if approved for customer |
| `LICENSED_INTEGRATOR_API` | Third-party licensed integrator |
| `WINDOWS_IMS_BRIDGE` | Separate Windows machine/service bridge if required for local fiscal component |

### FBR state machine

```text
NOT_REQUIRED
PENDING
VALIDATING
VALIDATED
SUBMITTING
SUBMITTED
FAILED_RETRYABLE
FAILED_NEEDS_REVIEW
VOID_OR_CREDIT_NOTE_PENDING
```

### Rule

The `sales` table must never depend on a live FBR response to preserve local POS continuity. The `fbr_invoices` table tracks fiscal status separately.

Compliance caveat: Whether printing a local invoice before successful fiscalization is acceptable depends on the pharmacy's tax status and current FBR rules. Treat this as a product configuration and confirm with a Pakistani tax professional before production rollout.

---

## 12. Owner Dashboard

MVP dashboard should answer daily owner questions:

- Today's sales.
- Today's gross profit estimate.
- Cash collected.
- Card/bank payments.
- Refunds.
- Cash variance.
- Top-selling medicines.
- Low-stock medicines.
- Expiring soon.
- FBR pending/failed invoices.
- Sales by cashier.
- Inventory value estimate.

Do not make the dashboard AI-dependent. Use precomputed metrics where possible.

### Dashboard metrics

| Metric | Source |
|---|---|
| Net sales | `sales`, `sale_items`, `returns` |
| Gross profit estimate | sale price minus batch cost |
| Cash expected | `cash_sessions`, `payments`, `refunds` |
| Low stock | `inventory_batches`, `reorder_policies` |
| Expiry risk | `inventory_batches.expiry_date` |
| FBR health | `fbr_invoices` |
| Fast movers | `sales_velocity_daily` |

---

## 13. Deployment Architecture

### Docker Compose services

```yaml
services:
  proxy:
    image: caddy:stable

  web:
    image: pharmacy-web:<version>

  api:
    image: pharmacy-api:<version>
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  worker:
    image: pharmacy-worker:<version>
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:18
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:8

  backup:
    image: pharmacy-backup:<version>
```

Production rules:

- Do not use `latest` Docker tags.
- Use named volumes.
- Use health checks.
- Restart policies required.
- Store secrets in `.env` with locked file permissions.
- Do not expose Postgres outside localhost/LAN server.
- Firewall should allow only needed ports.
- Admin panel should not be public internet-facing.

### Backup policy

Minimum:

- Nightly encrypted PostgreSQL dump.
- Hourly lightweight logical backup if transaction volume is high.
- Copy to external USB SSD daily.
- Optional cloud copy when internet is available.
- Keep at least:
  - 7 daily backups,
  - 4 weekly backups,
  - 3 monthly backups.

Recommended:

- WAL archiving or frequent physical backups for lower data loss.
- Automated restore test weekly on a separate folder/container.
- Backup dashboard showing last successful backup and last restore test.

Non-negotiable:

- A backup that has never been restored is not a backup.

### Power and network

Minimum operational hardware:

- Server connected to UPS.
- Router/switch connected to UPS.
- Cashier counter connected to UPS if possible.
- Thermal printer on stable power.
- Static LAN IP for server.
- Local DNS or bookmarked server address.

The system should tolerate internet outage. It should not tolerate server disk failure without data loss unless backups are working.

---

## 14. Hardware Fit Calculation

### Workload assumption

MVP pharmacy:

- 2-3 sales counters.
- 1 cashier.
- 1 owner/admin.
- 10,000-50,000 medicine/product records.
- 20,000-200,000 batch rows over time.
- 300-1,500 invoices/day.
- Normal cart: 1-20 items.
- Search target: p95 under 150ms on LAN.
- Sale finalization target: p95 under 300ms excluding printer/FBR.

### Minimum server

| Component | Minimum | Risk |
|---|---|---|
| CPU | Core i5 4th/6th gen | Enough for MVP; old hardware failure risk |
| RAM | 8GB | Works, but tight with Docker, Postgres, API, Redis, OS |
| Disk | 256GB SSD | Works; must monitor free space |
| Network | Gigabit LAN preferred | 100Mbps still works for small LAN |
| UPS | Strongly required | Without UPS, database corruption/data loss risk rises |

Expected result: usable for small pharmacy MVP, but not a premium reliability story.

### Recommended server

| Component | Recommended |
|---|---|
| CPU | Core i5 8th gen or better |
| RAM | 16GB |
| Disk | 512GB SSD or NVMe |
| Backup | External SSD + optional cloud |
| UPS | 650VA or better for server/router |

Expected result: strong enough for first commercial deployments.

### Counter terminal

Counter terminals do not need to run the backend. They only need a browser.

Minimum:

- Used desktop/laptop/thin client.
- 4GB RAM minimum, 8GB better.
- Chrome/Edge.
- Barcode scanner as keyboard input.
- Reliable receipt printer at cashier.

If the PKR 20K counter budget includes printer/scanner/drawer, it is unrealistic in most cases. If it only means a used PC terminal, it can work.

---

## 15. Reliability Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| Power cuts | Critical | UPS for server/router/cashier, safe shutdown, Postgres durability |
| SSD failure | Critical | Automated backups, external copy, restore drills |
| Staff using shared login | High | Individual accounts, PIN unlock, audit |
| Bad batch/expiry entry | High | Required batch fields, barcode/purchase validation, correction audit |
| Overselling in multi-counter flow | High | Reservation and transaction locking |
| Double payment/sale on retry | High | Idempotency keys |
| Printer failure | Medium | Reprint by invoice, receipt status, alternate printer |
| Internet/FBR outage | Medium/High | FBR outbox retry, visible pending status |
| Redis outage | Medium | Keep Redis out of critical sales path |
| Docker maintenance complexity | Medium | Installer scripts, health screen, simple update command |
| User deletes/edits records | High | Soft delete, audit, limited permissions |
| Slow search after data grows | Medium | Trigram indexes, query monitoring |

---

## 16. Testing Strategy

### Required test types

| Type | Tooling | Required coverage |
|---|---|---|
| Unit tests | Vitest/Jest | Pricing, reorder, permission checks, state transitions |
| API integration tests | Jest + test database | POS, inventory, returns, cash, auth |
| Database tests | SQL fixtures | constraints, indexes, transactions |
| E2E tests | Playwright | full sale, cashier payment, return, cash close |
| Concurrency tests | custom test runner | 2-3 counters selling same batch |
| Performance tests | k6 or autocannon | search and sale finalization |
| Backup tests | restore script | backup can restore into clean database |

### MVP acceptance targets

| Workflow | Target |
|---|---:|
| Medicine search | p95 under 150ms on LAN |
| Barcode lookup | p95 under 80ms |
| Sale finalization | p95 under 300ms excluding printer/FBR |
| Dashboard load | under 2s for daily summary |
| Backup completion | nightly success visible |
| Restore drill | under 15 minutes for small deployment |
| Concurrent sale race | no oversell, no double decrement |

### Critical tests

1. Two counters sell the last quantity of the same batch at the same time. Only one succeeds.
2. Browser retries sale finalization after timeout. Only one sale is created.
3. Cashier closes cash session with refund and cash-in/out. Expected cash is correct.
4. Return against original sale cannot exceed sold quantity.
5. Expired batch cannot be sold unless explicit override exists.
6. FBR API is down. Sale completes locally and FBR job remains retryable.
7. Backup is restored into a clean database and app can start.

---

## 17. Repository Structure

Recommended monorepo:

```text
pharmacy-os/
  apps/
    web/
    api/
    worker/
  packages/
    shared/
    config/
    database/
  infra/
    docker/
    scripts/
  docs/
    architecture/
    workflows/
    deployment/
    prompts/
  tests/
    e2e/
    performance/
```

### Development standards

- TypeScript strict mode.
- ESLint and Prettier enforced.
- No `any` unless justified with comment.
- DTO validation on every write endpoint.
- Database migrations reviewed before merge.
- All financial/inventory methods require tests.
- Every module has README-level notes for business rules.
- No unrelated refactors inside feature tasks.
- No hidden dependency on cloud services for MVP.

---

## 18. Sequential Milestones and Prompts

Use these prompts with Codex or Claude. Each milestone should be completed, tested, and committed before starting the next.

### Global prompt prefix for every development task

```text
You are building a local-first pharmacy management system for Pakistani pharmacies.

Hard constraints:
- MVP only: Fast POS, batch/expiry inventory, multi-counter/cashier workflow, medicine/shelf search, returns, reorder suggestions, cash reconciliation, FBR-ready invoicing, simple owner dashboard.
- Do not add AI features yet.
- Do not add multi-branch SaaS yet.
- PostgreSQL is the source of truth.
- Redis must not be required for sale finalization.
- FBR submission must be asynchronous and adapter-based.
- All money is PKR and must use exact decimal handling.
- All inventory-changing operations must be transactional and audited.
- Use TypeScript strict mode.
- Keep modules clean and test business-critical logic.

Before editing:
- Read the existing repository structure.
- Read docs/architecture if present.
- Preserve existing patterns.
- Do not refactor unrelated code.

After editing:
- Run lint, typecheck, and relevant tests.
- Report files changed and tests run.
```

### Milestone 0: Project scaffold

```text
Objective:
Create the monorepo scaffold for the pharmacy management system.

Tasks:
- Create apps/web with React + TypeScript + Vite.
- Create apps/api with NestJS + TypeScript.
- Create apps/worker with NestJS or shared worker runtime.
- Create packages/shared for shared DTOs/types.
- Create packages/database for Prisma schema/migrations or database access.
- Create infra/docker with Docker Compose for local development.
- Add lint, format, typecheck, and test scripts.
- Add README with local startup instructions.

Architecture rules:
- Use a modular monolith.
- Do not implement business features yet.
- Pin package versions.
- Use environment validation.

Acceptance:
- Web starts locally.
- API starts locally.
- Postgres and Redis start via Docker Compose.
- Typecheck passes.
- Basic health endpoint returns OK.
```

### Milestone 1: Database foundation

```text
Objective:
Create the initial PostgreSQL schema for identity, catalog, shelf, inventory, sales, payments, returns, cash, FBR, and outbox jobs.

Tasks:
- Define migrations for core tables.
- Use bigint identity primary keys.
- Use timestamptz for timestamps.
- Use numeric for money and quantities.
- Add foreign keys and indexes.
- Add partial indexes for active/pending rows.
- Add pg_trgm extension for medicine search.
- Add seed data for roles and permissions.

Critical rules:
- Index every foreign key.
- Do not use float for money.
- Do not use random UUID primary keys for large tables.
- Add check constraints for statuses.
- Add audit_events table as append-only.

Acceptance:
- Migrations apply cleanly on empty database.
- Seed creates default roles and permissions.
- Database tests verify key constraints.
```

### Milestone 2: Auth, RBAC, and audit

```text
Objective:
Implement authentication, role-based access control, terminal registration, and audit logging.

Tasks:
- Implement user login.
- Implement password hashing.
- Implement terminal-aware sessions.
- Implement role/permission guard.
- Implement permission seed.
- Implement audit logging service.
- Add APIs for owner/admin to manage users.

Rules:
- No shared accounts.
- Do not hardcode role names in business logic; use permissions.
- Every privileged action must write audit_events.

Acceptance:
- Salesperson cannot access owner reports.
- Cashier can finalize payment but cannot change system settings.
- Owner can manage users.
- Audit event is written for login and user role change.
```

### Milestone 3: Medicine catalog and shelf search

```text
Objective:
Implement fast medicine catalog, barcode, and shelf lookup.

Tasks:
- CRUD for medicines, generics, manufacturers, aliases, barcodes.
- CRUD for shelves/racks/bins.
- Link medicines to shelf locations.
- Implement search endpoint for name, generic, alias, barcode.
- Add frontend medicine search UI.

Rules:
- Use indexed database search.
- Barcode exact match should be fastest path.
- Search results must show shelf and available stock summary.

Acceptance:
- Search by brand name returns correct medicine.
- Search by generic returns related medicines.
- Barcode lookup returns exact item.
- Shelf location is visible in result.
- Search performance test passes target on seeded dataset.
```

### Milestone 4: Batch and expiry inventory

```text
Objective:
Implement batch-level inventory with purchases, expiry, stock ledger, and adjustments.

Tasks:
- Purchase receiving creates inventory batches.
- Batch has batch number, expiry date, cost price, sale price, current quantity.
- Stock movement ledger records every stock change.
- Expiry alert endpoint.
- Inventory adjustment with approval and audit.

Rules:
- No inventory change without stock_movement.
- Expired batch cannot be sold by default.
- Stock adjustment requires permission.

Acceptance:
- Purchase receiving increases stock.
- Adjustment creates audit event and stock movement.
- Expiry report shows near-expiry batches.
```

### Milestone 5: POS draft and cart

```text
Objective:
Build the salesperson POS cart workflow.

Tasks:
- POS search screen.
- Add item to cart.
- Edit quantity.
- Show batch/expiry summary.
- Show estimated total.
- Save draft.
- Send draft to cashier.

Rules:
- Draft does not reduce stock.
- Draft belongs to branch, terminal, salesperson.
- Price calculation happens on backend.

Acceptance:
- Salesperson can create draft.
- Draft appears in cashier queue.
- Draft can be cancelled before cashier reservation.
```

### Milestone 6: Reservation and cashier queue

```text
Objective:
Implement stock reservation when draft is sent to cashier.

Tasks:
- Allocate batches FEFO.
- Create stock_reservations with TTL.
- Cashier queue shows reserved drafts.
- Expired reservations release automatically.
- Re-reserve expired draft.

Rules:
- Prevent overselling.
- Lock batch rows in stable order.
- Reservation is not final sale.

Acceptance:
- Two counters cannot reserve more stock than available.
- Expired reservation is not payable until refreshed.
- Reservation audit exists.
```

### Milestone 7: Payment and sale finalization

```text
Objective:
Implement cashier payment, final invoice, stock decrement, and local receipt.

Tasks:
- Open cash session.
- Accept cash/card/bank/mixed payment.
- Finalize sale transactionally.
- Create sale, sale_items, payments, stock_movements.
- Consume reservation.
- Generate local invoice number.
- Print-ready receipt data.
- Create FBR outbox job.

Rules:
- Use idempotency key.
- No FBR call inside transaction.
- No printer call inside transaction.
- All stock decrements and payment rows must be in one database transaction.

Acceptance:
- Sale finalizes once even on retry.
- Stock decreases correctly by batch.
- Payment total must match sale total.
- Receipt can be reprinted.
```

### Milestone 8: Returns and refunds

```text
Objective:
Implement reliable returns against original sales.

Tasks:
- Return request by invoice.
- Select sale items and quantity.
- Approval rules.
- Refund methods.
- Restock/quarantine/scrap decision.
- Stock movement for restock.
- Credit/debit note readiness for FBR.

Rules:
- Cannot return more than sold quantity.
- Cannot refund more than paid amount.
- Returned medicine not automatically sellable.

Acceptance:
- Valid return creates refund.
- Invalid over-return is blocked.
- Restock creates stock movement.
- Return audit is complete.
```

### Milestone 9: Cash reconciliation

```text
Objective:
Implement cash session opening, closing, expected cash calculation, counted cash, and variance approval.

Tasks:
- Cash session open/close.
- Opening float.
- Cash in/out.
- Expected cash calculation.
- Counted cash entry.
- Variance threshold.
- Manager approval.

Rules:
- One active cash session per cashier-terminal pair.
- Closed session cannot be edited without owner/admin correction workflow.

Acceptance:
- Expected cash is correct after sales/refunds/cash movements.
- Variance requires approval above threshold.
- Owner dashboard can show cash status.
```

### Milestone 10: Reorder engine

```text
Objective:
Implement automatic reorder suggestions.

Tasks:
- Sales velocity daily aggregation.
- Reorder policy per medicine.
- Supplier lead time and pack size.
- Generate suggestions.
- Reorder suggestion review UI.

Rules:
- Suggestions are explainable.
- Do not auto-create purchase orders.
- Consider current stock, reserved stock, expiry, lead time, and safety stock.

Acceptance:
- Low fast-moving item appears in reorder suggestions.
- Overstocked item does not appear.
- Suggestion shows reason and formula inputs.
```

### Milestone 11: Simple owner dashboard

```text
Objective:
Implement owner dashboard for daily operations.

Tasks:
- Sales summary.
- Gross profit estimate.
- Cash collected.
- Refunds.
- Top-selling medicines.
- Low stock.
- Expiry risk.
- FBR pending/failed count.
- Sales by cashier.

Rules:
- Dashboard must not slow POS.
- Use precomputed daily metrics where useful.
- Owner-only financial metrics.

Acceptance:
- Owner sees daily summary.
- Salesperson cannot access financial dashboard.
- Dashboard loads under target.
```

### Milestone 12: FBR-ready adapter

```text
Objective:
Implement FBR-ready invoice payload generation and adapter boundary.

Tasks:
- Create fiscal payload mapper from sale.
- Create FBR invoice state table usage.
- Implement sandbox/mock gateway.
- Implement outbox worker retry.
- Store request/response attempts.
- Show FBR status on invoice and dashboard.

Rules:
- No FBR call inside sale transaction.
- Adapter must be swappable.
- Do not claim compliance/certification without real registered integration testing.

Acceptance:
- Sale creates FBR pending job.
- Worker submits to mock/sandbox gateway.
- Retryable failures are retried.
- Permanent validation failure appears for review.
```

### Milestone 13: Deployment, backup, and restore

```text
Objective:
Prepare local pharmacy deployment.

Tasks:
- Production Docker Compose.
- Environment validation.
- Health checks.
- Backup service.
- Restore script.
- Update script.
- Firewall guidance.
- Deployment README.

Rules:
- Pin Docker images.
- Do not expose database publicly.
- Backups must be encrypted.
- Restore must be tested.

Acceptance:
- Fresh server can deploy from documented steps.
- Backup runs successfully.
- Restore into clean database works.
- Health screen shows API, DB, worker, backup status.
```

### Milestone 14: Hardening and pilot readiness

```text
Objective:
Prepare for first real pharmacy pilot.

Tasks:
- End-to-end test full daily flow.
- Add seed/import tool for medicine catalog.
- Add printer test page.
- Add terminal setup screen.
- Add support/admin diagnostics.
- Run concurrency tests.
- Run backup restore drill.
- Fix UI friction found during pilot simulation.

Acceptance:
- Full day simulation completes.
- No overselling in concurrency test.
- Cash reconciliation matches expected cash.
- Backup restore works.
- Pilot checklist signed off.
```

---

## 19. Pilot Checklist

Before installing at first pharmacy:

- Server UPS installed.
- Router/switch UPS installed.
- Static LAN IP assigned.
- Barcode scanner tested.
- Thermal printer tested.
- Receipt format approved.
- Staff accounts created.
- Roles tested.
- Medicine import cleaned.
- Opening stock entered by batch and expiry.
- Backup destination configured.
- Restore test completed.
- Cash opening process trained.
- Return policy configured.
- FBR mode configured as disabled/sandbox/production per customer status.
- Owner trained on dashboard and backup status.

---

## 20. Strategic Build Advice

The fastest path to a sellable product is not adding more features. It is making the core pharmacy day flawless:

1. Search medicine fast.
2. Find shelf fast.
3. Sell without stock mistakes.
4. Handle cashier/payment cleanly.
5. Return safely.
6. Close cash correctly.
7. Reorder intelligently.
8. Backup reliably.

If those are excellent, local pharmacies will feel the difference immediately.

Do not build AI before the above workflows are proven in a real shop.

---

## 21. Sources Consulted

The following sources were checked for current stack, hardware, and FBR assumptions:

- FBR Digital Invoicing Technical Assistance and API documentation: https://fbr.gov.pk/di-technical-assistance/173967/173970
- FBR Digital Invoicing FAQs, including licensed integrator requirement: https://ipv6.fbr.gov.pk/faqs/173967/173969
- FBR POS Technical Assistance: https://www.fbr.gov.pk/pos-technical-assistance/163085/163087
- FBR Tier-1 POS integration general orders page: https://fbr.gov.pk/sales-tax-general-order-tier-1/163085/173442
- Ubuntu releases and LTS support: https://www.releases.ubuntu.com/ and https://documentation.ubuntu.com/release-notes/26.04/
- Node.js release status and LTS guidance: https://nodejs.org/en/about/previous-releases
- React versions: https://react.dev/versions
- Vite releases: https://vite.dev/releases
- TypeScript official site/blog: https://www.typescriptlang.org/ and https://devblogs.microsoft.com/typescript/
- NestJS releases: https://github.com/nestjs/nest/releases
- PostgreSQL versioning and supported versions: https://www.postgresql.org/support/versioning/
- PostgreSQL 18 release notes/news: https://www.postgresql.org/about/news/postgresql-18-released-3142/
- Redis releases/downloads: https://download.redis.io/releases/
- Pakistani/current hardware references checked: Grace Digital Dell OptiPlex 3020 listing, OLX Dell/HP refurbished listings, Computer Zone used/new systems, Mega.pk i5 search listings, ZAH Computers refurbished listings.

Source note: hardware prices in Pakistan move quickly and used-market listings are volatile. Treat the hardware figures as practical market ranges, not fixed quotations.

