import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "transport.view");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: {
        route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } },
        vehicle: true,
        shipments: { include: { master: { include: { customer: true } } } },
        checkpointRecords: { orderBy: { recordedAt: "desc" }, include: { checkpoint: true, recordedBy: true } },
      },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    return ok(transport);
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.create");
    const { id } = await params;
    const existing = await db.transport.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Transport tidak ditemukan.");
    if (["DEPARTED", "ARRIVED"].includes(existing.status)) {
      return fail(422, `Transport dengan status ${existing.status} tidak bisa diubah.`);
    }
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.routeId !== undefined) data.routeId = num(body.routeId);
    if (body.vehicleId !== undefined) data.vehicleId = num(body.vehicleId);
    if (body.driverId !== undefined) data.driverId = num(body.driverId);
    if (body.kenekId !== undefined) data.kenekId = num(body.kenekId);
    const transport = await db.transport.update({ where: { id: existing.id }, data });
    await audit({ action: "updated", entityType: "transport", entityId: transport.id, entityLabel: transport.transportCode, actor: user, before: diffFields(existing, transport as unknown as Record<string, unknown>) });
    return ok(transport);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.create");
    const { id } = await params;
    const existing = await db.transport.findUnique({ where: { id: Number(id) }, include: { shipments: { include: { master: true } } } });
    if (!existing) return fail(404, "Transport tidak ditemukan.");
    if (existing.status !== "PLANNED") return fail(422, "Hanya transport PLANNED yang bisa dihapus.");

    for (const s of existing.shipments) {
      if (s.master.status === "IN_TRANSPORT") {
        await db.masterShipment.update({ where: { id: s.masterId }, data: { status: "RECEIVED_AT_GUDANG" } });
      }
    }
    await db.transport.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "transport", entityId: existing.id, entityLabel: existing.transportCode, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
