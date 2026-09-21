import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";
import { cityIndex, deliveryGudangIds, inScope, scopeForUser } from "@/lib/gudang-scope";

/** Executor = view-only delivery user without assign rights (kurir). */
function executorOnly(user: { isOwner: boolean; permissions: string[] }): boolean {
  if (user.isOwner || user.permissions.includes("*")) return false;
  const has = (slug: string) => user.permissions.includes(slug);
  return !has("delivery.assign_kurir");
}

/** Step 6 — Driver / Kenek executor. Same reasoning as the pickups route:
 *  drivers & keneks only handle DIRECT shipments (their workflow is to
 *  deliver straight from the transport to the receiver, no gudang in
 *  between). STANDARD delivery tasks (kurir last-mile) stay hidden from
 *  drivers / keneks so the list isn't cluttered with tasks that don't
 *  belong to them. */
function isDriverCrew(user: { isOwner: boolean; roles: { slug: string }[] }): boolean {
  if (user.isOwner) return false;
  return user.roles.some((r) => r.slug === "driver" || r.slug === "kenek");
}

export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "delivery.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const status = str(params.get("status"));
    // ?mine=true — kurir executor view: only deliveries assigned to me.
    // Revision Part Y — executor scoping is enforced SERVER-side: a kurir
    // (view-only, no assign rights) always sees only their own tasks.
    const mine = params.get("mine") === "true" || executorOnly(user);
    // Step 6 — Driver / Kenek only see DIRECT shipments assigned to them.
    const driverCrewOnly = isDriverCrew(user);
    const fulfillmentModeParam = str(params.get("fulfillmentMode"));

    const deliveries = await db.delivery.findMany({
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

    // Step 2 — For DIRECT shipments, look up the transport carrying each
    // master and check whether the FIRST checkpoint has a check-in record
    // (= "already picked up from checkpoint 1"). One batched query across
    // all DIRECT masterIds in this page; STANDARD shipments skip this and
    // report `pickedUpFromCheckpoint1: false` (no transport-level pickup).
    const directMasterIds = deliveries
      .filter((d) => (d.master.fulfillmentMode ?? "STANDARD") === "DIRECT")
      .map((d) => d.masterId);
    const directFirstCheckedIn = new Set<number>(); // masterIds that have at least one CP1 check-in
    if (directMasterIds.length > 0) {
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
          const mastersOnTransport = await db.transportShipment.findMany({
            where: { transportId: t.id },
            select: { shipmentId: true },
          });
          for (const ts of mastersOnTransport) directFirstCheckedIn.add(ts.shipmentId);
        }
      }
    }

    // Gudang data separation: deliveries belong to the gudang where their
    // master shipment currently sits; scoped users only see their own
    // gudang's tasks. Each row carries gudangIds for the owner's tabs.
    const scope = await scopeForUser(user);
    const cityIdx = await cityIndex();
    const whRows = await db.warehouse.findMany({ select: { id: true, name: true } });
    const whName = (id: number | null | undefined) => (id == null ? null : whRows.find((w) => w.id === id)?.name ?? null);
    const withGudang = deliveries.map((d) => ({
      d,
      gudangIds: deliveryGudangIds(d.master, cityIdx),
    }));
    const visible = withGudang.filter(({ gudangIds }) => inScope(gudangIds, scope));

    return ok(
      visible.map(({ d, gudangIds }) => {
        const scannedIds = new Set(d.scans.filter((s) => s.detailId != null).map((s) => s.detailId));
        return {
          id: d.id,
          deliveryCode: d.deliveryCode,
          status: d.status,
          kurirId: d.kurirId,
          notes: d.notes,
          proofOfDelivery: d.proofOfDelivery,
          // Step 3 — also expose masterId so the client can correlate this
          // delivery with the transport carrying the master (for the
          // "picked up from checkpoint 1" badge).
          masterId: d.masterId,
          // Revise round 8 — optional delivery photo (proof of delivery image).
          // Display is gated by proof_photo.view on the client (Admin Gudang +
          // Owner by default). Other roles see the metadata but not the image.
          photoUrl: d.photoUrl ?? null,
          createdAt: d.createdAt,
          completedAt: d.completedAt,
          masterCode: d.master.masterCode,
          masterStatus: d.master.status,
          destination: d.master.destination,
          // where this shipment came from ("shipment dari Gudang A") — shown
          // to the destination gudang's kurir / Admin Gudang
          originWarehouseId: d.master.originWarehouseId,
          originWarehouseName: whName(d.master.originWarehouseId),
          address: d.master.customer.address,
          customerName: d.master.customer.name,
          customerPhone: d.master.customer.phone,
          customerType: d.master.customer.type,
          priceAmount: d.master.priceAmount,
          // Step 1 — expose fulfillmentMode on each delivery row so the UI
          // can render the DIRECT badge and so driver clients can filter
          // to only DIRECT shipments they're working on (Step 6).
          fulfillmentMode: (d.master as { fulfillmentMode?: string | null }).fulfillmentMode ?? "STANDARD",
          // Step 2 — for DIRECT shipments: did the driver already check in at
          // checkpoint 1 of the transport carrying this master? Means the
          // driver physically picked the package up from the origin point
          // (and is now on the way to deliver). Always false for STANDARD.
          pickedUpFromCheckpoint1: directFirstCheckedIn.has(d.masterId),
          detailsCount: d.master.details.length,
          scannedCount: scannedIds.size,
          allScanned: d.master.details.length > 0 && d.master.details.every((x) => scannedIds.has(x.id)),
          details: d.master.details.map((x) => ({
            id: x.id,
            detailCode: x.detailCode,
            description: x.description,
            scanned: scannedIds.has(x.id),
          })),
          gudangIds,
        };
      }),
    );
  });
}

export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "delivery.assign_kurir");
    const body = await req.json().catch(() => ({}));
    const masterId = num(body.masterId);
    const master = masterId ? await db.masterShipment.findUnique({ where: { id: masterId }, include: { customer: true } }) : null;
    if (!master) return fail(422, "Shipment wajib dipilih.", { masterId: ["Shipment wajib dipilih."] });
    if (master.status === "AT_DEST_GUDANG") {
      return fail(422, "Driver baru check-in di gudang tujuan — paket belum discan / diterima Admin Gudang. Scan paketnya dulu di menu Shipments (status Tiba di Gudang Tujuan).");
    }
    if (!["ARRIVED_AT_GUDANG", "RECEIVED_AT_GUDANG"].includes(master.status)) {
      return fail(422, `Shipment harus tiba di gudang terlebih dahulu (saat ini: ${master.status}).`);
    }
    // Transport drop-off gate: a shipment that reached ANOTHER gudang must be
    // scanned in & received by Admin Gudang of that gudang (destReceivedAt)
    // before a kurir can be assigned to deliver it.
    if (master.status === "ARRIVED_AT_GUDANG" && master.destReceivedAt == null) {
      return fail(422, "Shipment dari gudang lain belum discan / diterima Admin Gudang — scan paketnya dulu di menu Shipments (status Tiba di Gudang Tujuan).");
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
