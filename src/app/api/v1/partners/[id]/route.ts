import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num, bool, str } from "@/lib/api-helpers";
import { validateProfitShare, financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/v1/partners/{id} — update a partner's profit-sharing configuration
 * (§4) and/or Partner Alignment (Revise round 7). Historical settlements keep
 * their snapshotted percentages (§37) — only future settlements use the new
 * values. Partner Alignment (warehouseId) is optional: null = "umum"
 * (general — serves every gudang); when set, the partner is affiliated with
 * the named gudang.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "partner.update");
    const { id } = await params;
    const partner = await db.partner.findUnique({ where: { id: Number(id) }, include: { user: { select: { username: true } } } });
    if (!partner) return fail(404, "Partner tidak ditemukan.");

    const body = await req.json().catch(() => ({}));
    const companyPercent = num(body.companyPercent) ?? partner.companyPercent;
    const partnerPercent = num(body.partnerPercent) ?? partner.partnerPercent;
    validateProfitShare(companyPercent, partnerPercent);

    // Revise round 7 — Partner Alignment. Accept either a warehouse id (Int)
    // or null/"general" to clear the alignment.
    let warehouseId: number | null = partner.warehouseId;
    if (body.warehouseId !== undefined) {
      const raw = body.warehouseId;
      if (raw === null || raw === "" || raw === "general" || raw === "none") {
        warehouseId = null;
      } else {
        const wid = num(raw);
        if (wid == null) {
          return fail(422, "Gudang tidak valid.", { warehouseId: ["Gudang tidak valid."] });
        }
        const warehouse = await db.warehouse.findUnique({ where: { id: wid } });
        if (!warehouse || !warehouse.isActive) {
          return fail(422, "Gudang tidak ditemukan / tidak aktif.", { warehouseId: ["Gudang tidak ditemukan / tidak aktif."] });
        }
        warehouseId = warehouse.id;
      }
    }

    const updated = await db.partner.update({
      where: { id: partner.id },
      data: {
        companyPercent,
        partnerPercent,
        isActive: body.isActive === undefined ? partner.isActive : bool(body.isActive, partner.isActive),
        notes: str(body.notes) ?? partner.notes,
        warehouseId,
      },
    });
    await financeAudit(user, "updated", "partner", partner.id, partner.user.username, {
      before: {
        companyPercent: partner.companyPercent,
        partnerPercent: partner.partnerPercent,
        warehouseId: partner.warehouseId,
      },
      after: {
        companyPercent,
        partnerPercent,
        warehouseId,
      },
    });
    return ok(updated);
  });
}
