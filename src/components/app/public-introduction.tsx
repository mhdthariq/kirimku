import { COMPANY_NAME } from "@/shared/company";

export function PublicIntroduction() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-10 text-center" aria-label="Tentang layanan">
      <h1 className="text-3xl font-bold">{COMPANY_NAME} - Manajemen Pengiriman</h1>
      <p className="mt-4 text-muted-foreground">
        Kelola pengiriman dari pickup, penerimaan di gudang, perjalanan transport,
        hingga delivery dalam satu platform. Pantau status dan riwayat perjalanan
        paket Anda dengan scan QR pada resi dan verifikasi nomor telepon pengirim atau penerima.
      </p>
    </section>
  );
}
