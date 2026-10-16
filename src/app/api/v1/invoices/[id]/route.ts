import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, str, dateOrNull, num } from "@/composition/api-helpers";
import { audit, diffFields } from "@/infrastructure/services/audit";

import { invoiceBankSnapshot } from "@/infrastructure/services/invoice-bank-account";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    await guard(req, "invoice.view");
    const { id } = await params;
    const invoice = await db.invoice.findUnique({
      where: { id: Number(id) },
      include: {
        customer: true,
        lines: { orderBy: { id: "asc" }, include: { shipment: { select: { id: true, masterCode: true } } } },
        settlements: { orderBy: { settledAt: "desc" } },
        commission: { include: { partner: { include: { user: { select: { name: true } } } } } },
      },
    });
    if (!invoice) return fail(404, "Invoice tidak ditemukan.");
    const subtotal = invoice.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const total = subtotal - invoice.discount + invoice.rounding;
    const settled = invoice.settlements.reduce((sum, s) => sum + s.amount, 0);
    return ok({ ...invoice, totalAmount: total, pphAmount: invoice.settlements.reduce((sum, s) => sum + s.pph, 0), settledAmount: settled, remainingAmount: total - settled });
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "invoice.update");
    const { id } = await params;
    const existing = await db.invoice.findUnique({ where: { id: Number(id) }, include: { lines: true } });
    if (!existing) return fail(404, "Invoice tidak ditemukan.");
    if (existing.status !== "DRAFT") return fail(422, "Hanya invoice DRAFT yang bisa diubah.");
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.bankAccountId !== undefined && body.bankAccountId !== existing.bankAccountId) Object.assign(data, await invoiceBankSnapshot(body.bankAccountId));
    if (body.issueDate !== undefined) data.issueDate = dateOrNull(body.issueDate);
    if (body.dueDate !== undefined) data.dueDate = dateOrNull(body.dueDate);
    if (body.notes !== undefined) data.notes = str(body.notes);
    if (body.discount !== undefined) {
      const discount = num(body.discount) ?? 0;
      if (discount < 0) return fail(422, "Diskon tidak boleh negatif.", { discount: ["Diskon tidak boleh negatif."] });
      data.discount = discount;
    }
    if (body.rounding !== undefined) data.rounding = num(body.rounding) ?? 0;
    const lines = body.lines === undefined ? null : Array.isArray(body.lines) ? body.lines : [];
    const resolvedLines = lines
      ?.map((line: { description?: unknown; quantity?: unknown; unitPrice?: unknown; shipmentId?: unknown }) => ({
        description: str(line.description),
        quantity: num(line.quantity) ?? 1,
        unitPrice: num(line.unitPrice) ?? 0,
        shipmentId: num(line.shipmentId),
      }))
      .filter((line: { description: string | null }) => line.description);
    if (resolvedLines && resolvedLines.length === 0) return fail(422, "Minimal satu baris item wajib diisi.", { lines: ["Minimal satu baris item."] });
    if (resolvedLines) {
      const shipmentIds = new Set<number>();
      for (const line of resolvedLines) {
        if (line.shipmentId == null) continue;
        if (shipmentIds.has(line.shipmentId)) return fail(422, "Shipment hanya boleh muncul satu kali dalam invoice.");
        const shipment = await db.masterShipment.findUnique({ where: { id: line.shipmentId } });
        if (!shipment) return fail(404, `Shipment #${line.shipmentId} tidak ditemukan.`);
        if (shipment.customerId !== existing.customerId) return fail(422, "Shipment tidak cocok dengan customer invoice.");
        const alreadyInvoiced = await db.invoiceLine.findFirst({ where: { shipmentId: line.shipmentId, invoiceId: { not: existing.id } } });
        if (alreadyInvoiced) return fail(422, "Shipment yang sudah ditagihkan tidak bisa dipakai lagi.");
        shipmentIds.add(line.shipmentId);
      }
    }
    const invoice = await db.$transaction(async (tx) => {
      if (resolvedLines) {
        await tx.invoiceLine.deleteMany({ where: { invoiceId: existing.id } });
        data.lines = { create: resolvedLines };
      }
      return tx.invoice.update({ where: { id: existing.id }, data });
    });
    await audit({ action: "updated", entityType: "invoice", entityId: invoice.id, entityLabel: invoice.invoiceNumber, actor: user, before: diffFields(existing, invoice as unknown as Record<string, unknown>) });
    return ok(invoice);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "invoice.update");
    const { id } = await params;
    const existing = await db.invoice.findUnique({ where: { id: Number(id) }, include: { settlements: true } });
    if (!existing) return fail(404, "Invoice tidak ditemukan.");
    if (existing.settlements.length > 0) return fail(422, "Invoice sudah memiliki settlement - batalkan (cancel), jangan hapus.");
    await db.invoice.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "invoice", entityId: existing.id, entityLabel: existing.invoiceNumber, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
