import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "customer.view");
    const { id } = await params;
    const customer = await db.customer.findUnique({
      where: { id: Number(id) },
      include: { shipments: { orderBy: { createdAt: "desc" }, take: 10 } },
    });
    if (!customer) return fail(404, "Customer tidak ditemukan.");
    return ok(customer);
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "customer.update");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const existing = await db.customer.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Customer tidak ditemukan.");

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = requireStr(body.name, "name");
    if (body.type !== undefined) data.type = body.type === "b2b" ? "b2b" : "b2c";
    if (body.companyName !== undefined) data.companyName = str(body.companyName);
    if (body.phone !== undefined) data.phone = str(body.phone);
    if (body.email !== undefined) data.email = str(body.email);
    if (body.address !== undefined) data.address = str(body.address);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const customer = await db.customer.update({ where: { id: existing.id }, data });
    await audit({
      action: "updated", entityType: "customer", entityId: customer.id, entityLabel: customer.name,
      actor: user, before: diffFields(existing, customer as unknown as Record<string, unknown>),
    });
    return ok(customer);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "customer.delete");
    const { id } = await params;
    const existing = await db.customer.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Customer tidak ditemukan.");

    const shipmentCount = await db.masterShipment.count({ where: { customerId: existing.id } });
    if (shipmentCount > 0) {
      const customer = await db.customer.update({ where: { id: existing.id }, data: { isActive: false } });
      await audit({ action: "deactivated", entityType: "customer", entityId: customer.id, entityLabel: customer.name, actor: user });
      return ok({ deactivated: true, customer });
    }
    await db.customer.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "customer", entityId: existing.id, entityLabel: existing.name, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
