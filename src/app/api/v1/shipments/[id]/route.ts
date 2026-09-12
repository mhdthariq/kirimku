import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, num } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";
import { pricingPreview } from "@/lib/pricing";
import { computeTotals } from "@/lib/shipment-totals";
import { paymentSummary } from "@/lib/scan-flow";
import { assertShipmentScope } from "@/lib/gudang-scope";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.view");
    const { id } = await params;
    const shipment = await db.masterShipment.findUnique({
      where: { id: Number(id) },
      include: {
        customer: true,
        tariff: true,
        details: { orderBy: { id: "asc" } },
        trackingEvents: { orderBy: { occurredAt: "desc" }, include: { actor: true } },
        pickups: { include: { scans: true } },
        deliveries: true,
        payments: { include: { recordedBy: true, verifiedBy: true } },
        transportItems: { include: { transport: true } },
      },
    });
    if (!shipment) return fail(404, "Shipment tidak ditemukan.");
    // Gudang data separation: scoped users may only open shipments of their
    // own gudang (e.g. Bandung staff cannot open a Jakarta shipment by id).
    await assertShipmentScope(user, shipment);
    // Server-computed pricing preview (actual / volumetric / chargeable) so the
    // client never re-implements (or hardcodes) the volumetric formula.
    const preview = await pricingPreview(shipment);
    const totals = computeTotals(shipment.details);
    const payment = await paymentSummary(shipment.id);
    return ok({ ...shipment, pricingPreview: preview, totals, paymentSummary: payment });
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.update");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const existing = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, existing);
    if (existing.status !== "CREATED") {
      return fail(422, "Shipment hanya bisa diubah saat status CREATED.");
    }

    const data: Record<string, unknown> = {};
    if (body.tariffId !== undefined) {
      const tariffId = body.tariffId ? Number(body.tariffId) : null;
      if (tariffId) {
        const tariff = await db.tariff.findUnique({ where: { id: tariffId } });
        if (!tariff || !tariff.isActive) return fail(422, "Tarif tidak ditemukan / tidak aktif.");
        data.tariffId = tariff.id;
        data.origin = tariff.origin;
        data.destination = tariff.destination;
      } else {
        data.tariffId = null;
      }
    }
    if (body.origin !== undefined && data.origin === undefined) data.origin = str(body.origin) ?? existing.origin;
    if (body.destination !== undefined && data.destination === undefined) data.destination = str(body.destination) ?? existing.destination;
    if (body.originWarehouseId !== undefined) data.originWarehouseId = body.originWarehouseId ? Number(body.originWarehouseId) : null;
    if (body.destinationWarehouseId !== undefined) data.destinationWarehouseId = body.destinationWarehouseId ? Number(body.destinationWarehouseId) : null;
    // Penerima (recipient) — printed on both resi types
    if (body.penerimaName !== undefined) data.penerimaName = str(body.penerimaName);
    if (body.penerimaAddress !== undefined) data.penerimaAddress = str(body.penerimaAddress);
    if (body.penerimaContact !== undefined) data.penerimaContact = str(body.penerimaContact);

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
    await assertShipmentScope(user, existing);
    if (existing.status !== "CREATED") {
      return fail(422, "Shipment hanya bisa dihapus saat status CREATED. Gunakan Cancel untuk shipment yang sudah berjalan.");
    }
    await db.masterShipment.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "shipment", entityId: existing.id, entityLabel: existing.masterCode, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
