import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, handle, ok } from "@/composition/api-helpers";

/** Minimal repair choices without granting access to vehicle management. */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    await guard(req, "repair.create");
    const vehicles = await db.vehicle.findMany({
      select: { id: true, vehicleNumber: true, ownerId: true },
      orderBy: { vehicleNumber: "asc" },
    });
    return ok(vehicles);
  });
}
