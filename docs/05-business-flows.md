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
3. PICKUP        Assign kurir → kurir confirms pickup (proof + optional COD payment)
4. GUDANG IN     Received at origin gudang; price computed from tariff
5. TRANSPORT     Admin gudang builds transport (route + vehicle + crew + shipments) → depart
6. CHECKPOINTS   (future: geo check-ins recorded as CheckpointRecord, withinRadius flag)
7. GUDANG OUT    Transport arrives at destination gudang → ARRIVED_AT_GUDANG
8. DELIVERY      Assign kurir → complete with proof of delivery
9. SETTLE        Payment verified (b2c) or invoice settled (b2b)
```

## Pricing flow

`POST /shipments/{id}/price` snapshots a price onto the shipment:

1. **Tariff lookup** — exact match on `origin + destination + customerType` (b2b/b2c); `null` customerType matches all. Most specific active tariff within its effective window wins.
2. **Volumetric weight** per detail item: `lengthCm × widthCm × heightCm / volumetricDivisor` (default 6000).
3. **Chargeable weight (CW)**: `max(actualWeight, volumetric)` summed over items, then floored at `minChargeableKg`, rounded per `roundingMode` (`UP`/`NEAREST`) in steps of `roundingUnitKg`.
4. **Amount**: `CW × ratePerKg` → stored as `priceAmount` with `pricedAt` timestamp.

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

## Pickup & handover integrity

- `Pickup` links a shipment to a kurir; confirm requires the shipment to be in `READY_FOR_PICKUP`.
- `HandoverScan` logs master/detail barcode scans with results `ok | missing | unexpected`; mismatches create `Discrepancy` rows for resolution — the data model is in place for scanner hardware later, while the current UI uses manual confirmation.

## RBAC flows

- **Owner** bypasses all permission checks (`permissions: ["*"]`) and can manage Access Control.
- Six system roles cover the org (see `rbac.ts`): `admin-kantor` (office/finance), `marketing` (acquisition), `admin-gudang` (warehouse/fleet), `kurir` (first/last mile), `driver`, `kenek` (linehaul).
- Custom roles can be composed in the UI from the 79-permission catalog; endpoints check **permission slugs**, never role names.
- Nav items and action buttons are hidden when the user lacks the permission; the API independently re-checks (defense in depth).

## Audit trail (requirement #7)

- Every mutating endpoint writes an `AuditLog` row: action, entityType, entityId/Label (human string like `MKT-000002 → PICKED_UP`), actor, optional before/after JSON.
- **Global view**: `#/audit` — filter by entity, actor, action, date range; CSV export.
- **Per-menu view**: each page's "Log Aktivitas" tab calls `GET /audit-logs?entityType=<module>` — e.g. Gudang shows only `warehouse` events.
- Logs are append-only; the API exposes no update/delete for audit rows.
