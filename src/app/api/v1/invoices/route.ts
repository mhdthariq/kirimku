import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, requireNum, num, dateOrNull, ci } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req, "invoice.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const status = str(params.get("status"));

    const invoices = await db.invoice.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: ci(search) },
                { customer: { name: ci(search) } },
                { customer: { companyName: ci(search) } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { customer: true, lines: true, settlements: true },
    });
    return ok(
      invoices.map((inv) => {
        const total = inv.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
        const settled = inv.settlements.reduce((sum, s) => sum + s.amount, 0);
        const isOverdue = inv.status === "SENT" && inv.dueDate != null && inv.dueDate < new Date();
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          customerId: inv.customerId,
          customerName: inv.customer.companyName ?? inv.customer.name,
          customerCode: inv.customer.code,
          customerType: inv.customer.type,
          status: inv.status,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          notes: inv.notes,
          linesCount: inv.lines.length,
          totalAmount: total,
          settledAmount: settled,
          remainingAmount: total - settled,
          isOverdue,
          createdAt: inv.createdAt,
        };
      }),
    );
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "invoice.create");
    const body = await req.json().catch(() => ({}));
    const customerId = num(body.customerId);
    if (!customerId) return fail(422, "Customer wajib dipilih.", { customerId: ["Customer wajib dipilih."] });
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) return fail(422, "Customer tidak ditemukan.", { customerId: ["Customer tidak ditemukan."] });
    if (customer.type !== "b2b") {
      return fail(422, "Invoice B2B hanya untuk customer b2b. Pembayaran b2c dicatat per shipment.", {
        customerId: ["Invoice hanya untuk customer B2B."],
      });
    }

    const lines = Array.isArray(body.lines) ? body.lines : [];
    const validLines = lines
      .map((l: { description?: unknown; quantity?: unknown; unitPrice?: unknown }) => ({
        description: str(l.description),
        quantity: num(l.quantity) ?? 1,
        unitPrice: num(l.unitPrice) ?? 0,
      }))
      .filter((l: { description: string | null }) => l.description);
    if (validLines.length === 0) {
      return fail(422, "Minimal satu baris item wajib diisi.", { lines: ["Minimal satu baris item."] });
    }

    const invoiceNumber = await nextCode("invoice", "INV-2026-", "invoiceNumber");
    const invoice = await db.invoice.create({
      data: {
        invoiceNumber,
        customerId,
        status: "DRAFT",
        issueDate: dateOrNull(body.issueDate),
        dueDate: dateOrNull(body.dueDate),
        notes: str(body.notes),
        lines: { create: validLines.map((l: { description: string | null; quantity: number; unitPrice: number }) => ({ description: l.description ?? "", quantity: l.quantity, unitPrice: l.unitPrice })) },
      },
      include: { lines: true },
    });
    await audit({ action: "created", entityType: "invoice", entityId: invoice.id, entityLabel: invoice.invoiceNumber, actor: user, after: { customer: customer.name, lines: validLines.length } });
    return ok(invoice);
  });
}
