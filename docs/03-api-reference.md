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

The **owner** user short-circuits RBAC (`permissions: ["*"]`). All other users get the union of their roles' permission slugs (62 slugs — see `src/lib/rbac.ts`).

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
| GET | `/options` | any authenticated | Lookup lists: gudang, vehicles, routes, customers, tariffs, kurir/drivers/kenek (employees), **permissions catalog** (full 62-slug list, powers the role editor) |

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
| GET | `/shipments` | `shipment.view` | List + `?status`, `?q`, `?customerId`, `?unpaid` — every row also carries **`totals {totalPackages, totalActualKg, totalVolumeM3}`** (Revision 4: Volume + Berat columns) and the penerima fields |
| POST | `/shipments` | `shipment.create` | `{customerId, tariffId, originWarehouseId?, destinationWarehouseId?, penerimaName?, penerimaAddress?, penerimaContact?}` — **tariffId** from the route dropdown (filtered by customer B2B/B2C); origin/destination auto-filled from the tariff and `tariffId` stored on the shipment. Penerima (recipient) is printed on both resi types. Legacy `{origin, destination}` still accepted. → code `MKT-000NNN` + resi + tracking `CREATED` |
| GET | `/shipments/{id}` | `shipment.view` | Full detail (customer, gudang, tariff, pricing, counts, latest payment) **+ `pricingPreview`** (server-computed actual/volumetric/chargeable kg, multiplier, estimation), **+ `totals`**, **+ `paymentSummary`** (paid/remaining/DP status) |
| PUT | `/shipments/{id}` | `shipment.update` | Update master fields (while editable) — accepts `tariffId` to change the route, and `penerimaName/penerimaAddress/penerimaContact` |
| DELETE | `/shipments/{id}` | `shipment.delete` | Delete (cascades details/tracking) |
| POST | `/shipments/{id}/ready` | `shipment.update` ∥ `pickup.create` | `CREATED → READY_FOR_PICKUP`. **Gates (Revision 4):** 422 if the price has not been counted, 422 if Penerima is empty (it is printed on the resi). After success the UI opens the Resi print preview (Shipment Resi + Detail Resi) |
| POST | `/shipments/{id}/cancel` | `shipment.cancel` | Any non-terminal → `CANCELLED`; the UI always asks for confirmation first (Revision 4) |
| GET | `/shipments/{id}/tracking` | `shipment.view_tracking` | Tracking timeline (events + actors, newest first) |
| GET | `/shipments/{id}/details` | `shipment_detail.view` | Package rows (one row per package) |
| POST | `/shipments/{id}/price` | `shipment.update` | Compute pricing from tariff + packages → sets CW, rate, amount, `pricedAt`. **Recomputable** while `CREATED/READY_FOR_PICKUP/PICKED_UP` (fixes previously wrong numbers) |

**Pricing logic** (also exposed in `05-business-flows.md`): volumetric weight per package = `L×W×H / 1.000.000 × volumetricMultiplier` (kg/m³, configurable per tariff — Revision 3); chargeable weight = max(actual, volumetric) summed, floored at `minChargeableKg`, rounded per tariff (`UP`/`NEAREST` by `roundingUnitKg`); tariff resolved from `MasterShipment.tariffId` (route dropdown) or matched by origin/destination/customerType; `priceAmount = CW × ratePerKg`.

## Shipment details (packages)

**Revision 3 — one row per package:** `POST /shipments/{id}/details` accepts `{description, quantity (1–500), lengthCm?, widthCm?, heightCm?, actualWeightKg}` and expands `quantity N` into **N package rows**, each with a unique `detailCode` (`DTL-…-01 … -NN`). Response: `{created: N, details: [...]}`. There is no per-row quantity — the grouped ("Ringkas") view in the UI is pure aggregation.

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| PUT | `/shipment-details/{id}` | `shipment_detail.update` | Update one package row (description/dims/weight) |
| DELETE | `/shipment-details/{id}` | `shipment_detail.delete` | Remove one package (rows are created via `POST /shipments/{id}/details`) |

## Pickups

Kurir executor mode: `GET /pickups?mine=true` returns only tasks assigned to the logged-in kurir — the Pickups page applies this automatically for users without `pickup.assign_kurir`.

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/pickups` | `pickup.view` | List + `?status`, `?mine=true`, `?search`; rows include `detailsCount` + `scannedCount` |
| GET | `/pickups/{id}` | `pickup.view` | Pickup + master details + scan log + `progress {total, scanned, allScanned, details[]}` |
| POST | `/pickups` | `pickup.create` | `{masterId, kurirId?, notes?}` → code `PICK-YYYY-…`; shipment must be `READY_FOR_PICKUP` |
| PUT | `/pickups/{id}` | `pickup.assign_kurir` | Reassign kurir / update notes |
| POST | `/pickups/{id}/scans` | `pickup.scan` | `{payload, method?}` — QR handover scan. `method`: `SCANNED` (camera / reader tool) or `TYPED` (manual input) — recorded on every scan and shown in Riwayat Scan. Matches payload against detail codes: `ok` marks the package scanned, `duplicate` re-scan, `unexpected` unknown QR. Only the assigned kurir (or assigner/owner) may scan. Returns `{scan, message, progress}` — messages never echo the code back (anti copy-paste) |
| POST | `/pickups/{id}/confirm` | `pickup.confirm` | **Requires every package scanned** AND **DP ≥ 50% paid**; `{notes?, payment?: {method, amount, reference?}}` — the optional `payment` records the remaining balance collected by the kurir at pickup → pickup `COMPLETED`, shipment `PICKED_UP`, tracking `Picked-up by [Kurir Name] — sisa CASH Rp… diterima kurir` |
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
| GET | `/transports` | `transport.view` | List + `?status`, `?vehicleId`, `?q` (includes shipments per transport) |
| POST | `/transports` | `transport.create` | `{routeId, vehicleId, driverId?, kenekId?, shipmentIds[]}` → code `TRP-YYYY-…`; vehicle must be `ACTIVE` |
| PUT | `/transports/{id}` | `transport.create` | Update while `PLANNED` (reassign vehicle/route/shipments) |
| POST | `/transports/{id}/depart` | `transport.depart` | `PLANNED → DEPARTED`: marks carried shipments `IN_TRANSPORT`, records `departedAt` |
| POST | `/transports/{id}/arrive` | `transport.arrive` | `DEPARTED → ARRIVED`: shipments → `ARRIVED_AT_GUDANG`, records `arrivedAt` |
| DELETE | `/transports/{id}` | `transport.create` | Cancel while `PLANNED` (detaches shipments) |

## Vehicles

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/vehicles` | `vehicle.view` | List + `?status`, `?q` (includes current crew assignment) |
| POST | `/vehicles` | `vehicle.create` | `{vehicleNumber, name?, maxWeightKg, maxVolumeM3, status?, notes?}` |
| PUT | `/vehicles/{id}` | `vehicle.update` | Update fields/status |

## Gudang operations (arrival workspace)

`GET /gudang` — the workspace behind the "Gudang" menu (between Pickups and Shipments). Guard: `shipment.view`. Response:

- `scope` — `{warehouseId, warehouseName, scoped}`: `scoped=true` for users holding `warehouse.scope_own` (staff gudang, see `Employee.warehouseId`) — their view is filtered to their own gudang
- `arrivals[]` — shipments with status `PICKED_UP` a kurir is bringing back to the gudang: masterCode, customer, route, price/paid/remaining (`dpOk`), packages count, `scannedCount` + `scannedByMethod {SCANNED, TYPED}`, kurir name
- `walkIns[]` — shipments `CREATED`/`READY_FOR_PICKUP` a customer can hand over directly at the counter
- `warehouses[]` — per-gudang contents: `heldShipments`, `heldPackages`, `heldWeightKg`, `unpaidCount`, `customerSupportContact` + the shipments currently held (origin-stage & destination-stage)

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/gudang` | `shipment.view` | Workspace feed described above (warehouse-scoped for staff gudang) |
| GET | `/shipments/{id}/arrival-scans` | `shipment.view` | Arrival scan progress for a shipment (gudang_arrival context) — includes per-package `scanMethod` |
| POST | `/shipments/{id}/arrival-scans` | `shipment.confirm_arrival` | `{payload, method?}` — one package scan while the kurir drops off picked-up packages. Shipment must be `PICKED_UP`. Codes never echoed back |
| POST | `/shipments/{id}/arrival-scan-all` | `shipment.confirm_arrival` | **Scan-Semua**: bulk-marks every not-yet-scanned package as `SCANNED` (reader batch mode) → `{created, progress, message}` |
| POST | `/shipments/{id}/arrive` | `shipment.confirm_arrival` | `{warehouseId, mode: "scan" \| "walk_in", notes?}` — confirm Tiba di Gudang. `scan` mode requires `PICKED_UP` + all packages scanned; `walk_in` (customer at the counter, no scan) works straight from `CREATED`/`READY_FOR_PICKUP` → `RECEIVED_AT_GUDANG`, stamps `arrivedWarehouseId` |
| POST | `/shipments/{id}/notify-marketing` | `shipment.notify_marketing` | `{note?}` — gudang tells marketing an unpaid shipment is sitting at the gudang (tracking event + audit) |

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
| POST | `/tariffs` | `tariff.create` | `{origin, destination, customerType?, ratePerKg, minChargeableKg?, volumetricMultiplier?, roundingMode?, roundingUnitKg?, effectiveFrom}` |
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
