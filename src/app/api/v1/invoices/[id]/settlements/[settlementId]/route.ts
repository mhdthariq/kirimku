import { NextRequest } from "next/server";
import { guard, ok, handle, requireNum } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { settlementInput } from "@/composition/settlement-input";
import { mutateInvoiceSettlement } from "@/infrastructure/services/invoice-settlements";

type Params = { params: Promise<{ id: string; settlementId: string }> };

async function mutate(req: NextRequest, params: Params["params"], type: "update" | "delete") {
  return handle(req, async () => {
    const user = await guard(req, `invoice.settlement.${type}`);
    const { id, settlementId } = await params;
    const ids = { settlementId: requireNum(settlementId, "settlementId", 1) };
    const mutation = type === "delete" ? { type, ...ids } : { type, ...ids, input: settlementInput(await req.json().catch(() => ({}))) };
    const { previous, ...result } = await mutateInvoiceSettlement(requireNum(id, "id", 1), user.id, mutation);
    const snapshot = (row: typeof previous | undefined) => row ? { id: row.id, amount: row.amount, pph: row.pph, method: row.method, reference: row.reference, settledAt: row.settledAt, proofAttached: !!row.proofUrl } : null;
    await audit({ action: type === "delete" ? "settlement_deleted" : "settlement_updated", entityType: "invoice", entityId: result.invoice.id, entityLabel: result.invoice.invoiceNumber, actor: user,
      before: snapshot(previous), after: { settlement: snapshot(result.settlement), status: result.invoice.status } });
    return ok({ ...result, deleted: type === "delete" });
  });
}

export function PUT(req: NextRequest, { params }: Params) { return mutate(req, params, "update"); }
export function DELETE(req: NextRequest, { params }: Params) { return mutate(req, params, "delete"); }
