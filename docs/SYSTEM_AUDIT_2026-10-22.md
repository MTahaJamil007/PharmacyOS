# PharmacyOS — System audit and production plan

- **Date:** 2026-10-22
- **Branch audited:** `development` (after commit `ce52988`)
- **Method:** source, migrations and data read directly; every fix proven with a unit,
  integration (PostgreSQL in Docker) or browser test; computation measured, not estimated.
- **Earlier audit:** `docs/SYSTEM_AUDIT_2026-09-21.md`. Its open items are carried forward in
  section 4 where they are still open.

## 1. Headline

The counter, cash and stock paths are sound: exact money, an append-only stock ledger,
idempotent writes and branch scoping hold everywhere I looked. The gaps that matter for a
crowded Pakistani pharmacy were speed and safety at the edges: stock could not be received
without a purchase order, 2D pack codes were not understood anywhere, the counter search hid the
dosage form, and "low stock" silently showed nothing. Those are fixed in this round. What stands
between this build and a production cut-over is mostly not code: equipment, backups proven on a
real disk, FBR activation and a pilot (roadmap Phase 6), then the supplier money loop (roadmap
Phase 7).

## 2. Problems found and fixed in this round

| #   | Problem                                                                                                                                      | Risk                                                                | Fix                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Counter search returned no dosage form; a tablet and a syrup of the same brand looked alike.                                                 | Wrong form handed to a patient.                                     | Form is returned and shown beside every name, in the staged line and in alternatives.                                                                             |
| 2   | 2D (GS1 DataMatrix) pack codes were not understood: a scan was compared as a raw string, so it never matched.                                | Staff type names instead of scanning, slower and error-prone.       | `packages/shared/src/gs1.ts` reads product number, expiry, batch and serial from every scanner format; lookup is exact, in every stored form (14, 13, 12 digits). |
| 3   | The counter barcode handler required the stored barcode to equal the raw scan.                                                               | 2D scans refused at the counter.                                    | The server says when it matched by exact barcode (`matchedBy: BARCODE`); the counter trusts only that.                                                            |
| 4   | Search availability ignored stock other counters were holding for open orders.                                                               | "In stock" shown, then the reservation fails at payment.            | Active reservations are subtracted.                                                                                                                               |
| 5   | Search could show archived shelves (codes like `A-1~12`) and secondary locations first.                                                      | Staff sent to the wrong shelf.                                      | Active shelves only, primary first, with the level's name.                                                                                                        |
| 6   | Low stock relied on per-medicine reorder policies that no screen creates; with 3,190 medicines and no policies it was always empty.          | Run-outs at the counter.                                            | Low stock now comes from how fast each medicine sells, with the shop's own window and cover days; policies still act as minimums.                                 |
| 7   | Stock could only be received against a purchase order.                                                                                       | Walk-in distributor deliveries (most of them) had no fast path.     | Scan-and-receive: an order and its receipt in one transaction through the same receipt code, so ledger, costs and audit are identical.                            |
| 8   | Listing suppliers needed the system-settings permission.                                                                                     | An inventory manager could not pick a supplier to receive or order. | `inventory.purchase` may read suppliers.                                                                                                                          |
| 9   | A medicine whose catalogue entry is incomplete could have been offered as an alternative by any fuzzy rule.                                  | Wrong medicine offered.                                             | Alternatives require the exact generic (release form included), strength and dosage form; incomplete entries get none (`packages/shared/src/formulation.ts`).     |
| 10  | (Earlier this week) owner page crash from unrounded money, primary-shelf change crossing branches, two integration tests that had never run. | Crash, cross-shop data change, false confidence.                    | Fixed and recorded in `docs/PHASE_6_EXECUTION.md` §10.                                                                                                            |

## 3. Patient-safety rules the code now enforces

1. **A medicine is identified only exactly.** Scans match a stored barcode exactly; a GS1 code
   with a wrong check digit matches nothing. Fuzzy name search only ever offers choices to a
   person.
2. **An unknown barcode is never guessed.** The receiver picks the medicine and confirms a
   sentence naming it, its strength, form and company; a barcode already linked to another
   medicine is refused, never moved.
3. **Alternatives are the same medicine only:** same generic including XR/SR, same strength
   without unit conversion, same form (syrup is not suspension, eye drops are not ear drops),
   combination ingredients in the same order. Each is labelled with its company and picked on
   purpose; nothing is substituted automatically.
4. **Dosage form is always visible** beside the name at the counter and in receiving.
5. **Expired stock cannot be received or sold**, and short shelf life on arrival is flagged
   (setting: 180 days by default).
6. **Fridge and controlled medicines keep their places:** cold medicines only in cold fixtures,
   controlled ones only in locked ones, in manual placement, A to Z placement and suggestions.
7. **When the scanner drops a separator**, the batch it inferred is highlighted for a person to
   check before stock is received.

## 4. Still open, with the plan to fix

### Before a production cut-over (P0)

| Item                                                                                                                                       | Plan                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roadmap Phase 6 gate: second terminal, backup to and restore from a physical disk, real scanner and printer, FBR activation, 14-day pilot. | Equipment and people, not code. Use `docs/PILOT_RUNBOOK.md`. Test the new scan-and-receive with the actual scanner model: some send the group separator, some do not (the parser handles both). |
| The offline decision (roadmap: decide before Phase 7).                                                                                     | Decide whether a shop must sell when the server PC is down. If yes, choose the design before supplier ledgers exist.                                                                            |
| Catalogue: `generic_id` is empty for all 3,190 medicines; generics live only as text.                                                      | Load a generics master (DRAP list) and link medicines; alternatives then match on ids. Until then exact text matching keeps it safe but finds fewer alternatives.                               |
| Medicines are shared by every shop on the server.                                                                                          | A platform-owned master catalogue with per-shop overrides (price, aliases, active). Needed before a second shop is onboarded to the same server.                                                |

### Next build work (P1)

- **Roadmap Phase 7, the money loop:** supplier ledger and payables, purchase returns and debit
  notes (near-expiry returns start from the new Expiring list), expenses and the day book.
- **Roadmap Phase 8:** stock-take sessions (counting by scanning, the same scanner flow as
  receiving), barcode labels, administration completeness, full Urdu.
- **Sell the scanned batch at the counter:** when a 2D code is scanned at the counter, reserve
  that batch instead of first-expiry-first.
- **Cost-change alert on receiving:** warn when a pack costs more than last time by more than a
  set percentage.
- **Batch recall:** find and quarantine every pack of a recalled batch by its GS1 batch.
- **Printed queue slip** for shops with several cash counters (order number and counter in large
  print).

### Hardening (P2)

- Session tokens live in browser storage, acceptable on a closed shop LAN; move to an httpOnly
  cookie before any internet exposure.
- The web bundle still has a chunk over 500 kB (charts); lazy-load the owner charts.
- Add an operational alert when no successful backup has been recorded for 24 hours.

## 5. Several counters (Task 1)

**How it works now (built):**

1. Give each place a terminal in Admin: order desks as `SALES_COUNTER`, cash counters as
   `CASHIER`. Staff sign in on their desk's terminal.
2. With the **Several cash counters** feature on, the order desk shows "Send to: Any counter |
   Counter 1 | Counter 2" above the pay button (remembered per desk). F8 sends the bill.
3. Each cash counter sees **its own bills first**, then bills for any counter, then other
   counters' bills, each marked.
4. When a cashier starts on a bill (types the cash received), the bill is **claimed** for two
   minutes; other counters see "Being paid at Counter 1" and cannot take that money. The server
   enforces it, so two cashiers can never charge the same customer. A stale claim can be taken
   over.
5. A busy queue has a **Find bill #** box: type the number from the slip, press Enter, take the
   cash.

**Recommended setups:**

| Shop                                     | Setup                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| One person does everything               | Cash sessions on, the desk starts its own day: F8 takes payment directly.   |
| Order takers + one cash counter          | Cash sessions on, Several cash counters off: one shared queue.              |
| Order takers + two or more cash counters | Several cash counters on: route by counter, claims protect each payment.    |
| Pay-at-invoice shops                     | Cash sessions off: the order desk prints the invoice; the customer pays it. |

## 6. Computing power (Task 1)

Measured on the development PC with Chrome; the counter PCs only need to run a browser.

| Work                                                          | Time / size                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Walking routes for a 10×20 ft shop (9 fixtures)               | 0.9 ms                                                                       |
| Walking routes and checks for a 50×100 ft store (66 fixtures) | 2–2.4 ms                                                                     |
| Planning places for 3,190 medicines (server)                  | 35–37 ms                                                                     |
| Finding a free spot in the 66-fixture store                   | 134 ms (once per added rack)                                                 |
| 3D view of a 15×40 ft shop: 20 racks                          | 343 page elements, 60 frames/s while turning (95th-percentile frame 16.8 ms) |

**Guidance:** any PC from the last 8 years with 4 GB RAM and Chrome or Edge runs the counter and
the 3D planner. The 3D view uses the graphics chip through the browser (no extra library). On
very old PCs (Celeron, 2 GB RAM, no graphics driver) switch on **Simple graphics** in the 3D view:
it drops the walls, animations and level labels. The 3D planner is an owner's tool used
occasionally; it never runs on the counter while selling. The server work (planning, alerts) is
milliseconds and does not need a stronger server.

## 7. Features the software owner switches (Task 3)

Super admin → Shops → a shop → **Plan and features**. Pick a plan, then switch single features
on or off for that shop and set their values. The shop owner can tune the values (for example
"not sold for 90 days") for features the shop has, from the Stock screen. Every change is
audited. Existing shops start on Pro, so nothing changes for them until you change it.

| Feature                        | Basic | Standard | Pro | Settings                                |
| ------------------------------ | :---: | :------: | :-: | --------------------------------------- |
| Dose timing                    |   ✓   |    ✓     |  ✓  |                                         |
| Fast scan receiving            |   ✓   |    ✓     |  ✓  | warn below N days of shelf life         |
| Low stock alerts               |   ✓   |    ✓     |  ✓  | judge sales over N days; keep N days    |
| Expiry alerts                  |   ✓   |    ✓     |  ✓  | expires within N days                   |
| Budget plan                    |       |    ✓     |  ✓  |                                         |
| Same-medicine alternatives     |       |    ✓     |  ✓  |                                         |
| Customer requests              |       |    ✓     |  ✓  | count over N days; show from N requests |
| Customer credit (khata)        |       |    ✓     |  ✓  |                                         |
| Several cash counters          |       |    ✓     |  ✓  |                                         |
| Stuck stock                    |       |    ✓     |  ✓  | not sold for N days                     |
| Purchase orders and order list |       |    ✓     |  ✓  |                                         |
| Shelf names and A to Z places  |       |    ✓     |  ✓  |                                         |
| Owner dashboard                |       |    ✓     |  ✓  |                                         |
| Sell near-expiry first         |       |          |  ✓  | expires within N days                   |
| 3D shop planner                |       |          |  ✓  |                                         |
| Owner assistant                |       |          |  ✓  |                                         |

A switched-off feature disappears from menus and screens, and the server refuses its routes
(`403 This feature is not switched on for your shop`), so hiding is not the only protection.

## 8. Inventory (Task 4) — what each request became

| Request                                   | Status                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| i. Blazing-fast entry by scanning         | **Built.** Stock → Receive stock: scan each pack; batch and expiry fill from the 2D code, price and supplier from last delivery; same batch again adds a pack. Typing still works.       |
| ii. Fast stock management                 | **Built in part:** alerts, order list and existing batch tools in one Stock screen. Stock-take by scanning is next (P1).                                                                 |
| iii. Placing new orders                   | **Built.** Order list groups low stock and customer requests by last supplier; one tap makes the purchase order; a printed sheet serves phone/WhatsApp ordering.                         |
| iv. Low stock                             | **Built**, from selling speed with adjustable days.                                                                                                                                      |
| v. Stuck stock (adjustable time)          | **Built**, with money tied up, last sale and nearest expiry.                                                                                                                             |
| vi. Expiry                                | **Built**: expired-but-on-shelf first, then soonest, with shelf and value; window adjustable.                                                                                            |
| vii. Medicines for future buying          | **Built** as Customer requests: one key at the counter, counted per person not per tap, report window and threshold adjustable, flows into the order list.                               |
| viii. Same-formulation offer when missing | **Built**, exact matching only (section 3).                                                                                                                                              |
| ix. Sell near-expiry first                | **Built**: "Sell first" badge at the counter within the shop's window, plus the Expiring list.                                                                                           |
| x. More                                   | Short-shelf-life warning on receiving, A to Z shelf place for new stock, unknown-barcode linking. Next: cost-change alerts, recall, scanned-batch selling, supplier returns (section 4). |

## 9. Shelves without drawing (Task 2)

Shelves → **List**: each rack with its label and name, number of levels and medicines per level;
each level with a short name ("Antibiotic syrups") and its A to Z range ("Augmentin → Calpol").
**Print shelf labels** prints big labels for every level. When new stock arrives with no shelf,
**Give it an A to Z place** finds the level whose names surround it and, if that level is full,
shifts only the last medicine along to the next level (the fewest moves that keep the shop in
order). Shops with Shelf names but not the 3D planner see only the List.
