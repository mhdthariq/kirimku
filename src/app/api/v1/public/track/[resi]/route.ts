import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, fail, str } from "@/lib/api-helpers";
import { ensureRbac } from "@/lib/rbac";
import { ensureSeed } from "@/lib/seed";
import { isDefaultTenant } from "@/lib/tenant-context";
import { computeTotals } from "@/lib/shipment-totals";
import { STATUS_LABELS } from "@/lib/shipment-flow";

type Params = { params: Promise<{ resi: string }> };

/**
 * GET /api/v1/public/track/[resi] — PUBLIC tracking endpoint (no auth).
 *
 * Looks up a shipment by its `masterCode` OR `resi` (both are unique) and
 * returns the public-facing tracking view: shipment status, origin /
 * destination, sender / recipient (sender name only — phone & email redacted
 * for privacy), the list of packages tied to this Master Resi (description,
 * dimensions, weight — NOT the secret detailCode scan values), and the full
 * tracking timeline.
 *
 * The endpoint is intended for the customer-facing `/tracking-paket` page —
 * customers don't need to log in. Internal/financial fields (price,
 * paymentSummary, invoice, audit actor ids) are intentionally NOT returned.
 */
export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    // Boot RBAC + (default tenant only) demo seed so the endpoint works on a
    // fresh database the same way the authed API does.
    await ensureRbac();
    if (isDefaultTenant()) await ensureSeed();

    const { resi } = await params;
    const code = str(resi);
    if (!code) return fail(422, "Nomor resi tidak boleh kosong.");

    const shipment = await db.masterShipment.findFirst({
      where: {
        OR: [{ masterCode: code }, { resi: code }],
        status: { not: "CANCELLED" },
      },
      include: {
        customer: { select: { name: true, companyName: true, type: true } },
        tariff: { select: { origin: true, destination: true } },
        details: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            description: true,
            lengthCm: true,
            widthCm: true,
            heightCm: true,
            actualWeightKg: true,
            // NOTE: detailCode is intentionally NOT returned — it's a secret
            // scan value used for QR handover and must not be exposed publicly.
          },
        },
        trackingEvents: {
          orderBy: { occurredAt: "desc" },
          select: {
            id: true,
            event: true,
            description: true,
            occurredAt: true,
            actor: { select: { name: true } },
          },
        },
      },
    });

    if (!shipment) {
      return fail(404, `Resi "${code}" tidak ditemukan. Periksa kembali nomor Master Resi Anda.`);
    }

    const totals = computeTotals(shipment.details);
    const originWarehouse = shipment.originWarehouseId
      ? await db.warehouse.findUnique({ where: { id: shipment.originWarehouseId }, select: { name: true, city: true } })
      : null;
    const destinationWarehouse = shipment.destinationWarehouseId
      ? await db.warehouse.findUnique({ where: { id: shipment.destinationWarehouseId }, select: { name: true, city: true, customerSupportContact: true } })
      : null;
    const arrivedWarehouse = shipment.arrivedWarehouseId
      ? await db.warehouse.findUnique({ where: { id: shipment.arrivedWarehouseId }, select: { name: true, city: true } })
      : null;

    return ok({
      masterCode: shipment.masterCode,
      resi: shipment.resi,
      status: shipment.status,
      statusLabel: STATUS_LABELS[shipment.status] ?? shipment.status,
      origin: shipment.origin,
      destination: shipment.destination,
      originWarehouse: originWarehouse ? { name: originWarehouse.name, city: originWarehouse.city } : null,
      destinationWarehouse: destinationWarehouse
        ? { name: destinationWarehouse.name, city: destinationWarehouse.city, customerSupportContact: destinationWarehouse.customerSupportContact }
        : null,
      arrivedWarehouse: arrivedWarehouse ? { name: arrivedWarehouse.name, city: arrivedWarehouse.city } : null,
      // Sender / recipient — public tracking shows names + addresses so the
      // customer can confirm the shipment is theirs. Phone is masked.
      sender: {
        name: shipment.pengirimName ?? shipment.customer.companyName ?? shipment.customer.name,
        phone: maskPhone(shipment.pengirimPhone),
      },
      recipient: {
        name: shipment.penerimaName,
        address: shipment.penerimaAddress,
        phone: maskPhone(shipment.penerimaContact),
      },
      customerType: shipment.customer.type,
      // Pricing & invoice details are NOT exposed publicly — customers see
      // status + packages only. The Master Resi print already shows the value.
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
      // Package list — what's tied to this Master Resi
      packages: shipment.details.map((d) => ({
        id: d.id,
        description: d.description,
        lengthCm: d.lengthCm,
        widthCm: d.widthCm,
        heightCm: d.heightCm,
        actualWeightKg: d.actualWeightKg,
      })),
      totals: {
        totalPackages: totals.totalPackages,
        totalActualKg: totals.totalActualKg,
        totalVolumeM3: totals.totalVolumeM3,
      },
      // Tracking timeline (newest first)
      trackingEvents: shipment.trackingEvents.map((e) => ({
        id: e.id,
        event: e.event,
        description: e.description,
        occurredAt: e.occurredAt,
        actorName: e.actor?.name ?? null,
      })),
    });
  });
}

/** Mask phone number for public display: keep the first 4 + last 2 digits. */
function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "****";
  const head = digits.slice(0, 4);
  const tail = digits.slice(-2);
  const masked = "*".repeat(Math.max(0, digits.length - 6));
  return `${head}${masked}${tail}`;
}
