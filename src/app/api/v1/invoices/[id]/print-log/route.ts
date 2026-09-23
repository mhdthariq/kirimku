import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/**
 * Audit-log an invoice print / save-as-PDF action.
 *
 * Fired by the InvoicePrint preview's "Cetak / Simpan PDF" button right
 * before `window.print()` opens the OS print dialog. The audit entry
 * captures:
 *   - WHO      → actorId (resolved from the session token by `guard()`)
 *   - WHAT     → action: "printed_invoice"
 *   - WHICH    → entityType: "invoice", entityId: invoice id
 *   - CONTEXT  → entityLabel: "<invoiceNumber>", after: { printedAt, accountName, roles }
 *
 * Uses `invoice.view` permission — anyone who can see an invoice can print
 * it (matching the existing invoice page behavior where there is no
 * separate print permission). Owner bypasses the permission check.
 *
 * Like the resi print-log endpoint, the client fires this request
 * fire-and-forget before calling window.print(), so a failed audit write
 * never blocks the print itself.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "invoice.view");
    const { id } = await params;
    const invoice = await db.invoice.findUnique({
      where: { id: Number(id) },
    });
    if (!invoice) return fail(404, "Invoice tidak ditemukan.");

    const roleNames = user.isOwner
      ? ["Owner"]
      : user.roles.map((r) => r.name);

    await audit({
      action: "printed_invoice",
      entityType: "invoice",
      entityId: invoice.id,
      entityLabel: invoice.invoiceNumber,
      actor: user,
      after: {
        printedAt: new Date().toISOString(),
        accountName: user.name,
        roles: roleNames,
      },
    });
    return ok({ logged: true });
  });
}
