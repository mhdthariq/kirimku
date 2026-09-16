/** Shipment lifecycle state machine (single source of truth for API + UI). */
export const MIN_CHECKPOINTS = 3;

export const SHIPMENT_STATUSES = [
  "CREATED",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "RECEIVED_AT_GUDANG",
  "IN_TRANSPORT",
  "AT_DEST_GUDANG",
  "ARRIVED_AT_GUDANG",
  "DELIVERED",
  "CANCELLED",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const VALID_TRANSITIONS: Record<string, string[]> = {
  CREATED: ["READY_FOR_PICKUP", "RECEIVED_AT_GUDANG", "CANCELLED"],
  READY_FOR_PICKUP: ["PICKED_UP", "RECEIVED_AT_GUDANG", "CANCELLED"],
  PICKED_UP: ["RECEIVED_AT_GUDANG", "CANCELLED"],
  RECEIVED_AT_GUDANG: ["IN_TRANSPORT", "CANCELLED"],
  IN_TRANSPORT: ["AT_DEST_GUDANG", "ARRIVED_AT_GUDANG", "CANCELLED"],
  // Driver checked in at the LAST checkpoint (Gudang Tujuan) but Admin Gudang
  // has not scan-verified the packages yet.
  AT_DEST_GUDANG: ["ARRIVED_AT_GUDANG", "CANCELLED"],
  // Packages scan-verified & received by Admin Gudang of the destination
  // gudang (destReceivedAt stamped) — ready for delivery assignment.
  ARRIVED_AT_GUDANG: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransition(from: string, to: string): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export const STATUS_LABELS: Record<string, string> = {
  CREATED: "Created",
  READY_FOR_PICKUP: "Ready for Pickup",
  PICKED_UP: "Picked Up",
  // Origin-side intake: the package entered the gudang where its journey
  // starts (kurir drop-off scan / walk-in).
  RECEIVED_AT_GUDANG: "Arrived at Origin Gudang",
  IN_TRANSPORT: "In Transport",
  // The transport driver checked in at the LAST checkpoint (Gudang Tujuan) —
  // the packages are physically at the destination branch but Admin Gudang
  // has NOT scan-verified them yet (destReceivedAt still null).
  AT_DEST_GUDANG: "Tiba di Gudang Tujuan",
  // Destination-side arrival: Admin Gudang of the destination gudang has
  // scan-verified & received the packages (destReceivedAt stamped). The UI
  // renders this dynamically as "Arrived at {Gudang Name}" (e.g. "Arrived at
  // Gudang Jakarta Pusat").
  ARRIVED_AT_GUDANG: "Arrived at Gudang Tujuan",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  // pickups — Revision Part A lifecycle: ASSIGNED → PICKED_UP (kurir fetches
  // the package) → the package arrives at the gudang (shipment RECEIVED_AT_
  // GUDANG via the arrival scan workflow) → COMPLETED. The kurir never
  // completes the pickup manually. (PICKED_UP is already defined above.)
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
  // transports
  PLANNED: "Planned",
  DEPARTED: "Departed",
  ARRIVED: "Arrived",
  // payments
  RECORDED: "Recorded",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  // invoices
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_SETTLED: "Partially Settled",
  SETTLED: "Settled",
};
