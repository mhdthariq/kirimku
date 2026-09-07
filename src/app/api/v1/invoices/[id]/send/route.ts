import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, dateOrNull } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/** Send / finalize a DRAFT invoice (locks its lines). */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "invoice.send");
    const { id } = await params;
    const invoice = await db.invoice.findUnique({ where: { id: Number(id) }, include: { lines: true } });
    if (!invoice) return fail(404, "Invoice tidak ditemukan.");
    if (invoice.status !== "DRAFT") return fail(422, `Invoice berstatus ${invoice.status}, hanya DRAFT yang bisa dikirim.`);
    if (invoice.lines.length === 0) return fail(422, "Invoice belum memiliki baris item.");

    const body = await req.json().catch(() => ({}));
    const issueDate = dateOrNull(body.issueDate) ?? invoice.issueDate ?? new Date();
    const dueDate = dateOrNull(body.dueDate) ?? invoice.dueDate ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const updated = await db.invoice.update({ where: { id: invoice.id }, data: { status: "SENT", issueDate, dueDate } });
    await audit({ action: "status_change", entityType: "invoice", entityId: invoice.id, entityLabel: `${invoice.invoiceNumber} → SENT`, actor: user });
    return ok(updated);
  });
}
