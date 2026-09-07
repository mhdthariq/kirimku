import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "invoice.update");
    const { id } = await params;
    const invoice = await db.invoice.findUnique({ where: { id: Number(id) } });
    if (!invoice) return fail(404, "Invoice tidak ditemukan.");
    if (invoice.status !== "DRAFT") return fail(422, "Baris item hanya bisa ditambah pada invoice DRAFT.");

    const body = await req.json().catch(() => ({}));
    const description = requireStr(body.description, "description");
    const quantity = num(body.quantity) ?? 1;
    const unitPrice = num(body.unitPrice) ?? 0;
    if (unitPrice <= 0) return fail(422, "Harga satuan harus lebih dari 0.", { unitPrice: ["Harga satuan harus > 0."] });

    const line = await db.invoiceLine.create({ data: { invoiceId: invoice.id, description, quantity, unitPrice } });
    await audit({ action: "created", entityType: "invoice_line", entityId: line.id, entityLabel: `${invoice.invoiceNumber} · ${description}`, actor: user, after: line });
    return ok(line);
  });
}
