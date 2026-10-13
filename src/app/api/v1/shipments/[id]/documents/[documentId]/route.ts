import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";

type Params = { params: Promise<{ id: string; documentId: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.update");
    const { id, documentId } = await params;
    const shipment = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!shipment) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, shipment);
    const document = await db.shipmentDocument.findFirst({ where: { id: Number(documentId), masterId: shipment.id } });
    if (!document) return fail(404, "Dokumen tidak ditemukan.");
    await db.shipmentDocument.delete({ where: { id: document.id } });
    await audit({ action: "deleted", entityType: "shipment_document", entityId: document.id, entityLabel: `${shipment.masterCode} · ${document.fileName}`, actor: user, before: { fileName: document.fileName, mimeType: document.mimeType } });
    return ok({ deleted: true });
  });
}