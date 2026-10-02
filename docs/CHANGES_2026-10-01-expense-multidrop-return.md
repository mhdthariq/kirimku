# Multi Expense, Multi Drop, Delivery Approval, Resi Tugas Balik (2026-10-01)

Implements `Kirimku - Multi Expense, Multi Drop, dan Resi Tugas Balik Implementation Plan.md`, all 4 phases.
API paths use this project's prefix: `/api/v1/...` (the spec wrote `/api/...`).

## Before you run it
```
bun run db:push        # or: npx prisma migrate deploy   (new migration 20261001120000_...)
npx prisma generate
npx tsc --noEmit
```
The sandbox can't reach Prisma's binary host, so nothing here was type-checked or run against a database.
What was run: 86 unit tests (14 new, all of the business rules) and an esbuild syntax check of every new/changed file.
New permissions are added to the catalog automatically; if an existing role doesn't show them, tick them in the Access page.

## Phase 1 - Transport Expenses
- Model `TransportExpense` (`expenseCode` EXP-2026-xxxx, `type` BONGKAR/PARKIR/MAKAN/BBM, amount, description, optional `photoUrl`).
- `GET/POST /transports/:id/expenses`, `GET/PUT/DELETE /transports/:id/expenses/:expenseId`.
  Lists return `hasPhoto` instead of the image; `GET .../:expenseId` returns the photo.
- Any number of entries per type (3 BBM, 2 Parkir ...). Photo is optional (JPEG/PNG data URL, same limit as the check-in selfie).
- Permissions `transport.expense.view/create/update/delete`. Driver/kenek can only touch transports they are assigned to.
- UI: "Biaya Operasional" card on Transport Detail: total, 4 tiles (total + count per type), list, add/edit dialog with optional photo, delete confirm.

## Phase 2 - Multi Drop
- `Transport.transportMode` DIRECT (default, unchanged behavior) | MULTI_DROP. Set in the transport form (create only).
  Note: unrelated to a shipment's `fulfillmentMode = DIRECT`.
- `TransportShipment` gets `dropCheckpointId`, `dropStatus` (LOADED > AT_DROP_POINT > DROPPED > DELIVERY_PENDING > DELIVERY_APPROVED), `droppedAt/By`, `deliveryApprovedAt/By`.
- `GET /transports/:id/drops` (board: checkpoints, resi per drop point, progress).
- `POST /transports/:id/drops/:shipmentId` with `{action:"ASSIGN", dropCheckpointId}` (plan, needs `transport.create`, before unloading, not the start point)
  or `{action:"DROP"}` (crew or `transport.arrive`).
- Rules (spec section 11 kept separate): the vehicle must have **checked in at the resi's drop checkpoint** before it can be dropped.
  A check-in at a checkpoint moves the resi planned for it to AT_DROP_POINT. A drop moves the resi to the destination gudang side
  (same effect as arrival, for that one resi) and writes a tracking event.
- No drop checkpoint = the route's final checkpoint. When the transport arrives, whatever is still on board becomes DROPPED automatically,
  and resi already dropped earlier are not processed twice (arrive route and final check-in both skip them).

## Phase 3 - Delivery Approval
- `POST /transports/:id/drops/:shipmentId/approve` - only the destination gudang's admin (or owner) can approve; the resi must be DROPPED.
- `POST /transports/:id/delivery-approval` - approves the whole transport; every resi must already be approved. Stamps the transport (= vehicle empty).
- Permissions `transport.delivery.view/approve`. Works for DIRECT transports too (resi become DROPPED on arrival).

## Phase 4 - Resi Tugas Balik
- Model `ReturnTask` (RTN-2026-xxxx) CREATED > APPROVED > PLANNED > DEPARTED > ARRIVED (CANCELLED reserved).
- `POST /transports/:id/return-task` (only after transport delivery approval, one active per transport),
  `GET /return-tasks`, `GET /return-tasks/:id`, `POST /return-tasks/:id/approve`, `POST /return-tasks/:id/create-transport`.
- Create-transport builds a new Route with the outbound checkpoints in reverse order (Brandan > Stabat > Binjai > Medan), same vehicle/driver/kenek, no resi, status PLANNED.
  PLANNED/DEPARTED/ARRIVED of the return transport are synced back onto the ReturnTask (depart, check-in arrival and manual arrive all do it).
- UI: new page **Tugas Balik** (real route `/return-tasks`, in the sidebar): status filter, Approve, Buat Transport. The button "Buat Resi Tugas Balik" is on Transport Detail.
- Permissions `return-task.view/create/approve`.

## Where the code is
- Rules (pure, tested): `src/lib/transport-ops.ts`, `transport-ops.test.ts`. Server helpers: `src/lib/transport-ops-server.ts`.
- UI: `transport-expenses-panel.tsx`, `transport-drops-panel.tsx`, `pages/return-tasks-page.tsx`.

## Decisions to confirm
- Approving a resi is limited to the destination gudang's admin or owner (spec says "Destination Admin Approval").
- The separate existing Admin Gudang arrival scan is untouched; approval is an additional step that frees the vehicle.
- Not built (not in the spec): cancelling a return task, demo seed data, expense totals inside the settlement calculation.
