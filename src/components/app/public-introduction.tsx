import Link from "next/link";
import { COMPANY_NAME } from "@/shared/company";

export function PublicIntroduction() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-10 text-center" aria-label="Tentang layanan">
      <h1 className="text-3xl font-bold">{COMPANY_NAME} - Manajemen Pengiriman</h1>
      <p className="mt-4 text-muted-foreground">
        Kelola pengiriman dari pickup, penerimaan di gudang, perjalanan transport,
        hingga delivery dalam satu platform. Pantau status dan riwayat perjalanan
        paket Anda menggunakan nomor resi.
      </p>
      <Link href="/tracking-paket" className="mt-5 inline-block font-medium text-primary underline underline-offset-4">
        Lacak paket dan cek status pengiriman
      </Link>
    </section>
  );
}
