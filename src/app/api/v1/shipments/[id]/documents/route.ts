import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, str } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";

type Params = { params: Promise<{ id: string }> };
const MAX_DOCUMENT_LENGTH = 12_000_000;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

async function loadShipment(id: string, user: Parameters<typeof assertShipmentScope>[0]) {
  const shipment = await db.masterShipment.findUnique({ where: { id: Number(id) } });
  if (!shipment) return null;
  await assertShipmentScope(user, shipment);
  return shipment;
}

export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.view");
    const { id } = await params;
    const shipment = await loadShipment(id, user);
    if (!shipment) return fail(404, "Shipment tidak ditemukan.");
    return ok(await db.shipmentDocument.findMany({ where: { masterId: shipment.id }, orderBy: { createdAt: "desc" } }));
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.update");
    const { id } = await params;
    const shipment = await loadShipment(id, user);
    if (!shipment) return fail(404, "Shipment tidak ditemukan.");
    if (shipment.status === "CANCELLED") return fail(422, "Shipment yang dibatalkan tidak dapat diberi dokumen.");
    const body = await req.json().catch(() => ({}));
    const fileName = str(body.fileName)?.trim();
    const mimeType = str(body.mimeType);
    const dataUrl = str(body.dataUrl);
    if (!fileName || !mimeType || !dataUrl) return fail(422, "Nama file, tipe file, dan isi dokumen wajib diisi.");
    if (!ALLOWED_TYPES.has(mimeType) || !dataUrl.startsWith(`data:${mimeType};base64,`)) return fail(422, "Dokumen harus berupa PDF, JPEG, PNG, atau WebP.");
    if (dataUrl.length > MAX_DOCUMENT_LENGTH) return fail(422, "Dokumen terlalu besar (maksimal 8 MB).");
    const document = await db.shipmentDocument.create({ data: { masterId: shipment.id, fileName, mimeType, dataUrl } });
    await audit({ action: "created", entityType: "shipment_document", entityId: document.id, entityLabel: `${shipment.masterCode} · ${fileName}`, actor: user, after: { fileName, mimeType } });
    return ok(document);
  });
}