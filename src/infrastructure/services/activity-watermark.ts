import sharp from "sharp";
import { COMPANY_NAME } from "@/shared/company";
import { EVIDENCE_ZONE_LABELS, type EvidenceTimeZone } from "./evidence-photo";

export interface ActivityWatermark {
  capturedAt: Date;
  latitude: number;
  longitude: number;
  locationAccuracy: number | null;
  transportCode?: string;
  recordedBy?: string;
  label?: string;
  locationLabel?: string | null;
  timeZone?: EvidenceTimeZone;
  mockLocation?: boolean | null;
  origin?: string | null;
  destination?: string | null;
  shipmentCount?: number;
  vehiclePlate?: string | null;
  vehicleDescription?: string | null;
  driverName?: string | null;
}

function xml(value: string, max = 48): string {
  return Array.from(value.replace(/[\u0000-\u001f]/g, " ")).slice(0, max).join("")
    .replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}

/** No authenticity claim: capture time and GPS are submitted device metadata. */
export function activityWatermarkSvg(meta: ActivityWatermark, width: number, height: number): string {
  const timeZone = meta.timeZone ?? "Asia/Jakarta";
  const zoneLabel = EVIDENCE_ZONE_LABELS[timeZone];
  const time = new Intl.DateTimeFormat("id-ID", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(meta.capturedAt).replace(".", ":");
  const date = new Intl.DateTimeFormat("id-ID", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(meta.capturedAt);
  const gps = `${meta.latitude.toFixed(6)}, ${meta.longitude.toFixed(6)}`;
  const accuracy = meta.locationAccuracy == null ? "Akurasi tidak tersedia" : `Akurasi GPS ±${Math.round(meta.locationAccuracy)} m`;
  if (hasTripContext(meta)) return tripWatermarkSvg(meta, width, height, time, date, gps, accuracy, zoneLabel);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 290">
    <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#062c26"/><stop offset="1" stop-color="#102b37"/></linearGradient></defs>
    <rect width="1000" height="290" fill="url(#bg)"/>
    <rect width="7" height="290" fill="#36dfad"/>
    <g font-family="Arial, sans-serif" fill="#ffffff">
      <text x="34" y="43" font-size="25" font-weight="700">${xml(COMPANY_NAME, 32)}</text>
      <text x="966" y="42" text-anchor="end" font-size="17" fill="#7ce9c5" letter-spacing="2">LAPORAN AKTIVITAS</text>
      <text x="32" y="118" font-size="67" font-weight="700">${time}</text>
      <text x="228" y="117" font-size="20" fill="#7ce9c5">${zoneLabel}</text>
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

function hasTripContext(meta: ActivityWatermark): boolean {
  return Boolean(meta.locationLabel || meta.origin || meta.destination || meta.vehiclePlate || meta.driverName || meta.mockLocation);
}

function addressLines(value: string): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    // Split unusually long address tokens as well as wrapping normal words.
    for (let offset = 0; offset < word.length; offset += 70) {
      const part = word.slice(offset, offset + 70);
      if (line && line.length + part.length + 1 > 70) { lines.push(line); line = ""; }
      line = line ? `${line} ${part}` : part;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function tripWatermarkSvg(meta: ActivityWatermark, width: number, height: number, time: string, date: string, gps: string, accuracy: string, zoneLabel: string): string {
  const address = addressLines(meta.locationLabel || "Alamat tidak tersedia · lihat koordinat GPS");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 640">
    <defs><linearGradient id="trip" x2="1" y2="1"><stop stop-color="#006d60"/><stop offset="1" stop-color="#073d37"/></linearGradient></defs>
    <rect width="1000" height="640" fill="url(#trip)"/>
    <rect width="7" height="640" fill="#36dfad"/>
    <g font-family="Arial, sans-serif" fill="#ffffff">
      <text x="34" y="43" font-size="25" font-weight="700">${xml(COMPANY_NAME, 32)}</text>
      <text x="966" y="43" text-anchor="end" font-size="19" fill="#b6edda">${xml(meta.label ?? "Foto aktivitas transport", 65)}</text>
      <text x="32" y="116" font-size="64" font-weight="700">${time}</text>
      <text x="228" y="115" font-size="22" fill="#b6edda">${zoneLabel}</text>
      <text x="330" y="90" font-size="24" font-weight="700">${xml(date, 55)}</text>
      <text x="330" y="120" font-size="20">${gps}</text>
      <text x="34" y="164" font-size="18" fill="#b6edda">${accuracy} · Lokasi perangkat saat pengambilan</text>
      ${address.map((line, index) => `<text x="34" y="${198 + index * 25}" font-size="21">${xml(line, 75)}</text>`).join("")}
      <path d="M34 294H966" stroke="#ffffff" stroke-opacity=".2"/>
      <text x="34" y="328" font-size="20" fill="#b6edda">KORIDOR PERJALANAN</text>
      <text x="34" y="362" font-size="17" fill="#b6edda">ASAL</text>
      <text x="525" y="362" font-size="17" fill="#b6edda">TUJUAN</text>
      <text x="34" y="398" font-size="29" font-weight="700">${xml(meta.origin ?? "Tidak tersedia", 28)}</text>
      <text x="525" y="398" font-size="29" font-weight="700">${xml(meta.destination ?? "Tidak tersedia", 28)}</text>
      <text x="34" y="435" font-size="20" fill="#b6edda">${xml(meta.transportCode ?? "Bukti operasional")} · ${meta.shipmentCount ?? 0} shipment</text>
      <rect x="24" y="458" width="952" height="126" rx="18" fill="#ffffff" fill-opacity=".07"/>
      <text x="44" y="490" font-size="17" fill="#b6edda">KENDARAAN</text>
      <text x="540" y="490" font-size="17" fill="#b6edda">DRIVER</text>
      <text x="44" y="524" font-size="28" font-weight="700">${xml(meta.vehiclePlate ?? "Tidak tersedia", 28)}</text>
      <text x="540" y="524" font-size="26" font-weight="700">${xml(meta.driverName ?? "Tidak tersedia", 28)}</text>
      <text x="44" y="559" font-size="21" fill="#b6edda">${xml(meta.vehicleDescription ?? "", 65)}</text>
      <text x="34" y="619" font-size="17" fill="#b6edda">Oleh ${xml(meta.recordedBy ?? "Kru transport", 40)} · ${meta.mockLocation ? "PERINGATAN: lokasi simulasi dilaporkan" : "Metadata perangkat, bukan sertifikasi lokasi"}</text>
    </g>
  </svg>`;
}

/** Append rather than cover evidence, strip EXIF, and bake into the stored JPEG. */
export async function watermarkActivityPhoto(photoUrl: string, meta: ActivityWatermark, maxDataUrlLength = 2_500_000): Promise<string> {
  const source = Buffer.from(photoUrl.slice(photoUrl.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(source, { limitInputPixels: 20_000_000 }).rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
  const footerHeight = Math.max(1, Math.round(info.width * (hasTripContext(meta) ? 0.64 : 0.29)));
  const overlay = Buffer.from(activityWatermarkSvg(meta, info.width, footerHeight));
  const stamped = await sharp(data).extend({ bottom: footerHeight, background: "#062c26" })
    .composite([{ input: overlay, left: 0, top: info.height }]).png().toBuffer();
  // The stored data URL must remain valid under the same upload/edit budgets.
  for (const quality of [88, 78, 68, 58]) {
    const result = await sharp(stamped).jpeg({ quality }).toBuffer();
    const url = `data:image/jpeg;base64,${result.toString("base64")}`;
    if (url.length <= maxDataUrlLength) return url;
  }
  for (const scale of [0.8, 0.6, 0.5]) {
    const result = await sharp(stamped).resize({ width: Math.max(1, Math.round(info.width * scale)) }).jpeg({ quality: 78 }).toBuffer();
    const url = `data:image/jpeg;base64,${result.toString("base64")}`;
    if (url.length <= maxDataUrlLength) return url;
  }
  throw new Error("Stamped photo exceeds the storage size limit.");
}
