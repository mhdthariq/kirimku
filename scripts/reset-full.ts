/* Full demo reset: restore seeded state after E2E testing. */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const today = new Date("2026-09-10");
  // remove test transports
  const ts = await db.transport.findMany({ where: { createdAt: { gte: today } }, include: { shipments: true } });
  for (const t of ts) {
    for (const s of t.shipments) {
      await db.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "RECEIVED_AT_GUDANG", arrivedWarehouseId: null } }).catch(() => undefined);
    }
    await db.transport.delete({ where: { id: t.id } });
    console.log("deleted", t.transportCode);
  }
  // reset route 1 checkpoints to seeded 3
  await db.checkpoint.deleteMany({ where: { routeId: 1, id: { gt: 3 } } });
  await db.checkpoint.updateMany({ where: { routeId: 1 }, data: {} });
  const cp1 = await db.checkpoint.findUnique({ where: { id: 1 } });
  if (cp1) await db.checkpoint.update({ where: { id: 1 }, data: { name: "Gudang Jakarta Pusat (Start)" } });
  // reset pickup 5
  const pickup = await db.pickup.findUnique({ where: { pickupCode: "PICK-2026-000001" } });
  if (pickup) {
    await db.handoverScan.deleteMany({ where: { pickupId: pickup.id, scannedAt: { gte: today } } });
    await db.pickup.update({ where: { id: pickup.id }, data: { status: "ASSIGNED", completedAt: null } });
    await db.masterShipment.update({ where: { id: pickup.masterId }, data: { status: "READY_FOR_PICKUP", arrivedWarehouseId: null } });
    await db.handoverScan.deleteMany({ where: { masterId: pickup.masterId, context: "gudang_arrival", scannedAt: { gte: today } } });
    console.log("pickup 5 reset");
  }
  // remove test check-in records & audit entries from today
  await db.checkpointRecord.deleteMany({ where: { recordedAt: { gte: today } } });
  console.log("reset complete");
}
main().finally(() => db.$disconnect());
