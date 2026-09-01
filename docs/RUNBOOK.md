# PharmacyOS Installation and Operations Runbook

- **Scope:** single-shop, on-premise LAN deployment
- **Source of truth:** `docs/DEVELOPMENT_PLAN.md`
- **Assumption:** Docker Engine and Docker Compose run on a dedicated, access-controlled shop server

## 1. Safety rules

- Never commit `.env`, an age identity, database dumps, or credentials.
- Never run `docker compose down --volumes` on a pharmacy system. It deletes named durable storage.
- Back up and complete a restore drill before every application or host upgrade.
- Keep the age private identity separate from the external backup disk. Losing the identity makes the backups unrecoverable; storing it with the backup defeats encryption.
- Use base64url or percent-encoded database passwords so PostgreSQL connection URLs remain valid.
- Do not expose PostgreSQL, Redis, or the API container directly to the LAN. Only Caddy ports 80 and 443 are published.

## 2. Host preparation

1. Install a supported Docker Engine and current Docker Compose plugin.
2. Give the server a static LAN address.
3. Choose a stable hostname such as `pharmacy.lan`. Add it to the shop DNS server, or add the same hostname/IP mapping to every terminal. Do not assume `.local` resolves on every Windows terminal.
4. Mount a dedicated external SSD at a stable path. On Linux, use `/media/pharmacy-backup`; on Windows, use a Docker Desktop-shared absolute path.
5. Create an empty marker file named `.pharmacyos-backup-target` at the external destination. On Linux, make the destination writable by UID/GID `10001`, used by the backup container.

Example Linux preparation, after verifying the mount path is the external device:

```sh
sudo touch /media/pharmacy-backup/.pharmacyos-backup-target
sudo chown -R 10001:10001 /media/pharmacy-backup
sudo chmod 0700 /media/pharmacy-backup
```

## 3. Environment and encryption identity

1. Copy `.env.example` to `.env` at the repository root.
2. Replace every `replace-with-...` value. Use different high-entropy values for `POSTGRES_PASSWORD` and `POSTGRES_APP_PASSWORD`.
3. Set `PHARMACY_HOSTNAME`, `BACKUP_EXTERNAL_PATH`, timezone, and the desired schedule.
4. Rotate the local session, bootstrap-owner, and development-seed placeholders with `npm run secrets:rotate-local`.
5. Generate an age identity:

```powershell
pwsh -File infra/scripts/New-BackupIdentity.ps1
```

6. Move `backup-age-identity.txt` to a root/administrator-readable secret location that is not on the external backup disk. Set `BACKUP_AGE_IDENTITY_FILE` to that file. Keep a second offline copy in the pharmacy's controlled credential escrow.
7. Copy the `age1...` value from `backup-age-recipient.txt` into `BACKUP_AGE_RECIPIENT`. The recipient is public; the identity is secret.

The generated `infra/docker/secrets` directory is excluded from Git and the Docker build context, but moving the identity to the host secret location remains required for production.

## 4. Validate and start a fresh installation

Run from the repository root:

```sh
docker compose --env-file .env -f infra/docker/compose.yaml config
docker compose --env-file .env -f infra/docker/compose.yaml up --detach --build
docker compose --env-file .env -f infra/docker/compose.yaml ps
```

Expected state:

| Service                                               | Expected state                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `postgres`, `redis`, `api`, `worker`, `backup`, `web` | Running and healthy                                                      |
| `migrate`                                             | Exited successfully after applying or verifying every migration checksum |

Review startup failures without printing environment variables:

```sh
docker compose --env-file .env -f infra/docker/compose.yaml logs --tail 200 migrate api worker backup web
```

Create the initial owner only after the stack is healthy:

```sh
docker compose --env-file .env -f infra/docker/compose.yaml exec api node apps/api/dist/bootstrap-owner.js
```

## 5. Trust the internal TLS authority

Export Caddy's public root certificate:

```sh
docker compose --env-file .env -f infra/docker/compose.yaml cp web:/data/caddy/pki/authorities/local/root.crt ./pharmacyos-root.crt
```

Install `pharmacyos-root.crt` into the **trusted root certification authorities** store on every terminal. On Windows, run the following from an elevated terminal:

```powershell
certutil -addstore -f Root .\pharmacyos-root.crt
```

Then restart the browser and open `https://<PHARMACY_HOSTNAME>`. The browser must show a trusted HTTPS connection. Do not bypass a certificate warning. Verify that `http://<PHARMACY_HOSTNAME>` redirects to HTTPS.

## 6. Pilot acceptance check

From a second LAN machine, not the server:

1. Sign in over the trusted HTTPS hostname.
2. Open a cash session.
3. Search or scan a medicine and reserve stock.
4. Complete a cash sale.
5. Print the 80 mm receipt and verify its opaque return-token QR.
6. Confirm the sale, payment, stock movement, and invoice are visible after a page reload.

Record the terminal, browser, printer, scanner, timestamps, and result in the Phase 1 execution record. This test is mandatory; localhost success does not satisfy the exit gate.

## 7. Backup and restore operations

The daemon creates an encrypted custom-format `pg_dump`, writes its checksum, retains 7 daily/4 weekly/3 monthly copies locally and externally, and runs the restore drill on `RESTORE_DRILL_DAY`. A missing or unwritable external marker makes the run fail while retaining and pruning the local encrypted copy.

Start an immediate backup:

```sh
docker compose --env-file .env -f infra/docker/compose.yaml exec backup backup-service backup
```

Run the isolated restore drill:

```sh
docker compose --env-file .env -f infra/docker/compose.yaml exec backup backup-service restore-drill
```

The drill verifies the encrypted checksum, creates only `pharmacy_os_restore_drill`, restores with `pg_restore`, validates core tables through the least-privilege application role, drops the drill database, and fails if elapsed time reaches 15 minutes. The script rejects production and system database names.

Inspect durable evidence:

```sh
docker compose --env-file .env -f infra/docker/compose.yaml exec postgres psql -U postgres -d pharmacy_os -c "select id, backup_type, status, destination, encrypted, size_bytes, started_at, finished_at, error_message from backup_runs order by id desc limit 20;"
```

Required daily checks:

- Latest `LOGICAL` run is `SUCCEEDED`.
- Both local and external encrypted files and checksum sidecars exist.
- External destination is the intended mounted SSD, not an accidental directory on the server disk.
- Latest scheduled `RESTORE_DRILL` is `SUCCEEDED` and finished in under 15 minutes.

## 8. Failed background jobs

Users with `settings.manage_system` see failed, retrying, processing, and stale-lock counts on the owner screen. The API is `GET /api/v1/operations/jobs/failed?limit=20`.

Before changing data manually:

1. Read the latest error and job type.
2. Check worker and database health.
3. Confirm whether the dependency is local or internet-based. Internet-dependent fiscal work must not block sales.
4. Preserve the job row and `job_attempts` evidence for diagnosis.

The worker automatically schedules reservation expiry every minute and reclaims `PROCESSING` locks older than five minutes using bounded, skip-locked batches.

## 9. Fiscal activation and observability

Keep `FBR_MODE=DISABLED` until every external activation condition in `docs/decisions/0004-phase-5-fiscal-observability.md` is signed. Enabling a mode transmits configured seller identity plus invoice and possible buyer fields; do not treat possession of a token as approval.

Before an approved sandbox session:

1. Confirm the integrator and tax adviser approved the endpoint, scenario, HS/rate/UOM/sale-type catalog, retry/reconciliation behavior, credit-note path, and receipt policy.
2. Set `FBR_API_TOKEN` only in the host `.env`/secret store. Never paste it into commands, logs, screenshots, issues, or execution records.
3. Set `FBR_MODE=SANDBOX`, the approved `FBR_API_BASE_URL`, and a bounded `FBR_REQUEST_TIMEOUT_MS`; restart only the API/worker during a controlled window.
4. Complete one identified sandbox sale and retain the local `fbr_invoices`, `fbr_invoice_attempts`, outbox/job-attempt, correlation-ID, official response, and invoice/QR evidence without exposing buyer data.
5. Reconcile any ambiguous submission with the licensed integrator. Never retry it using a new client request ID or by editing the status.

Operational endpoints:

- `GET /api/v1/metrics` exposes aggregate Prometheus text and no credentials or invoice/customer payloads.
- `GET /api/v1/operations/alerts?status=OPEN&limit=20` requires `settings.manage_system`.
- `POST /api/v1/operations/alerts/:id/acknowledge` records the responsible user in the audit ledger.

An alert acknowledgement means an owner accepted responsibility; it does not resolve the underlying job, fiscal, cash, or backup state.

## 10. Upgrade and rollback

### Upgrade

1. Complete an immediate backup and restore drill.
2. Record the current application revision and image identifiers.
3. Fetch the reviewed release.
4. Run the Compose configuration validation.
5. Start with `up --detach --build`. The one-shot migration service must exit successfully before the API, worker, or backup starts.
6. Repeat health, second-terminal sale, receipt, and backup evidence checks.

### Rollback

- Migrations are forward-only and immutable. Do not edit an applied migration or attempt an ad-hoc schema downgrade.
- An application-image rollback is allowed only when the earlier version is explicitly compatible with the current schema.
- Otherwise, stop writes, preserve the current volume, restore the pre-upgrade encrypted backup into an isolated database, validate it, and perform a controlled recovery.
- Never delete the current volume as a shortcut.

### Existing pre-Phase-1 volumes

Earlier Compose files initialized `pharmacy_app` as the PostgreSQL superuser. The Phase 1 stack deliberately separates a `postgres` administrator from the non-superuser `pharmacy_app` role. An old volume is not directly compatible with the new initialization contract. Back it up under the old stack, restore into a fresh Phase 1 cluster, validate counts and ledgers, then switch over. Do not use `down --volumes` on the old installation.

## 11. Incident response

| Symptom                         | Immediate action                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| TLS warning                     | Stop use on that terminal; verify hostname, clock, certificate trust, and Caddy volume. Never click through.                        |
| API unhealthy                   | Keep the database volume intact; inspect migration/API logs and database readiness.                                                 |
| Backup failed                   | Verify the external mount, marker, UID/GID permissions, free space, and age recipient. The local encrypted copy may still be valid. |
| Restore drill failed            | Treat backups as unproven. Preserve files/logs, correct the cause, and repeat before pilot operation.                               |
| Worker failures                 | Review the owner job-health surface and worker logs; do not delete failed jobs.                                                     |
| Suspected credential disclosure | Remove affected access, rotate credentials through a controlled maintenance window, and retain audit evidence.                      |

Every incident record must contain timestamps, affected terminal/branch, commands and exit codes, evidence preserved, corrective action, and verification result.
