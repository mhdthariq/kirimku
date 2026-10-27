import Home from "@/components/app/legacy-home";
import { COMPANY_NAME } from "@/shared/company";
import { publicPageMetadata } from "@/shared/seo";

export const metadata = publicPageMetadata(
  `${COMPANY_NAME} - Manajemen Pengiriman dan Lacak Paket`,
  `${COMPANY_NAME} membantu pengelolaan pengiriman, pickup, gudang, transport, dan delivery. Lacak status paket Anda secara online dengan nomor resi.`,
  "/",
);

export default function Page() {
  return <Home />;
}
