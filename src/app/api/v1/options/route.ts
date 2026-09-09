import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";

/** Lightweight dropdown options for any authenticated user (ids + labels only). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req);
    const [employees, vehicles, routes, warehouses, customers, tariffs, permissions] = await Promise.all([
      db.employee.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, position: true, warehouseId: true } }),
      db.vehicle.findMany({ where: { status: "ACTIVE" }, orderBy: { vehicleNumber: "asc" }, select: { id: true, vehicleNumber: true, name: true, maxWeightKg: true } }),
      db.route.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, origin: true, destination: true } }),
      db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, city: true, customerSupportContact: true } }),
      db.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, type: true } }),
      db.tariff.findMany({
        where: { isActive: true },
        orderBy: [{ origin: "asc" }, { destination: "asc" }, { customerType: "asc" }],
        select: { id: true, origin: true, destination: true, customerType: true, ratePerKg: true, minChargeableKg: true, volumetricMultiplier: true, roundingMode: true, roundingUnitKg: true },
      }),
      db.permission.findMany({ orderBy: [{ module: "asc" }, { slug: "asc" }], select: { id: true, slug: true, module: true, description: true } }),
    ]);
    const company = { name: process.env.NEXT_PUBLIC_COMPANY_NAME ?? "KirimKu Logistics" };
    return ok({ company, employees, vehicles, routes, warehouses, customers, tariffs, permissions });
  });
}
