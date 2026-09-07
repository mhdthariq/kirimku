# 03 — API Reference

All endpoints live under **`/api/v1`** and are implemented as Next.js Route Handlers (`src/app/api/v1/**/route.ts`).

## Conventions

### Base URL

```
http://localhost:3000/api/v1
```

### Response envelope

Every endpoint returns a consistent JSON envelope:

```jsonc
// success
{ "data": <payload> }

// failure
{ "error": { "code": "NOT_FOUND", "message": "Shipment MKT-999999 not found" } }
```

| Error code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing/invalid/expired bearer token |
| `FORBIDDEN` | 403 | Authenticated, but lacks the required permission slug |
| `NOT_FOUND` | 404 | Entity doesn't exist |
| `VALIDATION` | 400 | Body failed Zod validation (message lists the field) |
| `CONFLICT` | 409 | Illegal state transition, duplicate, or business-rule violation |
| `SERVER_ERROR` | 500 | Unexpected failure |

### Authentication

Login issues a **bearer token** (random 32-byte hex, stored in `SessionToken`, valid **12 hours**):

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"owner","password":"ChangeMeOwner#2026"}'
# → { "data": { "token":"a1b2…", "expiresAt":"…", "user": {…, "permissions":["*"] } } }
```

Attach it to every request: `Authorization: Bearer <token>`.

The **owner** user short-circuits RBAC (`permissions: ["*"]`). All other users get the union of their roles' permission slugs (63 slugs — see `src/lib/rbac.ts`).

### Query conventions

- Lists accept `?page=1&pageSize=20` (default 20) and return `{ items, total, page, pageSize }` inside `data`.
- Optional filters are documented per endpoint (e.g. `?status=…`, `?q=…`, `?entityType=…`).
- All mutating endpoints append an `AuditLog` row automatically.

### Auto-seed

The first request after a fresh `db:push` triggers `ensureSeed()` (RBAC + demo dataset) before the handler runs — so login works immediately after boot, mirroring a Docker "migrate + seed" entrypoint.

---

## Auth

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| POST | `/auth/login` | — | `{username, password}` → token + user (with permissions) |
| POST | `/auth/logout` | — | Invalidates the current token |
| GET | `/auth/me` | — | Current user profile + roles + permissions |

## Dashboard

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/dashboard` | any authenticated | Stats (counts by status, revenue, unpaid), 14-day creation chart, recent activity |

## Options (dropdown feeds)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/options` | any authenticated | Lookup lists: gudang, vehicles, routes, customers, tariffs, kurir/drivers/kenek (employees), **permissions catalog** (full 63-slug list, powers the role editor) |

## Customers

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/customers` | `customer.view` | List + filter `?q`, `?type=b2b|b2c`, `?active=true` |
| POST | `/customers` | `customer.create` | `{name, type, companyName?, phone?, email?, address?}` → auto code `CUS-000NNN` |
| GET | `/customers/{id}` | `customer.view` | Detail |
| PUT | `/customers/{id}` | `customer.update` | Update fields |
| DELETE | `/customers/{id}` | `customer.delete` | Soft-delete (deactivate) if referenced, hard delete otherwise |

## Shipments

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/shipments` | `shipment.view` | List + `?status`, `?q`, `?customerId`, `?unpaid` |
| POST | `/shipments` | `shipment.create` | `{customerId, origin, destination, originWarehouseId?, destinationWarehouseId?, notes?}` → code `MKT-000NNN` + resi + tracking `CREATED` |
| GET | `/shipments/{id}` | `shipment.view` | Full detail (customer, gudang, pricing, counts, latest payment) |
| PUT | `/shipments/{id}` | `shipment.update` | Update master fields (while editable) |
| DELETE | `/shipments/{id}` | `shipment.delete` | Delete (cascades details/tracking) |
| POST | `/shipments/{id}/ready` | `shipment.update` | `CREATED → READY_FOR_PICKUP` |
| POST | `/shipments/{id}/cancel` | `shipment.cancel` | Any non-terminal → `CANCELLED` (blocked if priced & paid) |
| GET | `/shipments/{id}/tracking` | `shipment.view_tracking` | Tracking timeline (events + actors, newest first) |
| GET | `/shipments/{id}/details` | `shipment_detail.view` | Detail items |
| POST | `/shipments/{id}/price` | `shipment.update` | Compute pricing from tariff + details → sets CW, rate, amount, `pricedAt` |

**Pricing logic** (also exposed in `05-business-flows.md`): volumetric weight per detail = `L×W×H / volumetricDivisor`; chargeable weight = max(actual, volumetric) summed, floored at `minChargeableKg`, rounded per tariff (`UP`/`NEAREST` by `roundingUnitKg`); rate matched by origin/destination/customerType; `priceAmount = CW × ratePerKg`.

## Shipment details (items)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| PUT | `/shipment-details/{id}` | `shipment_detail.update` | Update description/qty/dims/weight |
| DELETE | `/shipment-details/{id}` | `shipment_detail.delete` | Remove item (new detail rows are created via `POST /shipments/{id}/details` — see shipments table above; line items live with their shipment) |

## Pickups

Kurir executor mode: `GET /pickups?mine=true` returns only tasks assigned to the logged-in kurir — the Pickups page applies this automatically for users without `pickup.assign_kurir`.

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/pickups` | `pickup.view` | List + `?status`, `?mine=true`, `?search`; rows include `detailsCount` + `scannedCount` |
| GET | `/pickups/{id}` | `pickup.view` | Pickup + master details + scan log + `progress {total, scanned, allScanned, details[]}` |
| POST | `/pickups` | `pickup.create` | `{masterId, kurirId?, notes?}` → code `PICK-YYYY-…`; shipment must be `READY_FOR_PICKUP` |
| PUT | `/pickups/{id}` | `pickup.assign_kurir` | Reassign kurir / update notes |
| POST | `/pickups/{id}/scans` | `pickup.scan` | `{payload}` — QR handover scan. Matches payload against detail codes: `ok` marks the package scanned, `duplicate` re-scan, `unexpected` unknown QR. Only the assigned kurir (or assigner/owner) may scan. Returns `{scan, message, progress}` |
| POST | `/pickups/{id}/confirm` | `pickup.confirm` | **Requires every package scanned** (`progress.allScanned`); `{notes?}` → pickup `COMPLETED`, shipment `PICKED_UP`, tracking shows `Picked-up by [Kurir Name]` |
| DELETE | `/pickups/{id}` | `pickup.view` (owner/assigner) | Cancel pickup while `ASSIGNED` |

## Deliveries

Same executor mode: `GET /deliveries?mine=true` filters to the logged-in kurir. Every row embeds its `details[]` (detail barang) with per-package `scanned` state, plus `allScanned`.

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/deliveries` | `delivery.view` | List + `?status`, `?mine=true`, `?search`; rows include `details[]`, `scannedCount`, `allScanned` |
| GET | `/deliveries/{id}` | `delivery.view` | Delivery + master details + scan log + `progress` (same shape as pickups) |
| POST | `/deliveries` | `delivery.assign_kurir` | `{masterId, kurirId?, notes?}` → code `DLV-YYYY-…`; shipment must be `ARRIVED_AT_GUDANG`/`RECEIVED_AT_GUDANG` |
| PUT | `/deliveries/{id}` | `delivery.assign_kurir` | Reassign kurir |
| POST | `/deliveries/{id}/scans` | `delivery.scan` | `{payload}` — QR scan at handover to customer. Same matching rules as pickups; only assigned kurir (or assigner/owner) |
| POST | `/deliveries/{id}/complete` | `delivery.confirm` | **Requires every package scanned** + `{proofOfDelivery}` (receiver name); → delivery `COMPLETED`, shipment `DELIVERED`, tracking `Delivered to [Customer] by [Kurir Name] — received by: [PoD]` |
| DELETE | `/deliveries/{id}` | — | Cancel while `ASSIGNED` |

## Transports (linehaul)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/transports` | `transport.view` | List + `?status`, `?search` — each row embeds `shipments[]` (code, customer, destination, chargeable kg), `summary` (shipmentCount, totalPieces, totalActualWeightKg, totalChargeableWeightKg) and `progress` (passed/total checkpoints, last position record time) |
| POST | `/transports` | `transport.create` | `{routeId, vehicleId, driverId?, kenekId?, shipmentIds[]}` → code `TRP-YYYY-…`; vehicle must be `ACTIVE` |
| GET | `/transports/{id}` | `transport.view` | **Detail**: route + checkpoints (with `passed` flags & times), vehicle (incl. capacity), kru, per-shipment load (pieces, actual/volumetric/chargeable kg, price), `summary` (incl. totalValueRp, totalVolumeM3), `progress` (`passedCheckpoints`, `nextCheckpoint`, `currentPosition` {lat,lng,label,kind,recordedAt}), `checkpointRecords[]` (position history) |
| PUT | `/transports/{id}` | `transport.create` | Update while `PLANNED` (reassign vehicle/route/shipments) |
| POST | `/transports/{id}/depart` | `transport.depart` | `PLANNED → DEPARTED`: marks carried shipments `IN_TRANSPORT`, records `departedAt`, and auto-records the **origin checkpoint** as passed (position tracking starts from a known point) |
| POST | `/transports/{id}/arrive` | `transport.arrive` | `DEPARTED → ARRIVED`: shipments → `ARRIVED_AT_GUDANG`, records `arrivedAt`, and auto-records the **destination checkpoint** (unless already recorded) |
| POST | `/transports/{id}/checkpoints` | `transport.record_checkpoint` | **Record where the vehicle is** (only while `DEPARTED`). Body: `{checkpointId}` (check-in at a route checkpoint) or `{latitude, longitude}` (manual/GPS — snapped to the nearest checkpoint, `withinRadius` computed via haversine vs. checkpoint radius). Duplicate passed-checkpoint → 422; out-of-radius GPS pings are always allowed (breadcrumbs). Every carried shipment gets a `CHECKPOINT_REACHED` tracking event; audit action `checkpoint_record` |
| DELETE | `/transports/{id}` | `transport.create` | Cancel while `PLANNED` (detaches shipments) |

Transport position rules (`currentPosition`):

| Transport status | Position shown |
|---|---|
| `PLANNED` | Origin checkpoint — "Belum berangkat" |
| `DEPARTED` + records | Latest `CheckpointRecord` ("Melewati X — menuju Y" / GPS breadcrumb) |
| `DEPARTED` no records | Origin checkpoint — fallback |
| `ARRIVED` | Destination checkpoint — "Tiba di tujuan" |

## Vehicles

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/vehicles` | `vehicle.view` | List + `?status`, `?q` (includes current crew assignment) |
| POST | `/vehicles` | `vehicle.create` | `{vehicleNumber, name?, maxWeightKg, maxVolumeM3, status?, notes?}` |
| PUT | `/vehicles/{id}` | `vehicle.update` | Update fields/status |

## Gudang (warehouses) — no "type" field

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/warehouses` | `warehouse.view` | List + `?q`, `?active` |
| POST | `/warehouses` | `warehouse.create` | `{name, city?, address?, latitude?, longitude?, notes?}` → code `WH-000NNN` |
| GET | `/warehouses/{id}` | `warehouse.view` | Detail |
| PUT | `/warehouses/{id}` | `warehouse.update` | Update fields |
| DELETE | `/warehouses/{id}` | `warehouse.delete` | Deactivate if referenced by shipments, delete otherwise |

## Routes & checkpoints

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/routes` | `checkpoint.view` | Routes with their checkpoints (ordered by `sequence`) |
| POST | `/routes` | `checkpoint.create` | `{name, origin?, destination?}` — route must be saved before checkpoints |
| PUT | `/routes/{id}` | `checkpoint.update` | Update route info |
| DELETE | `/routes/{id}` | `checkpoint.delete` | Delete route (cascades checkpoints) |
| GET | `/routes/{id}/checkpoints` | `checkpoint.view` | Checkpoint list for the route |
| POST | `/routes/{id}/checkpoints` | `checkpoint.create` | Create checkpoint `{name, latitude, longitude, radiusMeters, sequence?}` |
| PUT | `/checkpoints/{id}` | `checkpoint.update` | Move/rename/resize/resequence a checkpoint |
| DELETE | `/checkpoints/{id}` | `checkpoint.delete` | Delete (API rejects if the route would drop **below 3** active checkpoints) |

**Minimum-3 rule:** `MIN_CHECKPOINTS = 3` (`src/lib/shipment-flow.ts`) is enforced in the editor (`docs/04-frontend.md`) and in the API — creating a route with fewer than 3 checkpoints fails with `CONFLICT`; deletes that would break the floor are rejected.

## Tariffs

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/tariffs` | `tariff.view` | List + `?origin`, `?destination`, `?customerType`, `?active` |
| POST | `/tariffs` | `tariff.create` | `{origin, destination, customerType?, ratePerKg, minChargeableKg?, volumetricDivisor?, roundingMode?, roundingUnitKg?, effectiveFrom}` |
| PUT | `/tariffs/{id}` | `tariff.update` | Update / deactivate (`effectiveTo`) |

## Payments

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/shipments/{id}/payments` | `payment.view` | Payments for a shipment |
| POST | `/shipments/{id}/payments` | `payment.record` | `{method, amount, reference?}` → status `RECORDED` |
| POST | `/payments/{id}/verify` | `payment.verify` | `RECORDED → VERIFIED` |
| POST | `/payments/{id}/reject` | `payment.verify` | `RECORDED → REJECTED` |
| GET | `/unpaid` | `payment.unpaid.view` | Unpaid **b2c** shipments + outstanding amounts |

## Invoices (b2b)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/invoices` | `invoice.view` | List + `?status`, `?customerId` (includes totals) |
| POST | `/invoices` | `invoice.create` | `{customerId, issueDate?, dueDate?, notes?, lines[]}` → `INV-YYYY-000NNN` (DRAFT) |
| GET | `/invoices/{id}` | `invoice.view` | Detail with lines + settlements |
| PUT | `/invoices/{id}` | `invoice.update` | Update while DRAFT (header or lines) |
| POST | `/invoices/{id}/lines` | `invoice.update` | Add line `{description, quantity, unitPrice}` |
| PUT | `/invoice-lines/{id}` | `invoice.update` | Edit a line |
| DELETE | `/invoice-lines/{id}` | `invoice.update` | Remove a line |
| POST | `/invoices/{id}/send` | `invoice.send` | `DRAFT → SENT` (locks editing, sets issue/due dates) |
| POST | `/invoices/{id}/settlements` | `invoice.update` | Record payment `{amount, method, reference?}` → status auto-moves `SENT → PARTIALLY_SETTLED → SETTLED` |

## Access control

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/employees` | `employee.view` | List + `?q`, `?active` |
| POST | `/employees` | `employee.create` | `{name, position?, phone?}` → `EMP-000NNN` |
| PUT | `/employees/{id}` | `employee.update` | Update / disable |
| GET | `/users` | `user.view` | Users with roles |
| POST | `/users` | `user.create` | `{username, name, password, employeeId?, roleIds[]}` |
| PUT | `/users/{id}` | `user.update` | Update profile / roles / active |
| GET | `/roles` | `role.view` | Roles + permission counts |
| POST | `/roles` | `role.create` | `{slug?, name, description?, permissionSlugs[]}` |
| PUT | `/roles/{id}` | `role.update` | Update name/description/permissions. **System roles: owner-only, permissions editable, name/slug locked** — no need to create a new role just to change capabilities |
| PUT | `/roles/{id}/permissions` | `role.update` | Replace the full permission set (same owner-only rule for system roles) |
| DELETE | `/roles/{id}` | `role.delete` | Delete non-system roles |
| GET | `/roles/{id}/permissions` | `role.view` | Full permission slugs of a role |

## Audit logs

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/audit-logs` | `audit_log.view` | Paginated timeline + `?entityType=` (per-menu views), `?actorId=`, `?action=`, `?q=`, `?from=`, `?to=` |

---

## Try it (bash)

```bash
BASE=http://localhost:3000/api/v1

# login and capture token
TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"username":"owner","password":"ChangeMeOwner#2026"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
AUTH="Authorization: Bearer $TOKEN"

# dashboard stats
curl -s "$BASE/dashboard" -H "$AUTH"

# create a customer
curl -s -X POST "$BASE/customers" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"PT Contoh Baru","type":"b2b","city":"Semarang"}'

# per-menu audit view (gudang only)
curl -s "$BASE/audit-logs?entityType=warehouse" -H "$AUTH" | head -c 600
```
