import sharp from "sharp";
import { COMPANY_NAME } from "@/shared/company";

export interface ActivityWatermark {
  capturedAt: Date;
  latitude: number;
  longitude: number;
  locationAccuracy: number | null;
  transportCode?: string;
  recordedBy?: string;
  label?: string;
}

function xml(value: string, max = 48): string {
  return Array.from(value.replace(/[\u0000-\u001f]/g, " ")).slice(0, max).join("")
    .replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}

/** No authenticity claim: capture time and GPS are submitted device metadata. */
export function activityWatermarkSvg(meta: ActivityWatermark, width: number, height: number): string {
  const time = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(meta.capturedAt).replace(".", ":");
  const date = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(meta.capturedAt);
  const gps = `${meta.latitude.toFixed(6)}, ${meta.longitude.toFixed(6)}`;
  const accuracy = meta.locationAccuracy == null ? "Akurasi tidak tersedia" : `Akurasi GPS ±${Math.round(meta.locationAccuracy)} m`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 290">
    <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#062c26"/><stop offset="1" stop-color="#102b37"/></linearGradient></defs>
    <rect width="1000" height="290" fill="url(#bg)"/>
    <rect width="7" height="290" fill="#36dfad"/>
    <g font-family="Arial, sans-serif" fill="#ffffff">
      <text x="34" y="43" font-size="25" font-weight="700">${xml(COMPANY_NAME, 32)}</text>
      <text x="966" y="42" text-anchor="end" font-size="17" fill="#7ce9c5" letter-spacing="2">LAPORAN AKTIVITAS</text>
      <text x="32" y="118" font-size="67" font-weight="700">${time}</text>
      <text x="228" y="117" font-size="20" fill="#7ce9c5">WIB</text>
      <text x="320" y="88" font-size="24" font-weight="700">${xml(date)}</text>
      <text x="320" y="119" font-size="19" fill="#c5d9d5">${xml(meta.label ?? "Foto aktivitas transport")}</text>
      <path d="M34 144H966" stroke="#ffffff" stroke-opacity=".18"/>
      <circle cx="49" cy="184" r="13" fill="none" stroke="#36dfad" stroke-width="3"/><circle cx="49" cy="184" r="4" fill="#36dfad"/>
      <text x="78" y="190" font-size="27" font-weight="700">${gps}</text>
      <text x="78" y="221" font-size="19" fill="#c5d9d5">${accuracy} · Lokasi saat pengambilan</text>
      <text x="34" y="265" font-size="20">${xml(meta.transportCode ?? "Transport")} · ${xml(meta.recordedBy ?? "Kru transport")}</text>
    </g>
  </svg>`;
}

/** Append rather than cover evidence, strip EXIF, and bake into the stored JPEG. */
export async function watermarkActivityPhoto(photoUrl: string, meta: ActivityWatermark): Promise<string> {
  const source = Buffer.from(photoUrl.slice(photoUrl.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(source, { limitInputPixels: 20_000_000 }).rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
  const footerHeight = Math.max(1, Math.round(info.width * 0.29));
  const overlay = Buffer.from(activityWatermarkSvg(meta, info.width, footerHeight));
  const result = await sharp(data).extend({ bottom: footerHeight, background: "#062c26" })
    .composite([{ input: overlay, left: 0, top: info.height }]).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${result.toString("base64")}`;
}
