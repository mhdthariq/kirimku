import { COMPANY_NAME } from "@/shared/company";
import { publicPageMetadata } from "@/shared/seo";

export const metadata = publicPageMetadata(
  `Lacak Paket dan Cek Resi - ${COMPANY_NAME}`,
  `Cek resi ${COMPANY_NAME} secara online. Masukkan nomor resi untuk melihat status pengiriman dan riwayat perjalanan paket Anda.`,
  "/tracking-paket",
);

export default function TrackingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
