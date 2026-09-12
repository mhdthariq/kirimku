import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";

/** Lightweight dropdown options for any authenticated user (ids + labels only). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    const marketingOwner = user.partnerType === "MARKETING" ? user.partnerId : null;
    const [employees, vehicles, routes, warehouses, customers, tariffs, permissions, vehicleOwners, b2bShipments] = await Promise.all([
      db.employee.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, position: true, warehouseId: true } }),
      db.vehicle.findMany({ where: { status: "ACTIVE" }, orderBy: { vehicleNumber: "asc" }, select: { id: true, vehicleNumber: true, name: true, maxWeightKg: true } }),
      db.route.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, origin: true, destination: true } }),
      db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, city: true, customerSupportContact: true } }),
      db.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, type: true } }),
      db.tariff.findMany({
        where: {
          isActive: true,
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
        },
        orderBy: [{ origin: "asc" }, { destination: "asc" }, { customerType: "asc" }],
        select: { id: true, origin: true, destination: true, customerType: true, ratePerKg: true, minChargeableKg: true, volumetricMultiplier: true, roundingMode: true, roundingUnitKg: true, effectiveFrom: true, effectiveTo: true },
      }),
      db.permission.findMany({ orderBy: [{ module: "asc" }, { slug: "asc" }], select: { id: true, slug: true, module: true, description: true } }),
      // Revise.md §13 — vehicle-owner partners for the vehicle ownership dropdown
      db.partner.findMany({
        where: { type: "VEHICLE_OWNER", isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, companyPercent: true, partnerPercent: true, user: { select: { name: true, username: true } } },
      }),
      // B2B shipments available for invoice line linking (§7.1)
      db.masterShipment.findMany({
        where: {
          customer: { type: "b2b" },
          status: { not: "CANCELLED" },
          ...(user.partnerType === "MARKETING" ? { createdByPartnerId: marketingOwner ?? -1 } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, masterCode: true, priceAmount: true, finalPriceAmount: true, customerId: true,
          createdByPartnerId: true, origin: true, destination: true,
          invoiceLines: { select: { invoice: { select: { id: true, invoiceNumber: true, status: true } } } },
        },
      }),
    ]);
    const company = { name: process.env.NEXT_PUBLIC_COMPANY_NAME ?? "KirimKu Logistics" };
    return ok({
      company, employees, vehicles, routes, warehouses, customers, tariffs, permissions,
      vehicleOwners: vehicleOwners.map((p) => ({ id: p.id, name: p.user.name, username: p.user.username, profitShare: { company: p.companyPercent, partner: p.partnerPercent } })),
      b2bShipments,
    });
  });
}
