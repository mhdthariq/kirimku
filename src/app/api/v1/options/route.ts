import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";

/** Lightweight dropdown options for any authenticated user (ids + labels only). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req);
    const [employees, vehicles, routes, warehouses, customers, tariffs] = await Promise.all([
      db.employee.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, position: true } }),
      db.vehicle.findMany({ where: { status: "ACTIVE" }, orderBy: { vehicleNumber: "asc" }, select: { id: true, vehicleNumber: true, name: true, maxWeightKg: true } }),
      db.route.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, origin: true, destination: true } }),
      db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, city: true } }),
      db.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, type: true } }),
      db.tariff.findMany({ where: { isActive: true }, orderBy: { origin: "asc" }, select: { id: true, origin: true, destination: true, customerType: true, ratePerKg: true } }),
    ]);
    return ok({ employees, vehicles, routes, warehouses, customers, tariffs });
  });
}
