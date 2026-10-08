import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";

type Params = { params: Promise<{ id: string }> };

/**
 * Audit-log a transport manifest print / save-as-PDF action (Capacity Round).
 *
 * Mirrors the resi print-log (POST /shipments/:id/print-log). Fired by the
 * TransportManifestPrint's "Cetak / Simpan PDF" button right before
 * `window.print()` opens the OS print dialog. The audit entry captures:
 *   - WHO      → actorId (resolved from the session token by `guard()`)
 *   - WHAT     → action: "printed_manifest"
 *   - WHICH    → entityType: "transport", entityId: transport id
 *   - CONTEXT  → entityLabel: "<transportCode>", after: { printedAt, accountName, roles }
 *
 * Permission: `transport.view` — same gate the UI uses to show the transport.
 * Owner bypasses the permission check. A failed audit write never blocks the
 * print on the client side (the client fires this request fire-and-forget
 * before calling window.print()).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.view");
    const { id } = await params;
    const transport = await db.transport.findUnique({ where: { id: Number(id) } });
    if (!transport) return fail(404, "Transport tidak ditemukan.");

    const roleNames = user.isOwner ? ["Owner"] : user.roles.map((r) => r.name);

    await audit({
      action: "printed_manifest",
      entityType: "transport",
      entityId: transport.id,
      entityLabel: transport.transportCode,
      actor: user,
      after: {
        printedAt: new Date().toISOString(),
        accountName: user.name,
        roles: roleNames,
      },
    });
    return ok({ logged: true });
  });
}
