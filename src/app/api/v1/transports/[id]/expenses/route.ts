import { NextRequest } from "next/server";
import sharp from "sharp";
import { parseEvidenceMetadata } from "@/infrastructure/services/evidence-photo";
import { watermarkActivityPhoto } from "@/infrastructure/services/activity-watermark";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, str } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { nextCode } from "@/infrastructure/services/code-generator";
import { summarizeExpenses, validateExpense, validateExpenseLocation } from "@/domain/transport-ops";
import { assertTransportAccess, parseOptionalPhoto } from "@/infrastructure/services/transport-ops-server";
import { parseExpensePhotos } from "@/infrastructure/services/expense-photos";
import { expensePhotoUrls, MAX_EXPENSE_PHOTOS } from "@/domain/expense-photos";

type Params = { params: Promise<{ id: string }> };

async function loadTransport(id: string) {
  return db.transport.findUnique({
    where: { id: Number(id) },
    include: { route: true, driver: true, vehicle: true, shipments: { include: { master: true } } },
  });
}

/** GET /transports/:id/expenses — every expense of the transport + totals per type. */
export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.expense.view");
    const { id } = await params;
    const transport = await loadTransport(id);
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);

    const rows = await db.transportExpense.findMany({ where: { transportId: transport.id }, orderBy: [{ createdAt: "desc" }] });
    // The photo itself is a large data URL: list responses only say whether one exists.
    return ok(
      rows.map(({ photoUrl, photoUrls, ...r }) => ({ ...r, hasPhoto: expensePhotoUrls({ photoUrl, photoUrls }).length > 0, photoCount: expensePhotoUrls({ photoUrl, photoUrls }).length })),
      { summary: summarizeExpenses(rows) },
    );
  });
}

/** POST — type and amount required; GPS, capture metadata and receipt photos optional. */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.expense.create");
    const { id } = await params;
    const transport = await loadTransport(id);
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);
    if (transport.status === "COMPLETED") return fail(409, "Transport sudah COMPLETED. Biaya operasional tidak dapat ditambahkan.");

    const parsed = await req.json().catch(() => null);
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const problem = validateExpense({ type: body.type, amount: body.amount });
    if (problem) return fail(422, problem, { type: [problem] });
    const evidence = parseEvidenceMetadata(body);
    if ("error" in evidence) return fail(422, evidence.error);
    const { metadata } = evidence;
    const hasLocation = [body.latitude, body.longitude, body.locationAccuracy].some(value => value !== undefined);
    const locationProblem = hasLocation ? validateExpenseLocation(body) : null;
    if (locationProblem) return fail(422, locationProblem, { location: [locationProblem] });
    const photo = parseOptionalPhoto(body.photo);
    if (photo.error) return fail(422, photo.error, { photo: [photo.error] });
    const proof = parseExpensePhotos(body);
    if (proof.error) return fail(422, proof.error, { photos: [proof.error] });

    const stamp = async (url: string) => {
      if (!hasLocation) {
        await sharp(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"), { limitInputPixels: 20_000_000 }).resize({ width: 1, height: 1, fit: "inside" }).toBuffer();
        return url;
      }
      return watermarkActivityPhoto(url, {
        ...metadata, latitude: body.latitude, longitude: body.longitude, locationAccuracy: body.locationAccuracy,
        transportCode: transport.transportCode, recordedBy: user.name, label: `Biaya ${body.type}`,
        origin: transport.origin ?? transport.route?.origin ?? undefined,
        destination: transport.destination ?? transport.route?.destination ?? undefined,
        shipmentCount: transport.shipments.length,
        vehiclePlate: transport.vehicle?.vehicleNumber,
        vehicleDescription: transport.vehicle?.name ?? undefined,
        driverName: transport.driver?.name,
      }, Math.floor(10 * 1024 * 1024 / MAX_EXPENSE_PHOTOS));
    };
    let photoUrl = photo.photoUrl;
    let photoUrls = proof.photos;
    try {
      if (photoUrl) photoUrl = await stamp(photoUrl);
      if (photoUrls) {
        const stamped: string[] = [];
        for (const url of photoUrls) stamped.push(await stamp(url));
        photoUrls = stamped;
      }
    } catch {
      return fail(422, "Foto bukti tidak dapat diproses. Ambil ulang foto.");
    }

    const expenseCode = await nextCode("transportExpense", "EXP-2026-", "expenseCode");
    const created = await db.transportExpense.create({
      data: {
        expenseCode,
        transportId: transport.id,
        type: String(body.type),
        amount: Number(body.amount),
        description: str(body.description),
        photoUrl,
        ...(photoUrls ? { photoUrls } : {}),
        ...metadata,
        createdById: user.id,
        latitude: body.latitude,
        longitude: body.longitude,
        locationAccuracy: body.locationAccuracy,
        status: "PENDING",
      },
    });
    await audit({
      action: "create",
      entityType: "transport_expense",
      entityId: created.id,
      entityLabel: `${transport.transportCode} · ${created.type} Rp${created.amount.toLocaleString("id-ID")}`,
      actor: user,
      after: { type: created.type, amount: created.amount, hasPhoto: photo.photoUrl != null, status: created.status, latitude: created.latitude, longitude: created.longitude, locationAccuracy: created.locationAccuracy, ...metadata },
    });
    const { photoUrl: storedPhoto, photoUrls: storedPhotos, ...rest } = created;
    const photoCount = expensePhotoUrls({ photoUrl: storedPhoto, photoUrls: storedPhotos }).length;
    return ok({ ...rest, hasPhoto: photoCount > 0, photoCount });
  });
}
