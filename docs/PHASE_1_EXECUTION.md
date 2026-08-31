# Phase 1 Execution — Make the Pilot Possible

- **Roadmap source:** `docs/DEVELOPMENT_PLAN.md`
- **Executed:** 2026-08-30
- **Docker audit:** 2026-08-31
- **Status:** implementation, repository verification, and isolated Docker-host validation complete; on-site operational exit gate not yet passed

## Phase 0 prerequisite audit

Phase 1 began only after the Phase 0 gate had local objective evidence.

| Check                        | Evidence                                                                                                                                                       | Result                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Baseline and Phase 0 history | `3102a18`, `72d9f0d`, `cfd53bd` on `main`                                                                                                                      | Pass                      |
| Repository integrity         | Corrupt local `main` ref found during audit, preserved under `.git/recovery`, repaired to verified commit `72d9f0d`; subsequent `git fsck` had no invalid refs | Pass after repair         |
| Clean-clone install          | `npm ci --cache .npm-cache-validation`                                                                                                                         | Exit 0                    |
| Clean-clone quality gate     | `npm run verify` in a disposable Windows clone                                                                                                                 | Exit 0                    |
| Hosted CI                    | No Git remote is configured                                                                                                                                    | Pending external evidence |

The first clean-clone run exposed missing LF normalization for HTML/CSS. Commit `cfd53bd` fixed the portability defect; the repeated clean-clone gate passed.

## Implementation matrix

| Plan item              | Implementation                                                                                                                                                                                    | Evidence                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1.1 LAN request IDs    | Shared UUID v4 generator prefers `randomUUID` and cryptographically falls back to `getRandomValues`; all six write paths use it                                                                   | Native and insecure-origin fallback tests                              |
| 1.2 TLS                | Caddy internal CA, HTTP redirect, HSTS, CSP, no-sniff, frame denial, persistent CA volumes                                                                                                        | Live HTTPS readiness and headers passed; second-terminal trust pending |
| 1.3 Bootable Compose   | Required interpolation variables, production overrides, one-shot migration, dependency gates, health checks, separate edge/private networks, and resource/process limits                          | Clean isolated build/start passed on Docker Desktop                    |
| 1.4 Backups            | Encrypted custom `pg_dump`, atomic copy ordering, SHA-256 sidecars, independent local/external retention 7/4/3, external marker, weekly isolated restore drill, `backup_runs` recording           | Live encrypted dump and 4-second restore passed; physical SSD pending  |
| 1.5 Worker reliability | Per-minute reservation-expiry producer, five-minute bounded stale-lock reaper, guarded loop/attempt/scheduler, branch-and-expiry-aware reservation math, heartbeat, failed-job API and owner tile | Worker unit tests, migration indexes, API service test                 |
| 1.6 README truth       | LAN-resilient wording, correct local port, truthful receipt/FBR/readiness boundaries                                                                                                              | `README.md`                                                            |
| Operations             | Install, TLS trust, backup/restore, upgrade, rollback, incident response, and old-volume migration procedures                                                                                     | `docs/RUNBOOK.md`                                                      |

## Design and security decisions

- The browser fallback remains cryptographically secure; it does not use timestamps, counters, or `Math.random()`.
- The API and worker use `pharmacy_app`; migration and backup administration use `postgres`. The API's `DATABASE_ADMIN_URL` is deliberately overwritten with the application URL so an application compromise does not inherit migration privilege.
- PostgreSQL, Redis, API, worker, and backup remain on an internal Docker network. Only Caddy publishes LAN ports.
- Backup data is encrypted before it reaches disk. The age identity is a Docker secret and excluded from Git and Docker build contexts.
- External-copy failure marks the run failed but retains and prunes the encrypted local copy. A marker prevents silently writing to an unmounted server directory.
- Restore validation connects as the least-privilege application role, proving restored grants as well as table presence.
- Stale job recovery locks at most 100 rows in deterministic order with `FOR UPDATE SKIP LOCKED`; partial indexes support both reaper and failed-job queries.

## Verification evidence

| Command                                          | Exit code | Result                                                                             |
| ------------------------------------------------ | --------: | ---------------------------------------------------------------------------------- |
| `npm run test --workspace @pharmacy/config`      |         0 | Seven deployment contract tests passed                                             |
| `npm run typecheck --workspace @pharmacy/config` |         0 | Deployment test and environment schema type-check                                  |
| `npm run test --workspace @pharmacy/worker`      |         0 | Six worker tests passed, including scheduler, reaper, and claim release            |
| `npm run typecheck --workspace @pharmacy/worker` |         0 | Worker changes type-check                                                          |
| `npm run typecheck --workspace @pharmacy/web`    |         0 | Shared request-ID and job-health UI type-check                                     |
| Linux `sh -n` on three deployment scripts        |         0 | Backup, entrypoint, and PostgreSQL init syntax valid                               |
| PowerShell parser on `New-BackupIdentity.ps1`    |         0 | Script parses without errors                                                       |
| Docker client/server version                     |         0 | Docker Engine 29.6.2 and Docker Compose 5.3.1 available                            |
| Isolated `docker compose ... config --quiet`     |         0 | Final Compose model parsed successfully                                            |
| Isolated `docker compose ... up -d --build`      |         0 | All images built; migrations exited 0; all six long-running services healthy       |
| HTTP `/healthz`                                  |         0 | Published edge returned `200 ok`                                                   |
| HTTPS `/api/v1/health/ready`                     |         0 | Returned `200`, database connected, HSTS/CSP/no-sniff/frame headers present        |
| Encrypted startup backup                         |         0 | `LOGICAL` run 3 succeeded; 267,862 bytes plus SHA-256 sidecar on local bind target |
| `backup-service restore-drill`                   |         0 | `RESTORE_DRILL` run 4 succeeded in 4 seconds; temporary database removed           |
| Root `npm run verify` after Docker audit         |         0 | Format, lint, types, 25 tests, and all production builds passed                    |
| `npm ci --ignore-scripts --dry-run`              |         0 | Lockfile and workspace dependency graph are install-consistent                     |

The web build retains the known advisory that the main bundle exceeds 500 kB. It is not a failed gate; router-based code splitting is explicitly sequenced in Phase 3.

## Docker-host audit findings and corrections

The Docker audit used an isolated clone, project name, ports `18080`/`18443`, generated age identity, bind-mounted local directory standing in for external storage, and disposable volumes. No normal workstation containers or data were modified.

| Attempt                  | Exit/result             | Finding and correction                                                                                                                                                        |
| ------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial Compose parse    | Exit 1                  | Compose rejected differing `pids_limit` and deploy PID values; matching deploy limits are now explicit and contract-tested.                                                   |
| First clean image build  | Exit 1                  | The web image relied on a prebuilt shared package; it now builds `@pharmacy/shared` before the web client.                                                                    |
| Second clean image build | Exit 1                  | Runtime `npm ci --omit=dev` invoked the absent Husky dev dependency; runtime-only installs now use `--ignore-scripts`.                                                        |
| First stack start        | Exit 1                  | PostgreSQL 18 rejected the legacy `/var/lib/postgresql/data` volume target; the volume now mounts at `/var/lib/postgresql`.                                                   |
| Backup startup           | Restarted               | The unprivileged backup process could not read the Compose-mounted age identity; the root entrypoint installs a `0400`, backup-owned runtime copy before dropping privileges. |
| Web health probe         | Unhealthy               | Directive ordering redirected `/healthz`; an exclusive health handler now returns `200` before the redirect handler.                                                          |
| LAN port check           | No host binding         | An internal-only network suppressed Docker Desktop port publication; Caddy now joins a separate edge network while every data/application service remains backend-only.       |
| First restore drill      | Exit 1, recorded failed | Alpine BusyBox does not accept GNU `sha256sum --check`; portable `sha256sum -c` is now contract-tested.                                                                       |
| Final restore drill      | Exit 0                  | Checksum, decrypt, restore, application-role validation, 15-minute RTO, run ledger, and temporary-database cleanup all passed.                                                |

The disposable validation stack, volumes, images, generated identity, and backup fixture were removed after evidence capture.

## Exit-gate status

The Phase 1 exit gate is **not passed**. The Docker-host portion now has objective local evidence, but a second LAN terminal, printer/scanner hardware, and a physical external backup disk remain unavailable until the scheduled on-site test.

Required on-site evidence remains:

- Trusted TLS on a second LAN machine with HTTP redirect verified.
- Cash session, sale, and printed receipt completed on that second machine.
- Encrypted backup and checksum sidecar written to the physical external disk, not a local bind-directory substitute.
- Repeat the under-15-minute restore drill using that physical external-copy evidence.

Use `docs/RUNBOOK.md` to execute and append that evidence. Phase 2 ordinarily must not begin until these items pass; on 2026-08-31 the user explicitly directed Phase 2 execution before the scheduled on-site checks. That exception is tracked in the Phase 2 execution record and does not change this gate's status.
