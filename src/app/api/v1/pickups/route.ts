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

/** Step 6 — Driver / Kenek executor. The driver & kenek roles can view
 *  pickups, but they should ONLY see DIRECT shipments assigned to them
 *  (their workflow is: load DIRECT shipment onto transport → scan MasterResi
 *  at checkpoint 1 → upload photo → arrive → deliver → scan + photo).
 *  STANDARD kurir pickups stay hidden from drivers / keneks to avoid
 *  mixing the two workflows on the same list. */
function isDriverCrew(user: { isOwner: boolean; roles: { slug: string }[] }): boolean {
  if (user.isOwner) return false;
  return user.roles.some((r) => r.slug === "driver" || r.slug === "kenek");
}

export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "pickup.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const status = str(params.get("status"));
    // ?mine=true — kurir executor view: only pickups assigned to me.
    // Revision Part Y — executor scoping is enforced SERVER-side: a user who
    // can view but not create/assign pickups (the kurir role) is ALWAYS
    // limited to their own tasks, even without the query flag.
    const mine = params.get("mine") === "true" || executorOnly(user);
    // Step 6 — Driver / Kenek only see DIRECT shipments assigned to them.
    // Other roles (Kurir, Admin Gudang, Owner) see both STANDARD and DIRECT.
    const driverCrewOnly = isDriverCrew(user);
    // Allow an explicit `?fulfillmentMode=DIRECT` query override too (used
    // by the UI filter chips if we ever add them).
    const fulfillmentModeParam = str(params.get("fulfillmentMode"));

    const pickups = await db.pickup.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(mine && user.employeeId != null ? { kurirId: user.employeeId } : {}),
        ...((driverCrewOnly || fulfillmentModeParam === "DIRECT")
          ? { master: { fulfillmentMode: "DIRECT" } }
          : fulfillmentModeParam === "STANDARD"
            ? { master: { fulfillmentMode: "STANDARD" } }
            : {}),
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

    // Step 2 — For DIRECT shipments, look up the transport carrying each
    // master and check whether the FIRST checkpoint has a check-in record
    // (= "already picked up from checkpoint 1"). One batched query across
    // all DIRECT masterIds in this page; STANDARD shipments skip this and
    // report `pickedUpFromCheckpoint1: false` (no transport-level pickup).
    const directMasterIds = pickups
      .filter((p) => (p.master.fulfillmentMode ?? "STANDARD") === "DIRECT")
      .map((p) => p.masterId);
    const directFirstCheckedIn = new Set<number>(); // masterIds that have at least one CP1 check-in
    if (directMasterIds.length > 0) {
      // Find the transports carrying these masters, then look up their
      // route's first checkpoint and check for any checkpoint record on it.
      const transports = await db.transport.findMany({
        where: { shipments: { some: { shipmentId: { in: directMasterIds } } } },
        include: {
          route: { include: { checkpoints: { orderBy: { sequence: "asc" }, take: 1 } } },
          checkpointRecords: { select: { checkpointId: true } },
        },
      });
      for (const t of transports) {
        const firstCp = t.route?.checkpoints[0];
        if (!firstCp) continue;
        const hasFirstCp = t.checkpointRecords.some((r) => r.checkpointId === firstCp.id);
        if (hasFirstCp) {
          // mark every master on this transport as "picked up from checkpoint 1"
          const mastersOnTransport = await db.transportShipment.findMany({
            where: { transportId: t.id },
            select: { shipmentId: true },
          });
          for (const ts of mastersOnTransport) directFirstCheckedIn.add(ts.shipmentId);
        }
      }
    }

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
        // Step 3 — also expose masterId so the client can correlate this
        // pickup with the transport carrying the master (for the
        // "picked up from checkpoint 1" badge).
        masterId: p.masterId,
        // Revise round 8 — pickup photo (proof of pickup). Display is gated
        // by proof_photo.view on the client.
        photoUrl: p.photoUrl ?? null,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
        masterCode: p.master.masterCode,
        masterStatus: p.master.status,
        origin: p.master.origin,
        destination: p.master.destination,
        customerName: p.master.customer.name,
        customerType: p.master.customer.type,
        // Step 1 — expose fulfillmentMode on each pickup row so the UI can
        // render the DIRECT badge and so driver clients can filter to only
        // DIRECT shipments they're working on (Step 6).
        fulfillmentMode: (p.master as { fulfillmentMode?: string | null }).fulfillmentMode ?? "STANDARD",
        // Step 2 — for DIRECT shipments: did the driver already check in at
        // checkpoint 1 of the transport carrying this master? Means the
        // driver physically picked the package up from the origin point.
        // Always false for STANDARD (STANDARD pickups happen at the
        // customer address, not at a transport checkpoint).
        pickedUpFromCheckpoint1: directFirstCheckedIn.has(p.masterId),
        // Revise round 7 — Pickup address shown to the kurir so they know
        // where to go. Sourced from the shipment's per-shipment sender
        // fields (pengirim*) — NOT the customer's master DB record — so the
        // kurir sees the actual address the staff entered for this shipment.
        pickupAddress: p.master.pengirimAddress ?? null,
        pickupContact: p.master.pengirimPhone ?? null,
        pickupSenderName: p.master.pengirimName ?? null,
        detailsCount: p.master._count.details,
        scannedCount: new Set(p.scans.filter((s) => s.detailId != null && s.result !== "unexpected").map((s) => s.detailId)).size,
        gudangIds,
      })),
    );
  });
}

export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "pickup.create");
    const body = await req.json().catch(() => ({}));
    const masterId = num(body.masterId);
    const master = masterId ? await db.masterShipment.findUnique({ where: { id: masterId }, include: { customer: true, invoiceLines: true } }) : null;
    if (!master) return fail(422, "Shipment wajib dipilih.", { masterId: ["Shipment wajib dipilih."] });
    if (master.status !== "READY_FOR_PICKUP") {
      return fail(422, `Shipment harus berstatus READY_FOR_PICKUP (saat ini: ${master.status}).`);
    }
    // Defensive gate: a pickup request requires a counted price (Revision rule)
    if (master.priceAmount == null || master.priceAmount <= 0) {
      return fail(422, "Harga shipment belum dihitung - hitung harga sebelum membuat task pickup.");
    }
    // B2B invoice gate: shipment B2B wajib sudah masuk ke invoice perusahaan
    // customernya sebelum bisa dibuatkan task pickup. Untuk B2C biaya
    // ditanggung Marketing, jadi tidak ada pemeriksaan invoice.
    if (master.customer?.type === "b2b" && master.invoiceLines.length === 0) {
      return fail(
        422,
        "Shipment B2B belum ditagirkan ke invoice manapun - tambahkan shipment ini ke invoice perusahaan customer sebelum membuat task pickup.",
      );
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
