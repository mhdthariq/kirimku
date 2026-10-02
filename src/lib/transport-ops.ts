/**
 * Pure rules for the transport extensions (2026-10-01): operational expenses,
 * multi drop, delivery approval and return task. No DB / framework imports, so
 * everything here is unit-tested (transport-ops.test.ts) and the API routes
 * just call it.
 *
 * Keep three concepts separate (from the spec):
 *   Checkpoint check-in = the vehicle arrived
 *   Multi drop          = a resi was unloaded
 *   Delivery approval   = the receiver accepted it
 */

// ---------------------------------------------------------------- expenses --
export const EXPENSE_TYPES = ["BONGKAR", "PARKIR", "MAKAN", "BBM"] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export const EXPENSE_LABEL: Record<ExpenseType, string> = {
  BONGKAR: "Biaya Bongkar",
  PARKIR: "Biaya Parkir",
  MAKAN: "Uang Makan",
  BBM: "Biaya BBM",
};

export function isExpenseType(value: unknown): value is ExpenseType {
  return typeof value === "string" && (EXPENSE_TYPES as readonly string[]).includes(value);
}

export interface ExpenseInput {
  type: unknown;
  amount: unknown;
}

/** First problem with an expense payload, or null when valid. Photo is optional. */
export function validateExpense(input: ExpenseInput): string | null {
  if (!isExpenseType(input.type)) return `Jenis biaya harus salah satu dari: ${EXPENSE_TYPES.join(", ")}.`;
  const amount = Number(input.amount);
  if (input.amount === "" || input.amount == null || !Number.isFinite(amount)) return "Nominal biaya wajib diisi.";
  if (amount <= 0) return "Nominal biaya harus lebih dari 0.";
  return null;
}

export interface ExpenseSummary {
  byType: Record<ExpenseType, { count: number; total: number }>;
  count: number;
  total: number;
}

/** Totals per type + grand total. Any number of rows per type is fine (multi transaction). */
export function summarizeExpenses(rows: { type: string; amount: number }[]): ExpenseSummary {
  const byType = Object.fromEntries(EXPENSE_TYPES.map((t) => [t, { count: 0, total: 0 }])) as ExpenseSummary["byType"];
  let count = 0;
  let total = 0;
  for (const r of rows) {
    if (!isExpenseType(r.type)) continue;
    byType[r.type].count += 1;
    byType[r.type].total += r.amount;
    count += 1;
    total += r.amount;
  }
  return { byType, count, total };
}

// -------------------------------------------------------------- multi drop --
export const TRANSPORT_MODES = ["DIRECT", "MULTI_DROP"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const DROP_STATUSES = ["LOADED", "AT_DROP_POINT", "DROPPED", "DELIVERY_PENDING", "DELIVERY_APPROVED"] as const;
export type DropStatus = (typeof DROP_STATUSES)[number];

export function normalizeTransportMode(value: unknown): TransportMode {
  return value === "MULTI_DROP" ? "MULTI_DROP" : "DIRECT";
}

/** A resi's drop checkpoint; null/undefined means the route's final checkpoint. */
export function effectiveDropCheckpointId(dropCheckpointId: number | null | undefined, finalCheckpointId: number | null): number | null {
  return dropCheckpointId ?? finalCheckpointId;
}

/** Can the drop checkpoint of a resi still be (re)assigned? */
export function canAssignDrop(mode: TransportMode, transportStatus: string, dropStatus: string): string | null {
  if (mode !== "MULTI_DROP") return "Transport ini bukan MULTI_DROP.";
  if (!["PLANNED", "DEPARTED"].includes(transportStatus)) return `Transport berstatus ${transportStatus} - titik drop tidak bisa diubah.`;
  if (!["LOADED", "AT_DROP_POINT"].includes(dropStatus)) return `Resi sudah ${dropStatus} - titik drop tidak bisa diubah.`;
  return null;
}

/**
 * Can this resi be unloaded now? The vehicle must have CHECKED IN at the
 * resi's drop checkpoint first (checkpoint check-in = vehicle arrived).
 */
export function canDrop(args: {
  mode: TransportMode;
  transportStatus: string;
  dropStatus: string;
  vehicleCheckedInAtDrop: boolean;
}): string | null {
  if (args.mode !== "MULTI_DROP") return "Transport ini bukan MULTI_DROP - resi turun di tujuan akhir.";
  if (args.transportStatus !== "DEPARTED") return `Drop hanya untuk transport DEPARTED (saat ini: ${args.transportStatus}).`;
  if (!["LOADED", "AT_DROP_POINT"].includes(args.dropStatus)) return `Resi sudah berstatus ${args.dropStatus}.`;
  if (!args.vehicleCheckedInAtDrop) return "Kendaraan belum check-in di checkpoint drop resi ini.";
  return null;
}

/** Approval is only possible for a resi that has been unloaded. */
export function canApproveDelivery(dropStatus: string): string | null {
  if (dropStatus === "DELIVERY_APPROVED") return "Resi sudah disetujui.";
  if (!["DROPPED", "DELIVERY_PENDING"].includes(dropStatus)) return `Resi berstatus ${dropStatus} - harus DROPPED dulu sebelum disetujui.`;
  return null;
}

export interface DropProgress {
  total: number;
  loaded: number;
  dropped: number;
  approved: number;
  allDropped: boolean;
  allApproved: boolean;
}

export function dropProgress(statuses: string[]): DropProgress {
  const total = statuses.length;
  const approved = statuses.filter((s) => s === "DELIVERY_APPROVED").length;
  const loaded = statuses.filter((s) => s === "LOADED" || s === "AT_DROP_POINT").length;
  const dropped = total - loaded;
  return { total, loaded, dropped, approved, allDropped: total > 0 && loaded === 0, allApproved: total > 0 && approved === total };
}

/** Group resi by drop checkpoint, in route order — the multi drop flow at a glance. */
export function groupByDropCheckpoint<T extends { dropCheckpointId: number | null }>(
  shipments: T[],
  checkpoints: { id: number; sequence: number }[],
): { checkpointId: number | null; shipments: T[] }[] {
  const finalId = checkpoints.length ? [...checkpoints].sort((a, b) => b.sequence - a.sequence)[0].id : null;
  const seq = new Map(checkpoints.map((c) => [c.id, c.sequence]));
  const groups = new Map<number | null, T[]>();
  for (const s of shipments) {
    const key = effectiveDropCheckpointId(s.dropCheckpointId, finalId);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()]
    .map(([checkpointId, list]) => ({ checkpointId, shipments: list }))
    .sort((a, b) => (seq.get(a.checkpointId as number) ?? 1e9) - (seq.get(b.checkpointId as number) ?? 1e9));
}

// -------------------------------------------------------------- return task --
export const RETURN_TASK_STATUSES = ["CREATED", "APPROVED", "PLANNED", "DEPARTED", "ARRIVED", "CANCELLED"] as const;
export type ReturnTaskStatus = (typeof RETURN_TASK_STATUSES)[number];

/** Vehicle is "empty" once every resi on the transport is delivery-approved. */
export function isVehicleEmpty(dropStatuses: string[]): boolean {
  return dropProgress(dropStatuses).allApproved;
}

export function canCreateReturnTask(args: {
  dropStatuses: string[];
  hasActiveReturnTask: boolean;
}): string | null {
  if (args.dropStatuses.length === 0) return "Transport tanpa resi tidak membutuhkan resi tugas balik.";
  if (!isVehicleEmpty(args.dropStatuses)) return "Masih ada resi yang belum DELIVERY_APPROVED - kendaraan belum kosong.";
  if (args.hasActiveReturnTask) return "Resi tugas balik untuk transport ini sudah ada.";
  return null;
}

export function canApproveReturnTask(status: string): string | null {
  return status === "CREATED" ? null : `Resi tugas balik berstatus ${status} - hanya CREATED yang bisa disetujui.`;
}

export function canCreateReturnTransport(status: string, alreadyHasTransport: boolean): string | null {
  if (alreadyHasTransport) return "Transport balik sudah dibuat untuk tugas ini.";
  return status === "APPROVED" ? null : `Resi tugas balik berstatus ${status} - harus APPROVED dulu.`;
}

/** Return leg = outbound checkpoints in reverse order (Brandan → Stabat → Binjai → Medan). */
export function buildReturnCheckpoints<T extends { name: string; sequence: number }>(outbound: T[]): (T & { sequence: number })[] {
  const ordered = [...outbound].sort((a, b) => b.sequence - a.sequence);
  return ordered.map((c, i) => ({ ...c, sequence: i + 1 }));
}

/** Return leg swaps the endpoints of the outbound transport. */
export function returnEndpoints(t: { origin: string | null; destination: string | null }): { origin: string; destination: string } {
  return { origin: t.destination ?? "", destination: t.origin ?? "" };
}

/** Status of the ReturnTask that follows the status of its return transport. */
export function returnTaskStatusForTransport(transportStatus: string): ReturnTaskStatus | null {
  if (transportStatus === "PLANNED") return "PLANNED";
  if (transportStatus === "DEPARTED") return "DEPARTED";
  if (transportStatus === "ARRIVED") return "ARRIVED";
  return null;
}
