import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, requireStr, str, num, requireNum } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

const VEHICLE_STATUSES = ["ACTIVE", "MAINTENANCE", "INACTIVE"];

export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req, "vehicle.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const status = str(params.get("status"));
    const vehicles = await db.vehicle.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search ? { OR: [{ vehicleNumber: { contains: search } }, { name: { contains: search } }] } : {}),
      },
      orderBy: { id: "desc" },
      include: {
        assignments: { where: { validTo: null }, include: { driver: true, kenek: true } },
        _count: { select: { transports: true } },
      },
    });
    return ok(vehicles);
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "vehicle.create");
    const body = await req.json().catch(() => ({}));
    const vehicleNumber = requireStr(body.vehicleNumber, "vehicleNumber");
    const existing = await db.vehicle.findUnique({ where: { vehicleNumber } });
    if (existing) return fail(422, `Nomor polisi ${vehicleNumber} sudah terdaftar.`, { vehicleNumber: ["Nomor polisi sudah terdaftar."] });

    const status = VEHICLE_STATUSES.includes(body.status) ? body.status : "ACTIVE";
    const vehicle = await db.vehicle.create({
      data: {
        vehicleNumber,
        name: str(body.name),
        status,
        maxWeightKg: requireNum(body.maxWeightKg, "maxWeightKg", 1),
        maxVolumeM3: requireNum(body.maxVolumeM3, "maxVolumeM3", 0.1),
        notes: str(body.notes),
      },
    });
    await audit({ action: "created", entityType: "vehicle", entityId: vehicle.id, entityLabel: vehicle.vehicleNumber, actor: user, after: vehicle });
    return ok(vehicle);
  });
}
