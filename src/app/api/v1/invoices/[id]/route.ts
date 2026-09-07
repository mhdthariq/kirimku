import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, dateOrNull } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "invoice.view");
    const { id } = await params;
    const invoice = await db.invoice.findUnique({
      where: { id: Number(id) },
      include: { customer: true, lines: { orderBy: { id: "asc" } }, settlements: { orderBy: { settledAt: "desc" } } },
    });
    if (!invoice) return fail(404, "Invoice tidak ditemukan.");
    return ok(invoice);
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "invoice.update");
    const { id } = await params;
    const existing = await db.invoice.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Invoice tidak ditemukan.");
    if (existing.status !== "DRAFT") return fail(422, "Hanya invoice DRAFT yang bisa diubah.");
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.issueDate !== undefined) data.issueDate = dateOrNull(body.issueDate);
    if (body.dueDate !== undefined) data.dueDate = dateOrNull(body.dueDate);
    if (body.notes !== undefined) data.notes = str(body.notes);
    const invoice = await db.invoice.update({ where: { id: existing.id }, data });
    await audit({ action: "updated", entityType: "invoice", entityId: invoice.id, entityLabel: invoice.invoiceNumber, actor: user, before: diffFields(existing, invoice as unknown as Record<string, unknown>) });
    return ok(invoice);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "invoice.update");
    const { id } = await params;
    const existing = await db.invoice.findUnique({ where: { id: Number(id) }, include: { settlements: true } });
    if (!existing) return fail(404, "Invoice tidak ditemukan.");
    if (existing.settlements.length > 0) return fail(422, "Invoice sudah memiliki settlement — batalkan (cancel), jangan hapus.");
    await db.invoice.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "invoice", entityId: existing.id, entityLabel: existing.invoiceNumber, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
