import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num, bool, str } from "@/lib/api-helpers";
import { validateProfitShare, financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/v1/partners/{id} — update a partner's profit-sharing configuration
 * (§4). Historical settlements keep their snapshotted percentages (§37) —
 * only future settlements use the new values.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "partner.update");
    const { id } = await params;
    const partner = await db.partner.findUnique({ where: { id: Number(id) }, include: { user: { select: { username: true } } } });
    if (!partner) return fail(404, "Partner tidak ditemukan.");

    const body = await req.json().catch(() => ({}));
    const companyPercent = num(body.companyPercent) ?? partner.companyPercent;
    const partnerPercent = num(body.partnerPercent) ?? partner.partnerPercent;
    validateProfitShare(companyPercent, partnerPercent);

    const updated = await db.partner.update({
      where: { id: partner.id },
      data: {
        companyPercent,
        partnerPercent,
        isActive: body.isActive === undefined ? partner.isActive : bool(body.isActive, partner.isActive),
        notes: str(body.notes) ?? partner.notes,
      },
    });
    await financeAudit(user, "updated", "partner", partner.id, partner.user.username, {
      before: { companyPercent: partner.companyPercent, partnerPercent: partner.partnerPercent },
      after: { companyPercent, partnerPercent },
    });
    return ok(updated);
  });
}
