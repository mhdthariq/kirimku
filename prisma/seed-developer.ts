import { seedDeveloperAccount } from "@/infrastructure/services/seed";
import { db } from "@/infrastructure/persistence/db";

async function main() {
  console.log("→ Membuat atau memperbarui akun Developer saja...");
  await seedDeveloperAccount();
  console.log("✔ Akun Developer siap: dev / dev123456 (Owner)");
}

main()
  .catch((error) => {
    console.error("✖ Seeder Developer gagal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });