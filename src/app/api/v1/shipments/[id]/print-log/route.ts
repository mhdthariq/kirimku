import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/**
 * Audit-log a resi print / save-as-PDF action.
 *
 * Fired by the ResiPrint preview's "Cetak / Simpan PDF" button right before
 * `window.print()` opens the OS print dialog. The audit entry captures:
 *   - WHO      → actorId (resolved from the session token by `guard()`)
 *   - WHAT     → action: "printed_resi"
 *   - WHICH    → entityType: "shipment", entityId: master shipment id
 *   - CONTEXT  → entityLabel: "<masterCode>", after: { printedAt, accountName, roles }
 *
 * The endpoint is idempotent in the sense that calling it twice creates two
 * audit entries — each click of the "Cetak" button is a separate print
 * action and should be logged as such. A failed audit write never blocks
 * the print on the client side (the client fires this request
 * fire-and-forget before calling window.print()).
 *
 * Permission: `shipment.print_resi` — same gate the UI uses to show the
 * "Cetak Resi" button. Owner bypasses the permission check.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.print_resi");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({
      where: { id: Number(id) },
    });
    if (!master) return fail(404, "Shipment tidak ditemukan.");

    const roleNames = user.isOwner
      ? ["Owner"]
      : user.roles.map((r) => r.name);

    await audit({
      action: "printed_resi",
      entityType: "shipment",
      entityId: master.id,
      entityLabel: master.masterCode,
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
