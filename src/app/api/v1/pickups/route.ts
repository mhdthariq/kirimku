import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";
import { cityIndex, inScope, pickupGudangIds, scopeForUser } from "@/lib/gudang-scope";

/** Executor = view-only pickup user without create/assign rights (kurir). */
function executorOnly(user: { isOwner: boolean; permissions: string[] }): boolean {
  if (user.isOwner || user.permissions.includes("*")) return false;
  const has = (slug: string) => user.permissions.includes(slug);
  return !has("pickup.create") && !has("pickup.assign_kurir");
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "pickup.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const status = str(params.get("status"));
    // ?mine=true — kurir executor view: only pickups assigned to me.
    // Revision Part Y — executor scoping is enforced SERVER-side: a user who
    // can view but not create/assign pickups (the kurir role) is ALWAYS
    // limited to their own tasks, even without the query flag.
    const mine = params.get("mine") === "true" || executorOnly(user);

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

    // Gudang data separation: pickups belong to the origin-side gudang of
    // their master shipment; scoped users only see their own gudang's tasks.
    // Each row carries gudangIds for the owner's per-gudang tabs.
    const scope = await scopeForUser(user);
    const cityIdx = await cityIndex();
    const withGudang = pickups.map((p) => ({
      p,
      gudangIds: pickupGudangIds(p.master, cityIdx),
    }));
    const visible = withGudang.filter(({ gudangIds }) => inScope(gudangIds, scope));

    return ok(
      visible.map(({ p, gudangIds }) => ({
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
        gudangIds,
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
