/**
 * Standalone database seeder (mock-up data).
 *
 * Usage:
 *   bun run db:seed        (recommended — resolves tsconfig paths)
 *
 * The seeder is IDEMPOTENT: running it multiple times is safe.
 * It skips any entity that already exists, so it can be used to
 * re-sync missing demo data without duplicating rows.
 *
 * The app ALSO auto-seeds on the first API request after a fresh
 * `prisma db push` (see src/lib/seed.ts → ensureSeed), mirroring a
 * "migrate + seed on boot" docker workflow. This CLI script simply
 * exposes the same routine for manual / CI usage.
 */
import { ensureSeed } from "../src/lib/seed";
import { db } from "../src/lib/db";

async function main() {
  console.log("→ Menjalankan seeder mock-up data...");
  await ensureSeed();

  // Report what is in the database now.
  const [users, employees, warehouses, vehicles, routes, checkpoints, tariffs, customers, shipments, shipmentDetails, pickups, deliveries, transports, invoices, payments, auditLogs] =
    await Promise.all([
      db.user.count(),
      db.employee.count(),
      db.warehouse.count(),
      db.vehicle.count(),
      db.route.count(),
      db.checkpoint.count(),
      db.tariff.count(),
      db.customer.count(),
      db.masterShipment.count(),
      db.detailShipment.count(),
      db.pickup.count(),
      db.delivery.count(),
      db.transport.count(),
      db.invoice.count(),
      db.payment.count(),
      db.auditLog.count(),
    ]);

  console.log("✔ Seed selesai. Ringkasan data mock-up:");
  console.log(`   Users: ${users} (owner + 8 staff)`);
  console.log(`   Employees: ${employees}`);
  console.log(`   Gudang: ${warehouses}`);
  console.log(`   Vehicles: ${vehicles}`);
  console.log(`   Routes: ${routes} | Checkpoints: ${checkpoints}`);
  console.log(`   Tariffs: ${tariffs}`);
  console.log(`   Customers: ${customers}`);
  console.log(`   Shipments: ${shipments} | Detail items: ${shipmentDetails}`);
  console.log(`   Pickups: ${pickups} | Deliveries: ${deliveries}`);
  console.log(`   Transports: ${transports}`);
  console.log(`   Invoices: ${invoices} | Payments: ${payments}`);
  console.log(`   Audit logs: ${auditLogs}`);
  console.log("");
  console.log("Akun demo:");
  console.log("  owner  / ChangeMeOwner#2026   (akses penuh)");
  console.log("  siti   / Demo#Pass2026        (admin kantor)");
  console.log("  budi   / Demo#Pass2026        (marketing)");
  console.log("  agus   / Demo#Pass2026        (admin gudang)");
  console.log("  dewi   / Demo#Pass2026        (kurir)");
  console.log("  rizky  / Demo#Pass2026        (kurir)");
  console.log("  joko   / Demo#Pass2026        (driver)");
  console.log("  andi   / Demo#Pass2026        (kenek)");
  console.log("  wawan  / Demo#Pass2026        (staff gudang, scoped ke Gudang Jakarta Pusat)");
}

main()
  .catch((e) => {
    console.error("✖ Seed gagal:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
