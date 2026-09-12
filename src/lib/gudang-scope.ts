import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { HttpError } from "@/lib/api-helpers";

// ---------------------------------------------------------------------------
// Gudang data separation (revisi: pisah data antar gudang)
//
// Every karyawan (employee) belongs to exactly one gudang via
// `employee.warehouseId`. All operational data — shipments, pickups,
// deliveries, transports — is scoped by that gudang:
//   - a user stationed in Jakarta only sees Jakarta-gudang data (never
//     Bandung's) and vice versa;
//   - ONLY the owner sees data across every gudang (plus per-gudang tabs).
// ---------------------------------------------------------------------------

export interface GudangScope {
  /** true → unrestricted (owner / full-permission superuser) */
  unscoped: boolean;
  /** gudang id the user is bound to. null + unscoped=false → bound to no gudang → sees no operational data */
  warehouseId: number | null;
}

/**
 * Resolve the gudang scope of a user:
 * - owner (or `*` permissions) → unscoped, sees every gudang
 * - everyone else → their employee's gudang; employees without a gudang see
 *   no operational data (an account must be bound to a gudang to work)
 */
export async function scopeForUser(user: AuthUser): Promise<GudangScope> {
  if (user.isOwner || user.permissions.includes("*")) return { unscoped: true, warehouseId: null };
  if (user.employeeId == null) return { unscoped: false, warehouseId: null };
  const employee = await db.employee.findUnique({
    where: { id: user.employeeId },
    select: { warehouseId: true },
  });
  return { unscoped: false, warehouseId: employee?.warehouseId ?? null };
}

/** Is a row (with its gudangIds) visible inside the scope? */
export function inScope(gudangIds: number[], scope: GudangScope): boolean {
  if (scope.unscoped) return true;
  if (scope.warehouseId == null) return false; // bound to no gudang → nothing
  return gudangIds.includes(scope.warehouseId);
}

/** Enforce shipment ownership and gudang visibility for ID-based endpoints. */
export async function assertShipmentScope(
  user: AuthUser,
  shipment: ShipmentLike & { createdByPartnerId?: number | null },
): Promise<void> {
  if (user.isOwner || user.permissions.includes("*")) return;
  if (user.partnerType === "MARKETING" && user.partnerId != null) {
    if (shipment.createdByPartnerId !== user.partnerId) {
      throw new HttpError(403, "Shipment ini bukan milik partner Anda.");
    }
    return;
  }
  const scope = await scopeForUser(user);
  if (!inScope(shipmentGudangIds(shipment, await cityIndex()), scope)) {
    throw new HttpError(403, "Shipment ini berada di gudang lain — data terpisah antar gudang.");
  }
}

export async function assertTransportScope(
  user: AuthUser,
  route: { origin: string | null; destination: string | null },
  shipments: ShipmentLike[],
): Promise<void> {
  if (user.isOwner || user.permissions.includes("*")) return;
  const scope = await scopeForUser(user);
  if (!inScope(transportGudangIds(route, shipments, await cityIndex()), scope)) {
    throw new HttpError(403, "Transport ini berada di gudang lain — data terpisah antar gudang.");
  }
}

// ---------------------------------------------------------------------------
// Which gudang(s) does a shipment belong to (its current physical side)?
// ---------------------------------------------------------------------------

export interface ShipmentLike {
  status: string;
  originWarehouseId: number | null;
  destinationWarehouseId: number | null;
  arrivedWarehouseId: number | null;
  origin: string;
  destination: string;
}

/** lowercase warehouse city → warehouse ids (fallback when FK ids are null) */
export async function cityIndex(): Promise<Map<string, number[]>> {
  const warehouses = await db.warehouse.findMany({
    where: { isActive: true },
    select: { id: true, city: true },
  });
  const index = new Map<string, number[]>();
  for (const w of warehouses) {
    const key = (w.city ?? "").trim().toLowerCase();
    if (!key) continue;
    const list = index.get(key) ?? [];
    list.push(w.id);
    index.set(key, list);
  }
  return index;
}

function unique(ids: (number | null | undefined)[]): number[] {
  return Array.from(new Set(ids.filter((id): id is number => id != null)));
}

function idsFor(city: string | null | undefined, warehouseId: number | null | undefined, index: Map<string, number[]>): number[] {
  const key = (city ?? "").trim().toLowerCase();
  return unique([warehouseId, ...(key ? index.get(key) ?? [] : [])]);
}

/** Gudang(s) on the origin side of a shipment (where the journey starts). */
export function shipmentOriginGudangIds(s: ShipmentLike, index: Map<string, number[]>): number[] {
  return idsFor(s.origin, s.originWarehouseId, index);
}

/** Gudang(s) on the destination side of a shipment (final stop). */
export function shipmentDestinationGudangIds(s: ShipmentLike, index: Map<string, number[]>): number[] {
  return idsFor(s.destination, s.destinationWarehouseId, index);
}

// Statuses where the package sits at the destination gudang
const DEST_SIDE = new Set(["ARRIVED_AT_GUDANG", "DELIVERED"]);

/**
 * Gudang(s) a shipment currently belongs to — its physical location in the
 * lifecycle:
 * - CREATED → RECEIVED_AT_GUDANG: origin side (arrivedWarehouseId is the
 *   origin gudang once arrival is confirmed)
 * - IN_TRANSPORT: both endpoints (origin dispatched it, destination expects it)
 * - ARRIVED_AT_GUDANG / DELIVERED: destination side
 */
export function shipmentGudangIds(s: ShipmentLike, index: Map<string, number[]>): number[] {
  const origin = shipmentOriginGudangIds(s, index);
  const destination = shipmentDestinationGudangIds(s, index);
  if (s.status === "IN_TRANSPORT") return unique([...origin, ...destination]);
  if (DEST_SIDE.has(s.status)) {
    // arrivedWarehouseId: set when the package physically arrived (origin
    // arrival scan / walk-in, or transport arrival at the destination)
    return s.arrivedWarehouseId != null ? unique([s.arrivedWarehouseId]) : destination;
  }
  if (s.status === "RECEIVED_AT_GUDANG" && s.arrivedWarehouseId != null) {
    return unique([s.arrivedWarehouseId]);
  }
  return origin;
}

// ---------------------------------------------------------------------------
// Which gudang(s) do pickup / delivery / transport tasks belong to?
// ---------------------------------------------------------------------------

/**
 * Pickup tasks happen on the origin side of the master shipment (kurir picks
 * the package up from the customer and brings it back to the origin gudang).
 * Origin-side is fixed — history stays visible to the branch that executed it.
 */
export function pickupGudangIds(master: ShipmentLike, index: Map<string, number[]>): number[] {
  return shipmentOriginGudangIds(master, index);
}

/**
 * Delivery tasks belong to wherever the master shipment currently sits (the
 * destination gudang hands the package to the final receiver).
 */
export function deliveryGudangIds(master: ShipmentLike, index: Map<string, number[]>): number[] {
  return shipmentGudangIds(master, index);
}

/**
 * Transport (linehaul) belongs to both endpoint gudangs of its route — the
 * origin gudang loads it, the destination gudang receives it. Shipments
 * riding the transport also count.
 */
export function transportGudangIds(
  route: { origin: string | null; destination: string | null },
  shipments: ShipmentLike[],
  index: Map<string, number[]>,
): number[] {
  const ids = [...idsFor(route.origin, null, index), ...idsFor(route.destination, null, index)];
  for (const s of shipments) ids.push(...shipmentGudangIds(s, index));
  return unique(ids);
}

// ---------------------------------------------------------------------------
// Audit-log scoping
// ---------------------------------------------------------------------------

interface AuditEntryRef {
  entityType: string;
  entityId: number | null;
}

/** Entity types whose gudang can be resolved (gudang-scoped data). */
const MAPPABLE_TYPES = new Set(["shipment", "shipment_detail", "pickup", "delivery", "transport", "payment"]);

const SHIPMENT_SELECT = {
  id: true,
  status: true,
  originWarehouseId: true,
  destinationWarehouseId: true,
  arrivedWarehouseId: true,
  origin: true,
  destination: true,
} as const;

type ShipmentRow = {
  id: number;
  status: string;
  originWarehouseId: number | null;
  destinationWarehouseId: number | null;
  arrivedWarehouseId: number | null;
  origin: string;
  destination: string;
};

/**
 * Visibility of audit-log entries for a scoped user. Entities with a gudang
 * mapping (shipment, shipment_detail, pickup, delivery, transport, payment)
 * are only visible when they belong to the user's gudang; company-wide
 * entities (customer, invoice, auth, …) are not gudang data and stay visible.
 */
export async function filterAuditEntriesForScope(entries: AuditEntryRef[], scope: GudangScope): Promise<boolean[]> {
  if (scope.unscoped) return entries.map(() => true);
  if (entries.length === 0) return [];
  const index = await cityIndex();

  const pickupIds: number[] = [];
  const deliveryIds: number[] = [];
  const transportIds: number[] = [];
  const detailIds: number[] = [];
  const paymentIds: number[] = [];
  const shipmentIds: number[] = [];
  for (const e of entries) {
    if (e.entityId == null) continue;
    switch (e.entityType) {
      case "shipment": shipmentIds.push(e.entityId); break;
      case "pickup": pickupIds.push(e.entityId); break;
      case "delivery": deliveryIds.push(e.entityId); break;
      case "transport": transportIds.push(e.entityId); break;
      case "shipment_detail": detailIds.push(e.entityId); break;
      case "payment": paymentIds.push(e.entityId); break;
    }
  }

  // masterId per child-entity (pickup/delivery/detail/payment → master)
  const masterOf = new Map<string, number>();
  if (pickupIds.length) {
    const rows = await db.pickup.findMany({ where: { id: { in: pickupIds } }, select: { id: true, masterId: true } });
    for (const r of rows) masterOf.set(`pickup:${r.id}`, r.masterId);
  }
  if (deliveryIds.length) {
    const rows = await db.delivery.findMany({ where: { id: { in: deliveryIds } }, select: { id: true, masterId: true } });
    for (const r of rows) masterOf.set(`delivery:${r.id}`, r.masterId);
  }
  if (detailIds.length) {
    const rows = await db.detailShipment.findMany({ where: { id: { in: detailIds } }, select: { id: true, masterId: true } });
    for (const r of rows) masterOf.set(`shipment_detail:${r.id}`, r.masterId);
  }
  if (paymentIds.length) {
    const rows = await db.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, masterId: true } });
    for (const r of rows) masterOf.set(`payment:${r.id}`, r.masterId);
  }

  // gudangIds per master shipment
  const masterIds = new Set<number>(shipmentIds);
  for (const mid of masterOf.values()) masterIds.add(mid);
  const gudangByMaster = new Map<number, number[]>();
  if (masterIds.size) {
    const masters = await db.masterShipment.findMany({ where: { id: { in: [...masterIds] } }, select: SHIPMENT_SELECT });
    for (const m of masters as ShipmentRow[]) gudangByMaster.set(m.id, shipmentGudangIds(m, index));
  }

  // gudangIds per transport
  const gudangByTransport = new Map<number, number[]>();
  if (transportIds.length) {
    const transports = await db.transport.findMany({
      where: { id: { in: transportIds } },
      select: {
        id: true,
        route: { select: { origin: true, destination: true } },
        shipments: { select: { master: { select: SHIPMENT_SELECT } } },
      },
    });
    for (const t of transports) {
      gudangByTransport.set(
        t.id,
        transportGudangIds(t.route ?? { origin: null, destination: null }, t.shipments.map((s) => s.master as ShipmentRow), index),
      );
    }
  }

  const gudangIdsOf = (e: AuditEntryRef): number[] | null | "unresolvable" => {
    if (e.entityId == null) {
      // mappable entity without an id (legacy audit rows) — cannot verify the
      // scope, so default-deny for scoped users
      return MAPPABLE_TYPES.has(e.entityType) ? "unresolvable" : null;
    }
    switch (e.entityType) {
      case "shipment": return gudangByMaster.get(e.entityId) ?? "unresolvable";
      case "transport": return gudangByTransport.get(e.entityId) ?? "unresolvable";
      case "pickup":
      case "delivery":
      case "shipment_detail":
      case "payment": {
        const masterId = masterOf.get(`${e.entityType}:${e.entityId}`);
        if (masterId == null) return "unresolvable";
        return gudangByMaster.get(masterId) ?? "unresolvable";
      }
      default: return null; // company-wide entity (customer, invoice, auth, …) — not gudang data
    }
  };

  return entries.map((e) => {
    const ids = gudangIdsOf(e);
    if (ids === "unresolvable") return false; // gudang entity outside/beyond verification
    if (ids == null) return true; // company-wide entity — visible
    return inScope(ids, scope);
  });
}
