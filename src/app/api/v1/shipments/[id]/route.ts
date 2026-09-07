import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "shipment.view");
    const { id } = await params;
    const shipment = await db.masterShipment.findUnique({
      where: { id: Number(id) },
      include: {
        customer: true,
        details: true,
        trackingEvents: { orderBy: { occurredAt: "desc" }, include: { actor: true } },
        pickups: { include: { scans: true } },
        deliveries: true,
        payments: { include: { recordedBy: true, verifiedBy: true } },
        transportItems: { include: { transport: true } },
      },
    });
    if (!shipment) return fail(404, "Shipment tidak ditemukan.");
    return ok(shipment);
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.update");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const existing = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Shipment tidak ditemukan.");
    if (existing.status !== "CREATED") {
      return fail(422, "Shipment hanya bisa diubah saat status CREATED.");
    }

    const data: Record<string, unknown> = {};
    if (body.origin !== undefined) data.origin = str(body.origin) ?? existing.origin;
    if (body.destination !== undefined) data.destination = str(body.destination) ?? existing.destination;
    if (body.originWarehouseId !== undefined) data.originWarehouseId = body.originWarehouseId ? Number(body.originWarehouseId) : null;
    if (body.destinationWarehouseId !== undefined) data.destinationWarehouseId = body.destinationWarehouseId ? Number(body.destinationWarehouseId) : null;

    const shipment = await db.masterShipment.update({ where: { id: existing.id }, data });
    await audit({
      action: "updated", entityType: "shipment", entityId: shipment.id, entityLabel: shipment.masterCode,
      actor: user, before: diffFields(existing, shipment as unknown as Record<string, unknown>),
    });
    return ok(shipment);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.delete");
    const { id } = await params;
    const existing = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Shipment tidak ditemukan.");
    if (existing.status !== "CREATED") {
      return fail(422, "Shipment hanya bisa dihapus saat status CREATED. Gunakan Cancel untuk shipment yang sudah berjalan.");
    }
    await db.masterShipment.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "shipment", entityId: existing.id, entityLabel: existing.masterCode, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
