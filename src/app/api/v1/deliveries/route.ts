import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "delivery.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const status = str(params.get("status"));
    // ?mine=true — kurir executor view: only deliveries assigned to me.
    const mine = params.get("mine") === "true";

    const deliveries = await db.delivery.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(mine && user.employeeId != null ? { kurirId: user.employeeId } : {}),
        ...(search
          ? {
              OR: [
                { deliveryCode: { contains: search } },
                { master: { masterCode: { contains: search } } },
                { master: { customer: { name: { contains: search } } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        master: { include: { customer: true, details: { orderBy: { id: "asc" } } } },
        scans: { where: { result: { in: ["ok", "duplicate"] } }, select: { detailId: true } },
      },
    });
    return ok(
      deliveries.map((d) => {
        const scannedIds = new Set(d.scans.filter((s) => s.detailId != null).map((s) => s.detailId));
        return {
          id: d.id,
          deliveryCode: d.deliveryCode,
          status: d.status,
          kurirId: d.kurirId,
          notes: d.notes,
          proofOfDelivery: d.proofOfDelivery,
          createdAt: d.createdAt,
          completedAt: d.completedAt,
          masterCode: d.master.masterCode,
          masterStatus: d.master.status,
          destination: d.master.destination,
          address: d.master.customer.address,
          customerName: d.master.customer.name,
          customerPhone: d.master.customer.phone,
          priceAmount: d.master.priceAmount,
          detailsCount: d.master.details.length,
          scannedCount: scannedIds.size,
          allScanned: d.master.details.length > 0 && d.master.details.every((x) => scannedIds.has(x.id)),
          details: d.master.details.map((x) => ({
            id: x.id,
            detailCode: x.detailCode,
            description: x.description,
            quantity: x.quantity,
            scanned: scannedIds.has(x.id),
          })),
        };
      }),
    );
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "delivery.assign_kurir");
    const body = await req.json().catch(() => ({}));
    const masterId = num(body.masterId);
    const master = masterId ? await db.masterShipment.findUnique({ where: { id: masterId }, include: { customer: true } }) : null;
    if (!master) return fail(422, "Shipment wajib dipilih.", { masterId: ["Shipment wajib dipilih."] });
    if (!["ARRIVED_AT_GUDANG", "RECEIVED_AT_GUDANG"].includes(master.status)) {
      return fail(422, `Shipment harus tiba di gudang terlebih dahulu (saat ini: ${master.status}).`);
    }
    const kurirId = num(body.kurirId);
    if (!kurirId) return fail(422, "Kurir wajib dipilih.", { kurirId: ["Kurir wajib dipilih."] });
    const kurir = await db.employee.findUnique({ where: { id: kurirId } });
    if (!kurir) return fail(422, "Kurir tidak ditemukan.", { kurirId: ["Kurir tidak ditemukan."] });
    const notes = str(body.notes);

    const deliveryCode = await nextCode("delivery", "DLV-2026-", "deliveryCode");
    const delivery = await db.delivery.create({
      data: {
        deliveryCode,
        masterId: master.id,
        kurirId,
        status: "ASSIGNED",
        notes,
      },
    });
    await db.trackingEvent.create({
      data: {
        masterId: master.id,
        event: "DELIVERY_ASSIGNED",
        description: `Kurir ${kurir.name} ditugaskan untuk pengiriman (${delivery.deliveryCode})`,
        actorId: user.id,
      },
    });
    await audit({ action: "created", entityType: "delivery", entityId: delivery.id, entityLabel: delivery.deliveryCode, actor: user, after: { master: master.masterCode, kurir: kurir.name } });
    return ok(delivery);
  });
}
