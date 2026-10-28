import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { ok, handle, fail, str } from "@/composition/api-helpers";
import { ensureRbac } from "@/infrastructure/auth/rbac";
import { ensureSeed } from "@/infrastructure/services/seed";
import { isDefaultTenant } from "@/infrastructure/persistence/tenant-context";
import { computeTotals } from "@/infrastructure/services/shipment-totals";
import { STATUS_LABELS } from "@/domain/shipment-flow";
import { maskResiValue, normalizeResiPhone } from "@/shared/resi-privacy";
import { allowTrackingAttempt } from "@/infrastructure/services/tracking-attempts";

type Params = { params: Promise<{ resi: string }> };

/** Tracking details are returned only after full sender/recipient phone verification. */
export async function GET() {
  return fail(405, "Scan QR pada resi dan verifikasi nomor telepon untuk melacak paket.");
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!req.headers.get("x-corp-id")?.trim() || req.headers.get("x-corp-id")!.length > 128) {
    return fail(422, "Scan QR pada resi untuk membuka pelacakan.");
  }
  const response = await handle(req, async () => {
    const body = await req.json().catch(() => null);
    const phone = normalizeResiPhone(body?.phone);
    const { resi } = await params;
    const code = str(resi);
    if (!code || code.length > 128 || !phone) return fail(422, "Masukkan nomor telepon lengkap pengirim atau penerima.");
    if (!allowTrackingAttempt(JSON.stringify([req.headers.get("x-corp-id")?.trim(), code]))) {
      return fail(429, "Terlalu banyak percobaan. Coba lagi dalam 15 menit.");
    }
    // Match the authenticated API's opt-in seed behavior.
    await ensureRbac();
    if (isDefaultTenant() && process.env.AUTO_SEED_ON_BOOT === "true") {
      await ensureSeed();
    }
    const shipment = await db.masterShipment.findFirst({
      where: {
        OR: [{ masterCode: code }, { resi: code }, { details: { some: { detailCode: code } } }],
        status: { not: "CANCELLED" },
      },
      include: {
        customer: { select: { name: true, companyName: true, type: true, phone: true } },
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

    const senderPhone = normalizeResiPhone(shipment?.pengirimPhone ?? shipment?.customer.phone);
    const recipientPhone = normalizeResiPhone(shipment?.penerimaContact);
    if (!shipment || (phone !== senderPhone && phone !== recipientPhone)) {
      return fail(403, "Resi atau nomor telepon tidak sesuai. Gunakan nomor lengkap pengirim atau penerima.");
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
      // Keep personal contact details masked even after phone verification.
      sender: {
        name: shipment.pengirimName ?? shipment.customer.companyName ?? shipment.customer.name,
        phone: maskResiValue(shipment.pengirimPhone ?? shipment.customer.phone),
      },
      recipient: {
        name: shipment.penerimaName,
        address: maskResiValue(shipment.penerimaAddress),
        phone: maskResiValue(shipment.penerimaContact),
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
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
