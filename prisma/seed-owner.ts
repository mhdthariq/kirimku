/**
 * Standalone OWNER-ONLY seeder — creates just the single Owner login (plus
 * the RBAC catalog the owner role depends on). No gudang, no staff, no
 * partners, no wallets, no transactional demo data.
 *
 * Usage:
 *   bun run db:seed:owner    # recommended — runs this file via the
 *                            # `db:seed:owner` script in package.json
 *
 * Why this exists separately from `bun run db:seed:accounts`:
 *   The accounts-only seeder creates 22 users + 3 gudang + 7 partners + 7
 *   wallets — useful for demoing role-based access, but the other 21 accounts
 *   each pull in related rows (employees → warehouses, partners → wallets,
 *   role assignments) that aren't strictly "operational data" but aren't
 *   empty either. This script goes one step further: it creates ONLY the
 *   owner, so when you log in as owner, every page is genuinely empty.
 *   The owner then builds gudang, staff, customers, and shipments from
 *   scratch via the UI.
 *
 * Idempotent: every upsert is keyed by a natural identifier
 * (employee.employeeNumber, user.username), so running this multiple times
 * is safe. It is also safe to run BEFORE or AFTER `db:seed:accounts` or
 * `db:seed` — all three seeders converge on the same owner row.
 *
 * Demo account created:
 *   owner  / ChangeMeOwner#2026   (akses penuh — satu-satunya user di sistem)
 */
import { seedOwnerOnly } from "../src/lib/seed";
import { db } from "../src/lib/db";

async function main() {
  console.log("→ Menjalankan seeder OWNER SAJA (tanpa staff, gudang, partner, atau data lain)...");
  await seedOwnerOnly();

  // Report what is in the database now.
  const [users, employees, warehouses, partners, wallets, roles, rolePermissions] =
    await Promise.all([
      db.user.count(),
      db.employee.count(),
      db.warehouse.count(),
      db.partner.count(),
      db.wallet.count(),
      db.role.count(),
      db.rolePermission.count(),
    ]);

  console.log("✔ Seed owner selesai. Ringkasan:");
  console.log(`   Users: ${users} (owner saja)`);
  console.log(`   Employees: ${employees} (owner saja)`);
  console.log(`   Gudang: ${warehouses} (kosong — buat sendiri lewat UI)`);
  console.log(`   Partners: ${partners} (kosong)`);
  console.log(`   Wallets: ${wallets} (kosong)`);
  console.log(`   RBAC: ${roles} roles · ${rolePermissions} role-permission links`);
  console.log("");
  console.log("Akun demo:");
  console.log("  owner  / ChangeMeOwner#2026   (akses penuh — satu-satunya user di sistem)");
  console.log("");
  console.log("Tidak ada gudang, staff, partner, atau data operasional dibuat.");
  console.log("Login sebagai owner dan bangun semuanya dari awal lewat UI:");
  console.log("  1. Gudang → Tambah Gudang (mis. Medan, Banda Aceh, Lhokseumawe)");
  console.log("  2. Access Control → Users → Tambah Staff (siti, budi, agus, dst.)");
  console.log("  3. Partners → Tambah Partner (marketing / vehicle owner)");
  console.log("  4. Vehicles, Routes, Tariffs, Customers, Shipments → buat sesuai kebutuhan");
  console.log("");
  console.log("Butuh semua akun demo tanpa data operasional? `bun run db:seed:accounts`.");
  console.log("Butuh dataset demo lengkap (shipments, invoices, dst.)? `bun run db:seed`.");
}

main()
  .catch((e) => {
    console.error("✖ Seed owner gagal:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
