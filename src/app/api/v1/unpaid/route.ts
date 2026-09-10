import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";
import { cityIndex, inScope, scopeForUser, shipmentGudangIds } from "@/lib/gudang-scope";

/** Unpaid B2C shipments (priced, not yet settled) — scoped to the user's gudang. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "payment.unpaid.view");
    const shipments = await db.masterShipment.findMany({
      where: {
        customer: { type: "b2c" },
        status: { not: "CANCELLED" },
        priceAmount: { not: null },
      },
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        payments: { orderBy: { createdAt: "desc" }, include: { recordedBy: true } },
      },
    });
    // Gudang data separation — only the owner sees unpaid shipments of every
    // gudang; other users only see their own gudang's shipments.
    const scope = await scopeForUser(user);
    const cityIdx = await cityIndex();
    const visible = shipments.filter((s) => inScope(shipmentGudangIds(s, cityIdx), scope));
    return ok(
      visible.map((s) => {
        const paid = s.payments.filter((p) => p.status === "VERIFIED").reduce((sum, p) => sum + p.amount, 0);
        const pending = s.payments.filter((p) => p.status === "RECORDED").reduce((sum, p) => sum + p.amount, 0);
        return {
          id: s.id,
          masterCode: s.masterCode,
          status: s.status,
          destination: s.destination,
          customerName: s.customer.name,
          customerPhone: s.customer.phone,
          priceAmount: s.priceAmount ?? 0,
          paidAmount: paid,
          pendingAmount: pending,
          remainingAmount: Math.max(0, (s.priceAmount ?? 0) - paid - pending),
          payments: s.payments.map((p) => ({
            id: p.id, method: p.method, amount: p.amount, status: p.status,
            reference: p.reference, createdAt: p.createdAt, recordedByName: p.recordedBy?.name ?? null,
          })),
        };
      }),
    );
  });
}
