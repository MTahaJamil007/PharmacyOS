# Multi-counter and shop-workstation plan

**Status:** design proposal for the next shop-planning increment. The current checkout already
supports an order desk handing work to branch-local cashier terminals. This document plans the
physical workstation layout and the production checks needed before expanding that flow.

## Shop layout

The layout editor should represent workstations as named, movable floor objects:

- One or more **Order desk** stations, each optionally linked to an active `ORDER_TAKER` terminal.
  The station marks the PC, operator side, and customer side so the walk-path view can assess
  queueing and access to the entrance.
- One or more **Cash counter** stations, each linked to a `CASHIER` terminal and labeled with its
  terminal name. The physical station includes the cashier PC, drawer, receipt printer, and a
  medicine handoff surface. Each station remains a separate cash-session and audit boundary.
- The existing general shop counter remains available for layouts that do not link stations to
  terminals. Existing saved plans must open unchanged and receive a default station derived from
  their current counter footprint.

For the requested setup, the owner can place one order desk PC and two or more cashier stations.
The order taker creates a draft and sends it to the shared branch queue; a cashier claims it,
collects payment, finalizes the sale, and prints the customer invoice. A bill is claimed by one
cashier at a time. If that terminal goes away, the claim expires and another cashier can recover
the bill. The database remains the source of truth; the queue must not depend on one browser or
PC staying open.

## Data and rollout design

1. Add a versioned workstation collection to the shelf-planning model, with stable IDs, station
   kind, label, terminal link, position, footprint, and rotation. Keep it separate from medicine
   fixtures and inventory shelf locations. Validate that terminal links belong to the same branch
   and have the matching terminal type.
2. Backfill the current single counter into a default station while retaining the legacy floor
   counter until all clients and saved layouts have migrated. Use a new immutable database
   migration; never rewrite an applied migration.
3. Update the 2D and 3D editors together: create, select, move, rotate, duplicate, rename, link,
   and remove stations. Show the order desk and each cashier position in the walk-path analysis.
   Unlinking a station must not disable its terminal or affect transactions.
4. Keep order routing and till ownership explicit. An order desk can select a cashier or send to
   any cashier. The server validates branch and terminal type, prevents simultaneous claims, and
   records the creating terminal, claiming terminal, cashier, and cash session on every sale.
5. Roll out to one test branch first. Verify two cashiers claim separate bills concurrently, one
   bill cannot be finalized twice, abandoned claims recover, a cashier PC restart preserves the
   queue, and receipt/drawer hardware maps to the linked terminal. Keep a rollback that opens the
   old single-counter layout without dropping station links.

## 3D controls and computer requirements

The shop preview uses HTML elements and CSS 3D transforms, not a continuously rendered 3D engine.
It draws the scene when the layout or camera changes. The updated controls provide a clear
turn/move drag mode, camera tilt slider, pan buttons, zoom, and saved simple-graphics preference;
the view can be used without a mouse wheel or right mouse button.

The application does not currently collect performance telemetry, so the following are planning
estimates, not benchmark results. A scene with roughly 50–100 fixtures and 5–10 shelf levels per
fixture can create about 1,000–3,000 browser elements, including faces and level controls. That is
normally a light workload for a recent office PC with 8 GB RAM and integrated graphics. A small
LAN host running PostgreSQL and the API should start at 4 CPU cores and 8 GB RAM for a single
branch; 8 cores and 16 GB gives more headroom for backups and reporting. The order desk and each
cashier PC do not need a dedicated GPU; 2 CPU cores, 4 GB RAM, and a current browser are a
reasonable floor, while 8 GB is recommended when the browser shares the PC with other work.

The amount of compute does not grow much just because there are two cashier PCs: the browser work
is split across those PCs, while the server handles their database requests. More terminals do
increase simultaneous database connections and queue refresh traffic. Before production sizing,
benchmark the largest imported layout on the actual counter PCs, measure browser memory and frame
rate while dragging, and run a two-cashier load test against the deployment database. A useful
acceptance target is 30 frames/second while moving a representative layout, under 500 MB of tab
memory, and a p95 queue refresh below one second on the shop LAN. Adjust the scene detail and
connection pool from measured results.
