import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, str } from "@/lib/api-helpers";

/**
 * GET /api/v1/profile — own profile + partner info (bank account etc.).
 * PUT /api/v1/profile — partner updates their REGISTERED BANK ACCOUNT used
 * for withdrawals (§24 "Select/use their registered bank account").
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    const full = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        roles: { include: { role: { select: { name: true, slug: true } } } },
        employee: { include: { warehouse: { select: { name: true, city: true } } } },
        partner: true,
      },
    });
    return ok({
      id: full.id,
      username: full.username,
      name: full.name,
      isOwner: full.isOwner,
      roles: full.roles.map((r) => r.role),
      warehouse: full.employee?.warehouse ? { name: full.employee.warehouse.name, city: full.employee.warehouse.city } : null,
      partner: full.partner
        ? {
            id: full.partner.id,
            type: full.partner.type,
            profitShare: { company: full.partner.companyPercent, partner: full.partner.partnerPercent },
            bank: {
              bankName: full.partner.bankName,
              bankAccountName: full.partner.bankAccountName,
              bankAccountNumber: full.partner.bankAccountNumber,
            },
          }
        : null,
    });
  });
}

/** PUT /api/v1/profile — partner maintains own withdrawal bank account. */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    if (!user.partnerId) {
      return ok({ updated: false, message: "Bukan akun partner — tidak ada rekening yang perlu diperbarui." });
    }
    const body = await req.json().catch(() => ({}));
    const bankName = str(body.bankName);
    const bankAccountName = str(body.bankAccountName);
    const bankAccountNumber = str(body.bankAccountNumber);
    const updated = await db.partner.update({
      where: { id: user.partnerId },
      data: {
        bankName: bankName ?? undefined,
        bankAccountName: bankAccountName ?? undefined,
        bankAccountNumber: bankAccountNumber ?? undefined,
      },
    });
    return ok({
      updated: true,
      partner: {
        id: updated.id,
        type: updated.type,
        bank: {
          bankName: updated.bankName,
          bankAccountName: updated.bankAccountName,
          bankAccountNumber: updated.bankAccountNumber,
        },
      },
    });
  });
}
