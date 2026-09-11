import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, requireNum, num } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

/** Resolve & validate a Vehicle Owner partner for vehicle ownership (§13). */
async function resolveOwner(ownerId: number | null) {
  if (ownerId == null) return null;
  const partner = await db.partner.findUnique({ where: { id: ownerId } });
  if (!partner) throw new Error("OWNER_NOT_FOUND");
  if (partner.type !== "VEHICLE_OWNER") throw new Error("OWNER_NOT_VO");
  return partner;
}

type Params = { params: Promise<{ id: string }> };
const VEHICLE_STATUSES = ["ACTIVE", "MAINTENANCE", "INACTIVE"];

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "vehicle.update");
    const { id } = await params;
    const existing = await db.vehicle.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Kendaraan tidak ditemukan.");
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.vehicleNumber !== undefined) data.vehicleNumber = str(body.vehicleNumber) ?? existing.vehicleNumber;
    if (body.name !== undefined) data.name = str(body.name);
    if (body.status !== undefined && VEHICLE_STATUSES.includes(body.status)) data.status = body.status;
    if (body.maxWeightKg !== undefined) data.maxWeightKg = requireNum(body.maxWeightKg, "maxWeightKg", 1);
    if (body.maxVolumeM3 !== undefined) data.maxVolumeM3 = requireNum(body.maxVolumeM3, "maxVolumeM3", 0.1);
    if (body.notes !== undefined) data.notes = str(body.notes);
    // Revise.md §13 — link the vehicle to its Vehicle Owner (null = company).
    if (body.ownerId !== undefined) {
      const ownerId = body.ownerId === null || body.ownerId === "" ? null : num(body.ownerId);
      try {
        const owner = await resolveOwner(ownerId);
        data.ownerId = owner?.id ?? null;
      } catch (e) {
        if (e instanceof Error && e.message === "OWNER_NOT_FOUND") return fail(404, "Vehicle Owner tidak ditemukan.");
        if (e instanceof Error && e.message === "OWNER_NOT_VO") return fail(422, "Partner terpilih bukan Vehicle Owner.");
        throw e;
      }
    }
    const vehicle = await db.vehicle.update({ where: { id: existing.id }, data });
    await audit({ action: "updated", entityType: "vehicle", entityId: vehicle.id, entityLabel: vehicle.vehicleNumber, actor: user, before: diffFields(existing, vehicle as unknown as Record<string, unknown>) });
    return ok(vehicle);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "vehicle.update");
    const { id } = await params;
    const existing = await db.vehicle.findUnique({ where: { id: Number(id) }, include: { transports: true } });
    if (!existing) return fail(404, "Kendaraan tidak ditemukan.");
    if (existing.transports.length > 0) {
      const vehicle = await db.vehicle.update({ where: { id: existing.id }, data: { status: "INACTIVE" } });
      await audit({ action: "deactivated", entityType: "vehicle", entityId: vehicle.id, entityLabel: vehicle.vehicleNumber, actor: user });
      return ok({ deactivated: true, vehicle });
    }
    await db.vehicle.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "vehicle", entityId: existing.id, entityLabel: existing.vehicleNumber, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
