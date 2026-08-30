# Phase 1 Execution — Make the Pilot Possible

- **Roadmap source:** `docs/DEVELOPMENT_PLAN.md`
- **Executed:** 2026-08-30
- **Status:** implementation and repository verification complete; operational exit gate not yet passed

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

| Plan item              | Implementation                                                                                                                                                                                    | Evidence                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1.1 LAN request IDs    | Shared UUID v4 generator prefers `randomUUID` and cryptographically falls back to `getRandomValues`; all six write paths use it                                                                   | Native and insecure-origin fallback tests                             |
| 1.2 TLS                | Caddy internal CA, HTTP redirect, HSTS, CSP, no-sniff, frame denial, persistent CA volumes                                                                                                        | Deployment contract test; on-terminal trust pending                   |
| 1.3 Bootable Compose   | Required interpolation variables, production overrides, one-shot migration, dependency gates, health checks, and service resource/process limits                                                  | Parsed YAML contract tests; Docker runtime pending                    |
| 1.4 Backups            | Encrypted custom `pg_dump`, atomic copy ordering, SHA-256 sidecars, independent local/external retention 7/4/3, external marker, weekly isolated restore drill, `backup_runs` recording           | Shell syntax and deployment contract tests; live dump/restore pending |
| 1.5 Worker reliability | Per-minute reservation-expiry producer, five-minute bounded stale-lock reaper, guarded loop/attempt/scheduler, branch-and-expiry-aware reservation math, heartbeat, failed-job API and owner tile | Worker unit tests, migration indexes, API service test                |
| 1.6 README truth       | LAN-resilient wording, correct local port, truthful receipt/FBR/readiness boundaries                                                                                                              | `README.md`                                                           |
| Operations             | Install, TLS trust, backup/restore, upgrade, rollback, incident response, and old-volume migration procedures                                                                                     | `docs/RUNBOOK.md`                                                     |

## Design and security decisions

- The browser fallback remains cryptographically secure; it does not use timestamps, counters, or `Math.random()`.
- The API and worker use `pharmacy_app`; migration and backup administration use `postgres`. The API's `DATABASE_ADMIN_URL` is deliberately overwritten with the application URL so an application compromise does not inherit migration privilege.
- PostgreSQL, Redis, API, worker, and backup remain on an internal Docker network. Only Caddy publishes LAN ports.
- Backup data is encrypted before it reaches disk. The age identity is a Docker secret and excluded from Git and Docker build contexts.
- External-copy failure marks the run failed but retains and prunes the encrypted local copy. A marker prevents silently writing to an unmounted server directory.
- Restore validation connects as the least-privilege application role, proving restored grants as well as table presence.
- Stale job recovery locks at most 100 rows in deterministic order with `FOR UPDATE SKIP LOCKED`; partial indexes support both reaper and failed-job queries.

## Verification evidence

| Command                                          |     Exit code | Result                                                                  |
| ------------------------------------------------ | ------------: | ----------------------------------------------------------------------- |
| `npm run test --workspace @pharmacy/config`      |             0 | Six deployment contract tests passed                                    |
| `npm run typecheck --workspace @pharmacy/config` |             0 | Deployment test and environment schema type-check                       |
| `npm run test --workspace @pharmacy/worker`      |             0 | Six worker tests passed, including scheduler, reaper, and claim release |
| `npm run typecheck --workspace @pharmacy/worker` |             0 | Worker changes type-check                                               |
| `npm run typecheck --workspace @pharmacy/web`    |             0 | Shared request-ID and job-health UI type-check                          |
| Linux `sh -n` on three deployment scripts        |             0 | Backup, entrypoint, and PostgreSQL init syntax valid                    |
| PowerShell parser on `New-BackupIdentity.ps1`    |             0 | Script parses without errors                                            |
| `docker --version`                               | Not available | Docker is not installed on this workstation                             |
| Root `npm run verify` after Phase 1              |             0 | Format, lint, types, 24 tests, and all production builds passed         |
| `npm ci --ignore-scripts --dry-run`              |             0 | Lockfile and workspace dependency graph are install-consistent          |

The web build retains the known advisory that the main bundle exceeds 500 kB. It is not a failed gate; router-based code splitting is explicitly sequenced in Phase 3.

## Exit-gate status

The Phase 1 exit gate is **not passed** merely because the code exists. This workstation cannot provide the required evidence because Docker, a second LAN terminal, printer/scanner hardware, and an external backup SSD are unavailable.

Required on-site evidence remains:

- Fresh production Compose startup from a completed `.env` derived from `.env.example`.
- All long-running services healthy and `migrate` exited successfully.
- Trusted TLS on a second LAN machine with HTTP redirect verified.
- Cash session, sale, and printed receipt completed on that second machine.
- Encrypted local and external backup files with checksum sidecars.
- Successful restore drill in under 15 minutes recorded as `SUCCEEDED` in `backup_runs`.

Use `docs/RUNBOOK.md` to execute and append that evidence. Phase 2 must not begin until these items pass.
