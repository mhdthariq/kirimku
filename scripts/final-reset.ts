/* Final cleanup: restore seeded demo state (route 1 → 3 checkpoints). */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  await db.checkpoint.deleteMany({ where: { routeId: 1, id: { gt: 3 } } });
  const cps = await db.checkpoint.findMany({ where: { routeId: 1 }, orderBy: { sequence: "asc" } });
  const names = ["Gudang Jakarta Pusat (Start)", "Rest Area KM 57 Cipularang", "Gudang Bandung (End)"];
  for (const [i, c] of cps.entries()) {
    await db.checkpoint.update({ where: { id: c.id }, data: { name: names[i], sequence: i + 1 } });
  }
  console.log("route 1 restored:", (await db.checkpoint.count({ where: { routeId: 1 } })), "checkpoints");
}
main().finally(() => db.$disconnect());
