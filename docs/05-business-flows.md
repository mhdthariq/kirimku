# 05 — Business Flows

## Shipment lifecycle (state machine)

Defined once in `src/lib/shipment-flow.ts` and enforced by the API **and** rendered by the UI (status chips, enabled/disabled actions).

```
CREATED ──► READY_FOR_PICKUP ──► PICKED_UP ──► RECEIVED_AT_GUDANG ──► IN_TRANSPORT
   │              │                  │                │                   │
   └──► CANCELLED ◄┴──────────────────┴────────────────┴──────────────────┘
                                                                        
IN_TRANSPORT ──► ARRIVED_AT_GUDANG ──► DELIVERED   (terminal)
```

| Status | Meaning | Who moves it forward |
|---|---|---|
| `CREATED` | Booking exists (marketing) | `POST /shipments/{id}/ready` |
| `READY_FOR_PICKUP` | Waiting for kurir assignment | `POST /pickups` (assign) |
| `PICKED_UP` | Kurir confirmed handover | `POST /pickups/{id}/confirm` |
| `RECEIVED_AT_GUDANG` | Goods scanned into origin gudang | gudang staff (tracking event) |
| `IN_TRANSPORT` | Loaded on a linehaul transport | `POST /transports/{id}/depart` |
| `ARRIVED_AT_GUDANG` | Transport arrived at destination | `POST /transports/{id}/arrive` |
| `DELIVERED` | Last-mile delivery completed | `POST /deliveries/{id}/complete` |
| `CANCELLED` | Cancelled (blocked once priced & paid) | `POST /shipments/{id}/cancel` |

Every transition appends a `TrackingEvent` (with the acting user) and an `AuditLog` entry — the tracking timeline and audit trail are always in sync with the state machine.

## End-to-end operational flow

```
1. CREATE        Marketing creates shipment + items (detail shipments)
2. READY         Mark READY_FOR_PICKUP
3. PICKUP        Assign kurir → kurir QR-scans every package → confirm pickup (tracking: "Picked-up by [Kurir]")
4. GUDANG IN     Received at origin gudang; price computed from tariff
5. TRANSPORT     Admin gudang builds transport (route + vehicle + crew + shipments) → depart
6. CHECKPOINTS   (future: geo check-ins recorded as CheckpointRecord, withinRadius flag)
7. GUDANG OUT    Transport arrives at destination gudang → ARRIVED_AT_GUDANG
8. DELIVERY      Assign kurir → kurir QR-scans all packages → complete with proof of delivery
9. SETTLE        Payment verified (b2c) or invoice settled (b2b)
```

## Pricing flow

`POST /shipments/{id}/price` snapshots a price onto the shipment:

1. **Tariff lookup** — the tariff selected at creation (`MasterShipment.tariffId`, set from the route dropdown) is used when active; otherwise exact match on `origin + destination + customerType` (b2b/b2c); `null` customerType matches all. Most specific active tariff within its effective window wins.
2. **Volumetric weight** per package: `lengthCm × widthCm × heightCm / 1.000.000 × volumetricMultiplier` (multiplier = kg per m³, configurable per tariff, e.g. 250). *(Revision 3: the old fixed `volumetricDivisor` 6000 was replaced by this configurable multiplier.)*
3. **Chargeable weight (CW)**: `max(actualWeight, volumetric)` summed over all package rows, floored at `minChargeableKg`, rounded per `roundingMode` (`UP`/`NEAREST`) in steps of `roundingUnitKg`.
4. **Amount**: `CW × ratePerKg` → stored as `priceAmount` with `pricedAt` timestamp.

A **server-computed preview** (`pricingPreview` block in `GET /shipments/{id}`) exposes actual/volumetric/chargeable kg + the multiplier used, so the client UI never hardcodes the formula. Pricing can be recomputed (`Hitung Ulang Harga`) while status is `CREATED / READY_FOR_PICKUP / PICKED_UP`.

## Detail barang (package) model — Revision 3

- One `DetailShipment` row = **one physical package** with its own unique `detailCode` (QR label). The create dialog's "Jumlah paket" N expands into N rows (`DTL-…-01 … DTL-…-NN`). There is **no `quantity` column** in the database — the quantity shown anywhere in the UI is a pure aggregation.
- The shipment detail page shows **two tabs**: `Semua` (every package: Kode | Deskripsi | Dimensi | Berat) and `Ringkas` (grouped by identical description + dimensions + weight: Deskripsi | Dimensi | Jumlah | Berat per paket | Total berat).
- Shipment creation no longer types Kota Asal/Kota Tujuan by hand: a **route dropdown lists active tariffs filtered by the customer's B2B/B2C label** (plus generic tariffs); origin/destination are filled from the selected tariff.

Once priced, the shipment can collect payments; cancelling a priced-and-paid shipment is blocked (`CONFLICT`).

## Payment flow

```
record (kurir/admin)  ──►  RECORDED ──verify──► VERIFIED
                                    └─reject──► REJECTED
```

- Recorded at pickup (COD) or anytime by admin kantor; methods: `CASH` / `TRANSFER` + free-text reference.
- Verification (`payment.verify`) is separated from recording — dual control.
- `GET /unpaid` lists b2c shipments with outstanding balance (priced amount minus verified payments).

## Invoice flow (b2b only)

```
DRAFT ──send──► SENT ──settlements──► PARTIALLY_SETTLED ──fully paid──► SETTLED
  │                                      
  └──── (any pre-SENT) CANCELLED
```

- Created for a b2b customer with line items (typically referencing shipment codes/descriptions and amounts).
- `send` locks the draft, stamps issue + due dates.
- Each settlement records `{amount, method, reference}`; status auto-advances to `PARTIALLY_SETTLED` and then `SETTLED` when the settled total covers the invoice total.

## Transport flow

```
PLANNED ──depart──► DEPARTED ──arrive──► ARRIVED      (CANCELLED only from PLANNED)
```

- A transport bundles: **route** (with its checkpoints), **vehicle** (must be `ACTIVE`), **crew** (driver + optional kenek, from employees), and **shipments** (M:N).
- `depart` stamps `departedAt` and flips every carried shipment to `IN_TRANSPORT`.
- `arrive` stamps `arrivedAt` and flips shipments to `ARRIVED_AT_GUDANG` — which unlocks delivery assignment.

## Checkpoint rule (requirement #10)

- A route **must have ≥ 3 checkpoints** (`MIN_CHECKPOINTS = 3`) — enforced in the Leaflet editor (can't save below 3) **and** in the API (create/delete endpoints return `CONFLICT` otherwise).
- **No upper limit** — add as many as the corridor needs.
- Each checkpoint: name, sequence (order along the route), latitude/longitude (map placement), radius in meters (geofence circle).
- `CheckpointRecord` (transport check-in evidence) stores the actual scanned position and a `withinRadius` boolean, ready for future GPS integrations.

## Pickup & handover integrity (QR scan flow)

Every physical package carries a QR label encoding its **`detailCode`**. The handover flow:

```
ASSIGNED ──scan all packages──► (IN_PROGRESS) ──confirm──► COMPLETED
   │                                │                        │
   │ kurir sees ONLY tasks          │ each POST /scans        │ shipment → PICKED_UP
   │ assigned to them               │ validates payload       │ tracking: "Picked-up by [Kurir]"
   │ (?mine=true)                   │ = detailCode            │
```

1. **Kurir view** — users without `pickup.assign_kurir` automatically get `?mine=true`: only their own tasks appear.
2. **Scan** — the "Proses / Scan QR" action opens the scan dialog. Each scan (`POST /pickups/{id}/scans`, permission `pickup.scan`) is matched against the shipment's detail codes:
   - `ok` — the package is marked scanned (green check in the checklist);
   - `duplicate` — the same package scanned again (recorded, no progress change);
   - `unexpected` — unknown QR (recorded + warning; a `Discrepancy` candidate).
   Only the **assigned kurir**, a supervisor with `pickup.assign_kurir`, or the owner may scan.
3. **Confirm gate** — `POST /pickups/{id}/confirm` **fails with 422** while any package is unscanned, listing the remaining `detailCode`s. With all packages scanned it completes the pickup, moves the shipment to `PICKED_UP`, and writes tracking: **`Picked-up by [Kurir Name]`** (plus an audit entry with the scan count).

The dialog also renders a QR image per unscanned package so the flow can be exercised with a phone camera during demos; USB QR readers act as keyboards (input auto-focus, Enter submits).

## Delivery flow (QR scan + proof of delivery)

Same QR pattern for the last mile — kurir must scan **all packages for that customer** before confirming handover:

```
ASSIGNED ──scan all customer packages──► (all scanned) ──complete + PoD──► COMPLETED
   │                                                                              │
   │ ?mine=true executor view                          POST /deliveries/{id}/scans  │ shipment → DELIVERED
   │ detail barang visible per task                    (permission delivery.scan)   │ tracking: "Delivered to [Customer] by [Kurir]
   │ ("Paket (Detail Barang)" column)                                             │         — received by: [PoD]"
```

- **Detail barang visibility** — every delivery row embeds its `details[]` (package code, description, quantity, `scanned` state). The "lihat detail" cell opens a checklist dialog showing exactly which packages belong to that customer and whether they were handed over (green) or not.
- **Scan gate** — `POST /deliveries/{id}/complete` requires every package scanned **and** a `proofOfDelivery` (receiver name). The UI unlocks the confirm button only when `allScanned`, then asks "Diterima oleh (PoD)".
- **Tracking** — on completion: `Delivered to [Customer] by [Kurir Name] — received by: [PoD]`, and the shipment lands in `DELIVERED` (terminal state).
- Completed tasks keep their scan history — the "Riwayat Scan" action reopens the dialog in read-only mode.

## RBAC flows

- **Owner** bypasses all permission checks (`permissions: ["*"]`) and can manage Access Control.
- Six system roles cover the org (see `rbac.ts`): `admin-kantor` (office/finance), `marketing` (acquisition), `admin-gudang` (warehouse/fleet), `kurir` (first/last mile + QR scanning), `driver`, `kenek` (linehaul).
- **Editing system role capabilities (owner-only)**: the owner can edit the permission set of any existing system role directly in Access Control → Roles (name/slug stay locked). No need to create a custom role just to change what Kurir can do. `ensureRbac()` re-applies templates only when the permission catalog itself changes (app update); ordinary restarts keep owner edits.
- Custom roles can be composed in the UI from the 62-permission catalog; endpoints check **permission slugs**, never role names.
- Nav items and action buttons are hidden when the user lacks the permission; the API independently re-checks (defense in depth).

## Audit trail (requirement #7)

- Every mutating endpoint writes an `AuditLog` row: action, entityType, entityId/Label (human string like `MKT-000002 → PICKED_UP`), actor, optional before/after JSON.
- **Global view**: `#/audit` — filter by entity, actor, action, date range; CSV export.
- **Per-menu view**: each page's "Log Aktivitas" tab calls `GET /audit-logs?entityType=<module>` — e.g. Gudang shows only `warehouse` events.
- Logs are append-only; the API exposes no update/delete for audit rows.
