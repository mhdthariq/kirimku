import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { scanProgress } from "@/lib/scan-flow";
import { assertShipmentScope } from "@/lib/gudang-scope";

type Params = { params: Promise<{ id: string }> };

/**
 * Confirm that a shipment has arrived at the gudang (permission:
 * shipment.confirm_arrival — Admin Gudang / Staff Gudang).
 *
 * Body: { warehouseId, mode: "scan" | "walk_in" | "transport", notes? }
 * - mode "scan":      shipment PICKED_UP (kurir brought the packages back) —
 *                     every package must have been scanned first.
 * - mode "walk_in":   customer handed the package over at the gudang counter —
 *                     no scanning needed, allowed straight from CREATED /
 *                     READY_FOR_PICKUP.
 * - mode "transport": shipment AT_DEST_GUDANG (transport driver checked in
 *                     at the LAST checkpoint / unloaded the packages at the
 *                     DESTINATION gudang) — every package must have been
 *                     scanned (transport_arrival context) first; stamps
 *                     destReceivedAt AND moves the status to
 *                     ARRIVED_AT_GUDANG ("Arrived at {Gudang Tujuan}"), so
 *                     the shipment counts as fully received and can be
 *                     assigned for delivery.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.confirm_arrival");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({
      where: { id: Number(id) },
      include: { customer: { select: { name: true } }, details: { select: { id: true } } },
    });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);

    const body = await req.json().catch(() => ({}));
    const mode = ["walk_in", "transport"].includes(body.mode) ? body.mode : "scan";
    const notes = str(body.notes);

    if (mode === "transport") {
      // ------------------------------------------------------------------
      // Transport drop-off at the destination gudang: the driver already
      // checked in at the LAST checkpoint (AT_DEST_GUDANG). Admin Gudang of
      // that gudang scans every package and confirms receipt here — THAT is
      // the moment the shipment becomes "Arrived at {Gudang Tujuan}".
      // (Legacy rows still on ARRIVED_AT_GUDANG with destReceivedAt null are
      // accepted too.)
      // ------------------------------------------------------------------
      const awaitingScan = master.status === "AT_DEST_GUDANG" || (master.status === "ARRIVED_AT_GUDANG" && master.destReceivedAt == null);
      if (!awaitingScan) {
        return fail(422, `Mode transport hanya untuk shipment AT_DEST_GUDANG / menunggu scan Admin Gudang (saat ini: ${master.status}).`);
      }
      if (master.destReceivedAt != null) {
        return fail(422, "Shipment ini sudah diterima & diverifikasi scan di gudang tujuan.");
      }
      if (master.details.length === 0) {
        return fail(422, "Shipment belum punya detail barang.");
      }
      // receiving gudang = where the transport unloaded the packages
      const warehouseId = master.arrivedWarehouseId ?? master.destinationWarehouseId;
      const warehouse = warehouseId ? await db.warehouse.findUnique({ where: { id: warehouseId } }) : null;
      if (!warehouse || !warehouse.isActive) {
        return fail(422, "Gudang tujuan shipment belum jelas - hubungi admin untuk memperbaiki data.");
      }
      if (!user.isOwner && user.warehouseId !== warehouse.id) {
        return fail(403, "Anda hanya bisa menerima paket transport di gudang Anda sendiri.");
      }
      const progress = await scanProgress({ masterId: master.id, context: "transport_arrival" });
      if (!progress.allScanned) {
        return fail(422, `Belum semua paket discan (${progress.scanned}/${progress.total}) - scan semua paket atau gunakan tombol "Scan Semua Paket".`);
      }

      // which gudang did this shipment come from? (the origin branch)
      const originWarehouse = master.originWarehouseId
        ? await db.warehouse.findUnique({ where: { id: master.originWarehouseId }, select: { name: true } })
        : null;
      const description = `Paket diterima di ${warehouse.name} dari transport${originWarehouse ? ` (asal ${originWarehouse.name})` : ""} - ${master.details.length} paket terverifikasi scan`;
      const updated = await db.$transaction(async (tx) => {
        const result = await tx.masterShipment.update({
          where: { id: master.id },
          data: { destReceivedAt: new Date(), status: "ARRIVED_AT_GUDANG" },
        });
        await tx.trackingEvent.create({
          data: {
            masterId: master.id,
            event: "RECEIVED_FROM_TRANSPORT",
            description: notes ? `${description} - ${notes}` : description,
            actorId: user.id,
          },
        });
        return result;
      });
      await audit({
        action: "status_change",
        entityType: "shipment",
        entityId: master.id,
        entityLabel: `${master.masterCode} → received @ ${warehouse.name} (transport drop-off)`,
        actor: user,
        after: { mode, warehouse: warehouse.name, packages: master.details.length },
      });
      return ok({ ...updated, warehouseName: warehouse.name, mode });
    }

    const warehouseId = num(body.warehouseId);
    const warehouse = warehouseId ? await db.warehouse.findUnique({ where: { id: warehouseId } }) : null;
    if (!warehouse || !warehouse.isActive) {
      return fail(422, "Gudang tujuan wajib dipilih.", { warehouseId: ["Gudang tujuan wajib dipilih."] });
    }
    if (!user.isOwner && user.warehouseId !== warehouse.id) {
      return fail(403, "Anda hanya bisa mengonfirmasi arrival di gudang Anda sendiri.");
    }

    if (master.status !== "CREATED" && master.status !== "READY_FOR_PICKUP" && master.status !== "PICKED_UP") {
      return fail(422, `Shipment dengan status ${master.status} tidak bisa dikonfirmasi tiba di gudang.`);
    }

    if (mode === "scan") {
      if (master.status !== "PICKED_UP") {
        return fail(422, `Mode scan hanya untuk shipment PICKED_UP (saat ini: ${master.status}). Gunakan walk-in untuk pelanggan yang datang langsung.`);
      }
      if (master.details.length === 0) {
        return fail(422, "Shipment belum punya detail barang.");
      }
      const progress = await scanProgress({ masterId: master.id, context: "gudang_arrival" });
      if (!progress.allScanned) {
        return fail(422, `Belum semua paket discan (${progress.scanned}/${progress.total}) - scan semua paket atau gunakan tombol "Scan Semua Paket".`);
      }
    } else if (!["CREATED", "READY_FOR_PICKUP"].includes(master.status)) {
      return fail(422, `Walk-in hanya untuk shipment CREATED / READY_FOR_PICKUP (saat ini: ${master.status}).`);
    }

    const description =
      mode === "scan"
        ? `Paket diterima di ${warehouse.name} - ${master.details.length} paket terverifikasi scan${master.customer ? ` (kurir drop-off, shipment ${master.customer.name})` : ""}`
        : `Pelanggan ${master.customer?.name ?? ""} menyerahkan langsung di ${warehouse.name} (walk-in, tanpa scan)`;
    const updated = await db.$transaction(async (tx) => {
      const result = await tx.masterShipment.update({
        where: { id: master.id },
        data: {
          status: "RECEIVED_AT_GUDANG",
          arrivedWarehouseId: warehouse.id,
          originWarehouseId: master.originWarehouseId ?? warehouse.id,
        },
      });
      await tx.pickup.updateMany({
        where: { masterId: master.id, status: { in: ["ASSIGNED", "IN_PROGRESS", "PICKED_UP"] } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await tx.trackingEvent.create({
        data: {
          masterId: master.id,
          event: "RECEIVED_AT_GUDANG",
          description: notes ? `${description} - ${notes}` : description,
          actorId: user.id,
        },
      });
      return result;
    });
    await audit({
      action: "status_change",
      entityType: "shipment",
      entityId: master.id,
      entityLabel: `${master.masterCode} → RECEIVED_AT_GUDANG (${mode === "walk_in" ? "walk-in" : "scan"}) @ ${warehouse.name}`,
      actor: user,
      after: { mode, warehouse: warehouse.name, packages: master.details.length },
    });
    return ok({ ...updated, warehouseName: warehouse.name, mode });
  });
}
