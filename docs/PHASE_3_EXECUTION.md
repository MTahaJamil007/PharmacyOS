# Phase 3 Execution — Counter-Grade POS

- **Roadmap source:** `docs/DEVELOPMENT_PLAN.md`
- **Started:** 2026-09-01
- **Branch:** `development`
- **Status:** software implementation and automated gate passed locally and in hosted CI; hardware usability gate pending
- **Entry evidence:** Phase 2 passed in GitHub Actions run `33427582589` on commit `4f549af7fe38e0ccf4ad46402871578e18290261`.
- **Phase 1 exception:** the user is deferring the second-LAN-terminal, printer/scanner, and external restore checks. This does not mark the Phase 1 operational gate passed.

## Workstreams

| Order | Workstream           | Required evidence                                                                                                |
| ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1     | Scanner and keyboard | Buffered wedge scan, debounced search, Enter-add, quantity multiplier/delete, and working F-key actions          |
| 2     | Payment reality      | Exact tendered/change arithmetic and cash/card/bank split tenders persisted with the sale                        |
| 3     | Printing and reprint | 80 mm browser fallback, local ESC/POS adapter boundary, drawer kick, sale lookup/reprint, and visible QR failure |
| 4     | Counter resilience   | Persisted cart, render recovery, re-authentication, stable retry ID, and receipt-fetch recovery                  |
| 5     | Truthful state       | Live clock, measured LAN state, real draft/reservation state, and branch-date expiry thresholds                  |
| 6     | Structure            | Real router, lazy route modules, shared contracts, smaller domain modules, and accessible receipt focus          |
| 7     | Urdu/RTL foundation  | Message catalog, locale persistence, document language, and direction handling                                   |

## Implemented evidence

| Workstream           | Delivered behavior                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scanner and keyboard | Timing-aware wedge buffer; exact-barcode auto-add; 180 ms search debounce; Enter-add; `*N`; Delete; and functional F2/F4/F6/F8 shortcuts.                                                                                     |
| Payment reality      | Exact integer-minor-unit arithmetic, cash tender/change, cash/card/bank split allocation, request validation, database constraints, receipt fields, and integration evidence.                                                 |
| Printing and reprint | Browser print fallback; Web Serial ESC/POS 80 mm output with native QR, paper cut, and cash-drawer pulse; branch-scoped receipt lookup; audited reprint; visible QR and printer errors.                                       |
| Counter resilience   | Validated local cart/held-cart persistence, one persisted `clientRequestId` per checkout attempt, resumable draft/reservation/finalization, receipt-fetch recovery, React error boundary, and in-place 401 re-authentication. |
| Truthful state       | Branch-timezone clock, periodic API readiness probe, live draft/reservation/finalized labels, terminal identity from login, and branch-relative expiry days from PostgreSQL.                                                  |
| Structure            | Hash router, lazy domain routes, split operational modules, shared API contracts, lazy QR dependency, and modal focus trap/Escape/focus restoration.                                                                          |
| Urdu/RTL             | Persisted English/Urdu catalog, live locale toggle, and document `lang`/`dir` updates. Full translation remains a later content task as permitted by the roadmap.                                                             |

## Design controls

- Money is parsed and emitted as canonical decimal strings through shared integer-minor-unit helpers; no floating-point arithmetic was introduced.
- Tender and change invariants are enforced in immutable migration `012_phase3_payment_tendering.sql`, not only in the UI.
- Receipt search is branch-scoped, requires the existing finalize-payment permission, and every reprint creates `RECEIPT.REPRINTED` audit evidence.
- Checkout recovery persists only terminal-local operational state. A finalized sale is recovered by sale ID and never charged a second time merely because receipt loading failed.
- Direct printing is an optional browser capability. Failure leaves the finalized sale intact and keeps browser print available.

## Verification evidence

| Date       | Command                              | Exit | Evidence                                                                                                                                                  |
| ---------- | ------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-01 | `npm run verify`                     | 0    | Format, lint, all workspace type-checks, 67 unit tests, 53 PostgreSQL-backed integration tests, 7 Playwright workflows, and all production builds passed. |
| 2026-09-01 | `npm run test:e2e`                   | 0    | 7/7 core browser workflows passed, including scanner-to-split-tender-to-reprint, persisted cart/all four F-keys, and 401 re-authentication.               |
| 2026-09-01 | `npm test --workspace @pharmacy/web` | 0    | 7 files / 12 tests passed, including scanner timing, exact payment/change, stable checkout ID, and render recovery.                                       |
| 2026-09-01 | GitHub Actions `Quality gate`        | 0    | Clean Ubuntu clone passed on Phase 3 commit `e6552ead8ee81157041223f036df7e65fb737f6c`; run `33439305020`.                                                |

The production build emitted separate POS, cash, inventory, returns, budget, owner, and QR/browser chunks. Vite also reported its advisory 500 kB main-chunk warning; this is not a failed gate, and the owner and QR paths are no longer part of the POS route chunk.

## Remaining objective exit evidence

- Run 20 consecutive sales on the actual counter using only the selected physical scanner and keyboard.
- Print the sale and a searched reprint on the selected 80 mm printer; confirm the configured serial baud rate and drawer pulse with the real printer/drawer combination.
- Record the pharmacist's elapsed time and comparison with the current system.
- Phase 1's second-LAN-terminal, receipt-hardware, external-backup-disk, and live-restore evidence remain separately deferred by the user; no document marks those checks passed.

## Exit gate

The automated implementation gate passed locally and in [GitHub Actions run 33439305020](https://github.com/MTahaJamil007/PharmacyOS/actions/runs/33439305020). The roadmap's final usability gate remains an on-counter human test: a pharmacist completes 20 consecutive keyboard-and-scanner-only sales with printing and reprint working, then confirms the workflow is faster than the current system. Hardware results must be recorded here; code existence alone does not pass that gate.
