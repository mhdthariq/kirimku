/** Shipment lifecycle state machine (single source of truth for API + UI). */
export const MIN_CHECKPOINTS = 3;

export const SHIPMENT_STATUSES = [
  "CREATED",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "RECEIVED_AT_GUDANG",
  "IN_TRANSPORT",
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
  IN_TRANSPORT: ["ARRIVED_AT_GUDANG", "CANCELLED"],
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
  RECEIVED_AT_GUDANG: "Arrive at Gudang",
  IN_TRANSPORT: "In Transport",
  ARRIVED_AT_GUDANG: "Arrive at Gudang (Dest.)",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  // pickups
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
