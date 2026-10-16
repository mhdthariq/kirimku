import { NextRequest } from "next/server";
import { guard, ok, handle, requireNum } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { settlementInput } from "@/composition/settlement-input";
import { mutateInvoiceSettlement } from "@/infrastructure/services/invoice-settlements";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "payment.verify");
    const { id } = await params;
    const input = settlementInput(await req.json().catch(() => ({})));
    const { settlement, invoice, commissionReleased } = await mutateInvoiceSettlement(requireNum(id, "id", 1), user.id, { type: "create", input });
    await audit({ action: "settled", entityType: "invoice", entityId: invoice.id, entityLabel: invoice.invoiceNumber, actor: user,
      after: { status: invoice.status, amount: input.amount, pph: input.pph, commissionReleased, proofAttached: !!input.proofUrl } });
    return ok({ settlement, invoice, commissionReleased });
  });
}
