import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "invoice.update");
    const { id } = await params;
    const existing = await db.invoiceLine.findUnique({ where: { id: Number(id) }, include: { invoice: true } });
    if (!existing) return fail(404, "Baris item tidak ditemukan.");
    if (existing.invoice.status !== "DRAFT") return fail(422, "Baris item hanya bisa dihapus pada invoice DRAFT.");
    await db.invoiceLine.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "invoice_line", entityId: existing.id, entityLabel: `${existing.invoice.invoiceNumber} · ${existing.description}`, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
