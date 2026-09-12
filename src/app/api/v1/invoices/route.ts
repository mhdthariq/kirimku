import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, requireNum, num, dateOrNull } from "@/lib/api-helpers";
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
                { invoiceNumber: { contains: search } },
                { customer: { name: { contains: search } } },
                { customer: { companyName: { contains: search } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        lines: { include: { shipment: { select: { masterCode: true } } } },
        settlements: true,
        commission: { include: { partner: { include: { user: { select: { name: true } } } } } },
      },
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
          // Revise.md §8 — commission status attached to the invoice
          commission: inv.commission
            ? {
                status: inv.commission.status,
                partnerName: inv.commission.partner.user.name,
                commissionAmount: inv.commission.commissionAmount,
                partnerPercent: inv.commission.partnerPercent,
              }
            : null,
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
      .map((l: { description?: unknown; quantity?: unknown; unitPrice?: unknown; shipmentId?: unknown }) => ({
        description: str(l.description),
        quantity: num(l.quantity) ?? 1,
        unitPrice: num(l.unitPrice) ?? 0,
        // Revise.md §7.1 — link the invoice line to the billed B2B shipment.
        shipmentId: num(l.shipmentId),
      }))
      .filter((l: { description: string | null }) => l.description);
    if (validLines.length === 0) {
      return fail(422, "Minimal satu baris item wajib diisi.", { lines: ["Minimal satu baris item."] });
    }

    // Resolve & validate linked shipments — they must be B2B shipments of
    // this customer. Collect the Marketing partner attribution (§7/§8) from
    // the shipments' creators; all linked shipments must belong to the SAME
    // Marketing partner (or none) so a single commission can be tracked.
    const linkedPartnerIds = new Set<number>();
    const linkedShipmentIds = new Set<number>();
    const resolvedLines: { description: string; quantity: number; unitPrice: number; shipmentId: number | null }[] = [];
    for (const l of validLines as { description: string | null; quantity: number; unitPrice: number; shipmentId: number | null }[]) {
      if (l.shipmentId == null) {
        resolvedLines.push({ description: l.description ?? "", quantity: l.quantity, unitPrice: l.unitPrice, shipmentId: null });
        continue;
      }
      const shipment = await db.masterShipment.findUnique({ where: { id: l.shipmentId } });
      if (!shipment) return fail(404, `Shipment #${l.shipmentId} tidak ditemukan.`);
      if (shipment.customerId !== customerId) {
        return fail(422, `Shipment ${shipment.masterCode} bukan milik customer invoice ini.`, {
          lines: ["Shipment terpilih tidak cocok dengan customer invoice."],
        });
      }
      if (linkedShipmentIds.has(shipment.id)) return fail(422, `Shipment ${shipment.masterCode} hanya boleh muncul satu kali dalam invoice.`);
      const alreadyInvoiced = await db.invoiceLine.findFirst({
        where: { shipmentId: shipment.id },
        include: { invoice: { select: { invoiceNumber: true } } },
      });
      if (alreadyInvoiced) {
        return fail(422, `Shipment ${shipment.masterCode} sudah termasuk dalam invoice ${alreadyInvoiced.invoice.invoiceNumber}.`, {
          lines: ["Shipment yang sudah ditagihkan tidak bisa dipakai lagi."],
        });
      }
      linkedShipmentIds.add(shipment.id);
      if (shipment.createdByPartnerId) linkedPartnerIds.add(shipment.createdByPartnerId);
      resolvedLines.push({ description: l.description ?? "", quantity: l.quantity, unitPrice: l.unitPrice, shipmentId: shipment.id });
    }
    if (linkedPartnerIds.size > 1) {
      return fail(422, "Shipment terpilih dibuat oleh lebih dari satu Marketing partner — pisahkan menjadi invoice terpisah per partner.", {
        lines: ["Shipment dari beberapa Marketing partner tidak bisa digabung."],
      });
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
        lines: { create: resolvedLines },
      },
      include: { lines: true },
    });

    // Revise.md §8 — when the invoice bills Marketing-created B2B shipments,
    // create the PENDING Marketing commission immediately (NO wallet credit
    // yet — §2: the company owns the invoice and Marketing never finances it).
    // The commission is released ONLY when the invoice becomes FULLY PAID (§9).
    let commission: { id: number; commissionCode: string; commissionAmount: number; status: string } | null = null;
    if (linkedPartnerIds.size === 1) {
      const partnerId = Array.from(linkedPartnerIds)[0]!;
      const partner = await db.partner.findUniqueOrThrow({ where: { id: partnerId } });
      const total = resolvedLines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
      const commissionAmount = Math.round(total * (partner.partnerPercent / 100) * 100) / 100;
      const commissionCode = await nextCode("marketingCommission", "COM-", "commissionCode");
      const created = await db.marketingCommission.create({
        data: {
          commissionCode,
          partnerId,
          invoiceId: invoice.id,
          invoiceAmount: total,
          companyPercent: partner.companyPercent,
          partnerPercent: partner.partnerPercent,
          commissionAmount,
          status: "PENDING",
        },
      });
      commission = { id: created.id, commissionCode: created.commissionCode, commissionAmount: created.commissionAmount, status: created.status };
    }

    await audit({ action: "created", entityType: "invoice", entityId: invoice.id, entityLabel: invoice.invoiceNumber, actor: user, after: { customer: customer.name, lines: validLines.length, commission } });
    return ok({ ...invoice, commission });
  });
}
