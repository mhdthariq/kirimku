import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { dropProgress } from "@/lib/transport-ops";
import { assertDestinationApprover } from "@/lib/transport-ops-server";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /transports/:id/delivery-approval — approve the WHOLE transport. Every
 * resi must already be DELIVERY_APPROVED (approve them one by one first), so
 * nothing is approved by accident. Stamps the transport, which is what makes
 * the vehicle "empty" and lets a Resi Tugas Balik be created.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.delivery.approve");
    const { id } = await params;
    const transport = await db.transport.findUnique({ where: { id: Number(id) }, include: { shipments: { include: { master: true } } } });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    if (transport.deliveryApprovedAt) return fail(422, "Transport ini sudah disetujui.");
    const progress = dropProgress(transport.shipments.map((s) => s.dropStatus));
    if (progress.total === 0) return fail(422, "Transport tidak punya resi.");
    if (!progress.allApproved) {
      return fail(422, `Belum semua resi disetujui (${progress.approved}/${progress.total}).`);
    }
    // the approver must be allowed for every resi's destination
    for (const s of transport.shipments) await assertDestinationApprover(user, s.master);

    const updated = await db.transport.update({ where: { id: transport.id }, data: { deliveryApprovedAt: new Date(), deliveryApprovedById: user.id } });
    await audit({ action: "approve", entityType: "transport", entityId: transport.id, entityLabel: `${transport.transportCode} → DELIVERY APPROVED (kendaraan kosong)`, actor: user });
    return ok({ id: updated.id, deliveryApprovedAt: updated.deliveryApprovedAt });
  });
}
