import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

/**
 * GET /api/v1/profile — own profile + partner info (bank account etc.).
 *
 * PUT /api/v1/profile — multi-purpose self-service endpoint:
 *   1. Partners (Marketing / Vehicle Owner) maintain their REGISTERED BANK
 *      ACCOUNT used for withdrawals (§24 "Select/use their registered bank
 *      account").
 *   2. ANY authenticated user — including the Owner — can update their own
 *      `name` and change their `password` (with the current password
 *      verified). The Owner is no longer forced to ask another admin to
 *      change these fields.
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
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

/**
 * PUT /api/v1/profile — self-service profile update.
 *
 * Request body (any subset is allowed — only the fields you send are
 * applied, every field is optional):
 *   - name                         (string) new display name
 *   - currentPassword              (string) required ONLY when `newPassword`
 *                                  is sent — verified against the stored hash
 *   - newPassword                  (string) new password (>= 8 chars)
 *   - bankName / bankAccountName /
 *     bankAccountNumber            (partner-only) withdrawal bank account
 *
 * The Owner is allowed to change their own name and password here — the
 * `/users/{id}` admin endpoint keeps its "Owner cannot be edited from UI"
 * guard because that path is meant for managing OTHER users; this endpoint
 * only ever touches the caller's own row.
 */
export async function PUT(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req);
    const body = await req.json().catch(() => ({}));

    // ----- 1. Identity (name + password) — works for EVERY user -------------
    const data: Record<string, unknown> = {};
    const auditNotes: Record<string, unknown> = {};

    const newName = str(body.name);
    if (newName != null) {
      if (newName.length < 2) {
        return fail(422, "Nama minimal 2 karakter.", { name: ["Nama minimal 2 karakter."] });
      }
      data.name = newName;
      auditNotes.name = newName;
    }

    const newPassword = str(body.newPassword);
    if (newPassword) {
      if (newPassword.length < 8) {
        return fail(422, "Password baru minimal 8 karakter.", { newPassword: ["Password baru minimal 8 karakter."] });
      }
      // Verify current password before allowing a change.
      const currentPassword = str(body.currentPassword);
      if (!currentPassword) {
        return fail(422, "Password saat ini wajib diisi untuk mengganti password.", { currentPassword: ["Password saat ini wajib diisi."] });
      }
      const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
      if (!verifyPassword(currentPassword, fresh.passwordHash)) {
        return fail(422, "Password saat ini salah.", { currentPassword: ["Password saat ini salah."] });
      }
      if (currentPassword === newPassword) {
        return fail(422, "Password baru tidak boleh sama dengan password saat ini.", { newPassword: ["Password baru tidak boleh sama dengan password lama."] });
      }
      data.passwordHash = hashPassword(newPassword);
      auditNotes.passwordChanged = true;
    }

    if (Object.keys(data).length > 0) {
      await db.user.update({ where: { id: user.id }, data });
    }

    // ----- 2. Partner bank account (unchanged behaviour) --------------------
    let partnerUpdated: { id: number; type: string; bank: { bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null } } | null = null;
    if (user.partnerId && (body.bankName !== undefined || body.bankAccountName !== undefined || body.bankAccountNumber !== undefined)) {
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
      partnerUpdated = {
        id: updated.id,
        type: updated.type,
        bank: {
          bankName: updated.bankName,
          bankAccountName: updated.bankAccountName,
          bankAccountNumber: updated.bankAccountNumber,
        },
      };
      auditNotes.bankAccountUpdated = true;
    }

    if (Object.keys(data).length === 0 && !partnerUpdated) {
      return ok({ updated: false, message: "Tidak ada perubahan yang dikirim." });
    }

    if (Object.keys(auditNotes).length > 0) {
      await audit({
        action: "updated_self",
        entityType: "user",
        entityId: user.id,
        entityLabel: user.username,
        actor: user,
        after: auditNotes,
      });
    }

    const refreshed = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { id: true, username: true, name: true, isOwner: true },
    });

    return ok({
      updated: true,
      user: refreshed,
      partner: partnerUpdated,
    });
  });
}
