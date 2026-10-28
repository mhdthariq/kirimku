import { COMPANY_NAME } from "@/shared/company";
import { publicPageMetadata } from "@/shared/seo";

export const metadata = {
  ...publicPageMetadata(
    `Verifikasi Pelacakan Paket - ${COMPANY_NAME}`,
    "Scan QR pada resi dan verifikasi nomor telepon pengirim atau penerima untuk melacak paket.",
    "/tracking-paket",
  ),
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default function TrackingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
