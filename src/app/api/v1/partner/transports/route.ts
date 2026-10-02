import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";
import { requirePartner } from "@/lib/wallet";
import { detailAggregates, transportLoadFromAggregates } from "@/lib/transport-totals";
import { calculateTransportCapacityStatus } from "@/lib/capacity";
import { getCapacityWarningThreshold } from "@/lib/settings";

/**
 * GET /api/v1/partner/transports — Vehicle Owner transport history (§16):
 * every transport performed with THEIR vehicles, with transport value,
 * profit-share percentage and owner earnings from the settlement snapshot.
 * Unsettled transports show the current profit-share config as a preview.
 *
 * Capacity Round — also returns the live capacity status per transport so
 * the vehicle owner can see how loaded their vehicle was (informational).
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "transport.view_own_vehicles");
    const partner = requirePartner(user, "VEHICLE_OWNER");
    const partnerRow = await db.partner.findUniqueOrThrow({ where: { id: partner.id } });

    const transports = await db.transport.findMany({
      where: { vehicle: { ownerId: partner.id } },
      orderBy: { createdAt: "desc" },
      include: {
        vehicle: { select: { id: true, vehicleNumber: true, name: true, maxWeightKg: true, maxVolumeM3: true, maxKoli: true } },
        route: { select: { name: true } },
        settlement: true,
        shipments: { include: { master: { select: { id: true, priceAmount: true } } } },
      },
      take: 200,
    });

    // Capacity Round — one detailAggregates call for all transports' masters.
    const allMasterIds = transports.flatMap((t) => t.shipments.map((s) => s.master.id));
    const { volumeByMaster, actualKgByMaster, packagesByMaster } = await detailAggregates(allMasterIds);
    const warningThreshold = await getCapacityWarningThreshold();

    const rows = transports.map((t) => {
      const shipmentsPrice = t.shipments.reduce((sum, ts) => sum + (ts.master.priceAmount ?? 0), 0);
      const settlement = t.settlement;
      // Settled → snapshot values (§37); unsettled → preview with the
      // CURRENT configuration, clearly flagged as not yet settled.
      const ownerPercent = settlement ? settlement.ownerPercent : partnerRow.partnerPercent;
      const transportValue = settlement ? settlement.transportValue : shipmentsPrice;
      // Capacity Round — live capacity status (informational, non-blocking).
      const masters = t.shipments.map((s) => ({ id: s.master.id, chargeableWeightKg: null, priceAmount: s.master.priceAmount }));
      const load = transportLoadFromAggregates(masters, volumeByMaster, actualKgByMaster, packagesByMaster);
      const capacity = calculateTransportCapacityStatus(
        { maxWeightKg: t.vehicle.maxWeightKg, maxVolumeM3: t.vehicle.maxVolumeM3, maxKoli: t.vehicle.maxKoli },
        load,
        warningThreshold,
      );
      return {
        id: t.id,
        transportCode: t.transportCode,
        status: t.status,
        routeName: t.route?.name ?? `${t.origin ?? "-"} → ${t.destination ?? "-"}`,
        origin: t.origin,
        destination: t.destination,
        departedAt: t.departedAt,
        arrivedAt: t.arrivedAt,
        createdAt: t.createdAt,
        vehicleId: t.vehicle.id,
        vehicleNumber: t.vehicle.vehicleNumber,
        shipmentCount: t.shipments.length,
        transportValue,
        ownerPercent,
        ownerEarnings: settlement ? settlement.ownerAmount : null,
        capacity,
        settlement: settlement
          ? {
              settlementCode: settlement.settlementCode,
              status: settlement.status,
              companyPercent: settlement.companyPercent,
              ownerPercent: settlement.ownerPercent,
              transportValue: settlement.transportValue,
              companyAmount: settlement.companyAmount,
              ownerAmount: settlement.ownerAmount,
              finalizedAt: settlement.finalizedAt,
            }
          : null,
      };
    });
    return ok(rows);
  });
}
