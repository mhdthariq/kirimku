import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { HttpError } from "@/lib/api-helpers";
import { assertTransportScope, cityIndex, scopeForUser, shipmentDestinationGudangIds } from "@/lib/gudang-scope";
import { returnTaskStatusForTransport } from "@/lib/transport-ops";

/** DB/auth-dependent helpers shared by the expense, multi drop and return-task routes. */

const MAX_PHOTO_BYTES = 2_500_000; // same ceiling as the checkpoint selfie

/** Optional proof photo: "" / missing → null; invalid → error message. */
export function parseOptionalPhoto(value: unknown): { photoUrl: string | null; error?: string } {
  if (value == null || value === "") return { photoUrl: null };
  if (typeof value !== "string") return { photoUrl: null, error: "Format foto tidak valid." };
  if (!value.startsWith("data:image/jpeg;base64,") && !value.startsWith("data:image/png;base64,")) {
    return { photoUrl: null, error: "Format foto tidak didukung - gunakan JPEG atau PNG." };
  }
  if (value.length > MAX_PHOTO_BYTES) return { photoUrl: null, error: "Foto terlalu besar (maks ±2.5 MB setelah kompresi)." };
  return { photoUrl: value };
}

type TransportForAccess = {
  driverId: number | null;
  kenekId: number | null;
  route: { origin: string | null; destination: string | null } | null;
  shipments: { master: Parameters<typeof assertTransportScope>[2][number] }[];
};

export function isAssignedCrew(user: AuthUser, t: { driverId: number | null; kenekId: number | null }): boolean {
  return user.employeeId != null && (t.driverId === user.employeeId || t.kenekId === user.employeeId);
}

/**
 * Who may touch a transport's expenses / drops:
 *  - owner: anyone;
 *  - driver / kenek roles: ONLY the transports they're assigned to;
 *  - everyone else (admin gudang, ...): transports inside their gudang scope.
 */
export async function assertTransportAccess(user: AuthUser, t: TransportForAccess): Promise<void> {
  if (user.isOwner || user.permissions.includes("*")) return;
  const isCrewRole = user.roles.some((r) => r.slug === "driver" || r.slug === "kenek");
  if (isCrewRole) {
    if (!isAssignedCrew(user, t)) throw new HttpError(403, "Anda hanya boleh mengakses transport yang ditugaskan kepada Anda.");
    return;
  }
  await assertTransportScope(user, t.route ?? { origin: null, destination: null }, t.shipments.map((s) => s.master));
}

/** Only the owner or the admin of the resi's DESTINATION gudang may approve its delivery. */
export async function assertDestinationApprover(user: AuthUser, master: Parameters<typeof shipmentDestinationGudangIds>[0]): Promise<void> {
  if (user.isOwner || user.permissions.includes("*")) return;
  const scope = await scopeForUser(user);
  const destIds = shipmentDestinationGudangIds(master, await cityIndex());
  if (scope.unscoped) return;
  if (scope.warehouseId == null || !destIds.includes(scope.warehouseId)) {
    throw new HttpError(403, "Delivery hanya bisa disetujui oleh Admin Gudang tujuan resi ini.");
  }
}

type Tx = Pick<typeof db, "returnTask">;

/** Keep a ReturnTask's status in step with its return transport (PLANNED/DEPARTED/ARRIVED). */
export async function syncReturnTaskForTransport(tx: Tx, transportId: number, transportStatus: string): Promise<void> {
  const next = returnTaskStatusForTransport(transportStatus);
  if (!next) return;
  await tx.returnTask.updateMany({ where: { returnTransportId: transportId, status: { not: "CANCELLED" } }, data: { status: next } });
}

export async function isReturnTransport(transportId: number): Promise<boolean> {
  return (await db.returnTask.count({ where: { returnTransportId: transportId } })) > 0;
}
