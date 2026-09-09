import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "pickup.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const status = str(params.get("status"));
    // ?mine=true — kurir executor view: only pickups assigned to me.
    const mine = params.get("mine") === "true";

    const pickups = await db.pickup.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(mine && user.employeeId != null ? { kurirId: user.employeeId } : {}),
        ...(search
          ? {
              OR: [
                { pickupCode: { contains: search } },
                { master: { masterCode: { contains: search } } },
                { master: { customer: { name: { contains: search } } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        master: { include: { customer: true, _count: { select: { details: true } } } },
        scans: { select: { detailId: true, result: true } },
      },
    });
    return ok(
      pickups.map((p) => ({
        id: p.id,
        pickupCode: p.pickupCode,
        status: p.status,
        kurirId: p.kurirId,
        notes: p.notes,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
        masterCode: p.master.masterCode,
        masterStatus: p.master.status,
        origin: p.master.origin,
        destination: p.master.destination,
        customerName: p.master.customer.name,
        customerType: p.master.customer.type,
        detailsCount: p.master._count.details,
        scannedCount: new Set(p.scans.filter((s) => s.detailId != null && s.result !== "unexpected").map((s) => s.detailId)).size,
      })),
    );
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "pickup.create");
    const body = await req.json().catch(() => ({}));
    const masterId = num(body.masterId);
    const master = masterId ? await db.masterShipment.findUnique({ where: { id: masterId }, include: { customer: true } }) : null;
    if (!master) return fail(422, "Shipment wajib dipilih.", { masterId: ["Shipment wajib dipilih."] });
    if (master.status !== "READY_FOR_PICKUP") {
      return fail(422, `Shipment harus berstatus READY_FOR_PICKUP (saat ini: ${master.status}).`);
    }
    // Defensive gate: a pickup request requires a counted price (Revision rule)
    if (master.priceAmount == null || master.priceAmount <= 0) {
      return fail(422, "Harga shipment belum dihitung — hitung harga sebelum membuat task pickup.");
    }
    const kurirId = num(body.kurirId);
    if (!kurirId) return fail(422, "Kurir wajib dipilih.", { kurirId: ["Kurir wajib dipilih."] });
    const kurir = await db.employee.findUnique({ where: { id: kurirId } });
    if (!kurir) return fail(422, "Kurir tidak ditemukan.", { kurirId: ["Kurir tidak ditemukan."] });
    const notes = str(body.notes);

    const pickupCode = await nextCode("pickup", "PICK-2026-", "pickupCode");
    const pickup = await db.pickup.create({
      data: {
        pickupCode,
        masterId: master.id,
        kurirId,
        status: "ASSIGNED",
        notes,
      },
    });

    await db.trackingEvent.create({
      data: {
        masterId: master.id,
        event: "PICKUP_ASSIGNED",
        description: `Kurir ${kurir.name} ditugaskan untuk penjemputan (${pickup.pickupCode})`,
        actorId: user.id,
      },
    });
    await audit({ action: "created", entityType: "pickup", entityId: pickup.id, entityLabel: pickup.pickupCode, actor: user, after: { master: master.masterCode, kurir: kurir.name } });
    return ok(pickup);
  });
}
