import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";
import { requirePartner } from "@/lib/wallet";

/**
 * GET /api/v1/partner/vehicles — Vehicle Owner's OWN vehicles (§13/§39):
 * a Vehicle Owner can only access their own vehicles, never another owner's.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "vehicle.view_own");
    const partner = requirePartner(user, "VEHICLE_OWNER");
    const vehicles = await db.vehicle.findMany({
      where: { ownerId: partner.id },
      orderBy: { vehicleNumber: "asc" },
      include: {
        _count: { select: { transports: true, repairs: true, settlements: true } },
      },
    });
    return ok(vehicles);
  });
}
