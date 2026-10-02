import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, str } from "@/lib/api-helpers";

/** GET /return-tasks?status=&search= */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "return-task.view");
    const params = req.nextUrl.searchParams;
    const status = str(params.get("status"));
    const search = str(params.get("search"));
    // Non-owners only see return tasks of their own gudang's vehicles' origin/destination cities.
    const scoped = !(user.isOwner || user.permissions.includes("*"));
    const employee = scoped && user.employeeId != null ? await db.employee.findUnique({ where: { id: user.employeeId }, select: { warehouseId: true, warehouse: { select: { city: true } } } }) : null;
    const city = employee?.warehouse?.city ?? null;

    const rows = await db.returnTask.findMany({
      where: {
        AND: [
          status ? { status } : {},
          search
            ? { OR: [{ returnTaskCode: { contains: search, mode: "insensitive" as const } }, { origin: { contains: search, mode: "insensitive" as const } }, { destination: { contains: search, mode: "insensitive" as const } }] }
            : {},
          scoped ? { OR: [{ origin: { equals: city ?? "__none__", mode: "insensitive" as const } }, { destination: { equals: city ?? "__none__", mode: "insensitive" as const } }] } : {},
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        originalTransport: { select: { transportCode: true, vehicle: { select: { vehicleNumber: true } }, driver: { select: { name: true } } } },
        returnTransport: { select: { transportCode: true, status: true } },
      },
    });
    return ok(
      rows.map((t) => ({
        id: t.id,
        returnTaskCode: t.returnTaskCode,
        status: t.status,
        origin: t.origin,
        destination: t.destination,
        vehicleNumber: t.originalTransport.vehicle.vehicleNumber,
        driverName: t.originalTransport.driver?.name ?? null,
        originalTransportId: t.originalTransportId,
        originalTransportCode: t.originalTransport.transportCode,
        returnTransportId: t.returnTransportId,
        returnTransportCode: t.returnTransport?.transportCode ?? null,
        approvedAt: t.approvedAt,
        createdAt: t.createdAt,
      })),
    );
  });
}
