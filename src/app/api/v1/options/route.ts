import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";
import { scopeForUser } from "@/lib/gudang-scope";
import { currentCompanyName } from "@/lib/tenant-context";

/** Lightweight dropdown options for any authenticated user (ids + labels only). */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req);
    const marketingOwner = user.partnerType === "MARKETING" ? user.partnerId : null;
    // Revise round 7 — Customer Gudang attachment. Customers with a
    // warehouseId set are only visible to admins of that gudang (plus
    // owner / marketing-scoped to themselves). General customers
    // (warehouseId = null) are visible to everyone.
    const scope = await scopeForUser(user);
    const customerWarehouseClause = scope.unscoped
      ? {}
      : {
          OR: [
            { warehouseId: null }, // general customers — visible to all
            ...(scope.warehouseId != null ? [{ warehouseId: scope.warehouseId }] : []),
          ],
        };
    const [employees, vehicles, routes, warehouses, customers, tariffs, permissions, vehicleOwners, marketingPartners, b2bShipments] = await Promise.all([
      db.employee.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, position: true, warehouseId: true } }),
      db.vehicle.findMany({ where: { status: "ACTIVE" }, orderBy: { vehicleNumber: "asc" }, select: { id: true, vehicleNumber: true, name: true, maxWeightKg: true, maxVolumeM3: true, lengthM: true, widthM: true, heightM: true } }),
      db.route.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, origin: true, destination: true } }),
      db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, city: true, customerSupportContact: true } }),
      // Marketing data separation: a Marketing partner only gets THEIR customers
      // in every dropdown (shipment creation, invoice lines, …). On top of
      // that, gudang-scoped admins only see customers attached to their gudang
      // OR general (warehouseId=null) customers — never another gudang's.
      db.customer.findMany({
        where: {
          isActive: true,
          ...(marketingOwner != null ? { marketingPartnerId: marketingOwner } : {}),
          ...customerWarehouseClause,
        },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, type: true, phone: true, email: true, address: true, marketingPartnerId: true, warehouseId: true, warehouse: { select: { name: true } } },
      }),
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
      // Marketing partners for the customer ↔ marketing linkage dropdown
      // ("customer connected to who") — only marketing partners, nothing else.
      // Revise round 7: also include the warehouseId / warehouse name so the
      // Partners page can show Partner Alignment ("this marketing belongs to
      // gudang X"). null = umum / general.
      db.partner.findMany({
        where: { type: "MARKETING", isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, warehouseId: true, warehouse: { select: { id: true, name: true } }, user: { select: { name: true, username: true } } },
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
    const company = { name: currentCompanyName() ?? process.env.NEXT_PUBLIC_COMPANY_NAME ?? "KirimKu Logistics" };
    return ok({
      company, employees, vehicles, routes, warehouses,
      customers: customers.map((c) => ({ ...c, warehouseName: c.warehouse?.name ?? null, warehouse: undefined })),
      tariffs, permissions,
      vehicleOwners: vehicleOwners.map((p) => ({ id: p.id, name: p.user.name, username: p.user.username, profitShare: { company: p.companyPercent, partner: p.partnerPercent } })),
      // Marketing partners — used by the Customers page "Marketing (PIC)" dropdown
      // AND by the Partners page Partner Alignment dropdown. Includes warehouseId
      // + warehouseName so the alignment can be displayed without an extra fetch.
      marketingPartners: marketingPartners.map((p) => ({
        id: p.id,
        name: p.user.name,
        username: p.user.username,
        warehouseId: p.warehouseId ?? null,
        warehouseName: p.warehouse?.name ?? null,
      })),
      b2bShipments,
    });
  });
}
