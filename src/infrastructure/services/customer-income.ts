import { db } from "@/infrastructure/persistence/db";

/** Customer receipts are independent from partner wallets and expenses. */
export async function customerIncomeSummary() {
  const [b2c, pending, invoices] = await Promise.all([
    db.payment.groupBy({ by: ["method"], where: { status: "VERIFIED", master: { customer: { type: "b2c" } } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { status: "RECORDED", master: { customer: { type: "b2c" } } }, _sum: { amount: true } }),
    db.invoice.findMany({ where: { customer: { type: "b2b" }, status: { in: ["SENT", "PARTIALLY_SETTLED", "SETTLED"] } }, select: { discount: true, rounding: true, lines: { select: { quantity: true, unitPrice: true } }, settlements: { select: { amount: true } } } }),
  ]);
  return {
    b2cReceived: b2c.reduce((sum, row) => sum + (row._sum.amount ?? 0), 0),
    b2cCash: b2c.find(row => row.method === "CASH")?._sum.amount ?? 0,
    b2cTransfer: b2c.find(row => row.method === "TRANSFER")?._sum.amount ?? 0,
    b2cPending: pending._sum.amount ?? 0,
    b2bOutstanding: invoices.reduce((sum, invoice) => sum + Math.max(0, invoice.lines.reduce((total, line) => total + line.quantity * line.unitPrice, 0) - invoice.discount + invoice.rounding - invoice.settlements.reduce((total, settlement) => total + settlement.amount, 0)), 0),
  };
}
