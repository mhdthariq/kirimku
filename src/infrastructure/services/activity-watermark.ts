import sharp from "sharp";
import { COMPANY_NAME } from "@/shared/company";
import { currentCompanyName } from "@/infrastructure/persistence/tenant-context";
import { reverseEvidenceAddress } from "./evidence-address";
import { EVIDENCE_ZONE_LABELS, type EvidenceTimeZone } from "./evidence-photo";

export interface ActivityWatermark {
  companyName?: string;
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

function addressLines(value: string): string[] {
  return (value.match(/.{1,65}(?:\s|$)|.{1,65}/g) ?? []).map(line => line.trim()).slice(0, 3);
}

/** Capture time and GPS are descriptive device metadata, not an authenticity claim. */
export function activityWatermarkSvg(meta: ActivityWatermark, width: number, height: number): string {
  const timeZone = meta.timeZone ?? "Asia/Jakarta";
  const zoneLabel = EVIDENCE_ZONE_LABELS[timeZone];
  const time = new Intl.DateTimeFormat("id-ID", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(meta.capturedAt).replace(".", ":");
  const date = new Intl.DateTimeFormat("id-ID", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(meta.capturedAt);
  const gps = `${meta.latitude.toFixed(6)}, ${meta.longitude.toFixed(6)}`;
  const accuracy = meta.locationAccuracy == null ? "Akurasi tidak tersedia" : `Akurasi GPS ±${Math.round(meta.locationAccuracy)} m`;
  const address = addressLines(meta.locationLabel || "Alamat tidak tersedia · lihat koordinat GPS");
  const viewHeight = 1000 * height / width;
  const cardY = viewHeight - 390;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 ${viewHeight}">
    <defs><linearGradient id="trip" x2="1" y2="1"><stop stop-color="#006d60" stop-opacity=".92"/><stop offset="1" stop-color="#073d37" stop-opacity=".88"/></linearGradient></defs>
    <g font-family="Arial, sans-serif" fill="#ffffff">
      <rect x="34" y="32" width="540" height="72" rx="18" fill="url(#trip)" stroke="#8dd6c7" stroke-opacity=".65"/>
      <text x="56" y="63" font-size="25" font-weight="700">${xml(meta.companyName ?? COMPANY_NAME, 35)}</text>
      <text x="56" y="88" font-size="18">${xml(meta.label ?? "Foto Aktivitas", 50)}</text>
      <rect x="718" y="35" width="248" height="52" rx="26" fill="#182d31" fill-opacity=".75" stroke="#ffffff" stroke-opacity=".65"/>
      <text x="842" y="68" text-anchor="middle" font-size="18">${accuracy}</text>
      <g transform="translate(0 ${cardY})">
        <rect x="34" width="932" height="334" rx="24" fill="url(#trip)" stroke="#b7ded4" stroke-width="2"/>
        <path d="M56 94H944M56 216H944" stroke="#ffffff" stroke-opacity=".4"/>
        <path d="M390 18V78M650 18V78M525 234V312" stroke="#c4dc35" stroke-width="2"/>
        <text x="58" y="32" font-size="18">${xml(date, 55)}</text>
        <text x="58" y="70" font-size="34" font-weight="700">${time}</text>
        <text x="164" y="70" font-size="22">${zoneLabel}</text>
        <text x="410" y="37" font-size="23" font-weight="700">${xml(meta.origin ?? "Asal tidak tersedia", 18)} →</text>
        <text x="410" y="68" font-size="23" font-weight="700">${xml(meta.destination ?? "Tujuan tidak tersedia", 18)}</text>
        <text x="670" y="37" font-size="22" font-weight="700">${xml(meta.transportCode ?? "Bukti operasional", 22)}</text>
        <text x="670" y="68" font-size="20">(${meta.shipmentCount ?? 0} shipment)</text>
        <text x="58" y="121" font-size="18" fill="#c7e5de">Alamat Lokasi</text>
        ${address.map((line, index) => `<text x="58" y="${145 + index * 21}" font-size="20" font-weight="700">${xml(line, 70)}</text>`).join("")}
        <text x="58" y="207" font-size="14" fill="#c7e5de">${gps}</text>
        <text x="58" y="242" font-size="18">Kendaraan</text>
        <rect x="58" y="251" width="300" height="34" rx="5" fill="#ffe32d"/>
        <text x="68" y="277" font-size="27" font-weight="700" fill="#063d36">${xml(meta.vehiclePlate ?? "Tidak tersedia", 18)}</text>
        <text x="58" y="309" font-size="17">${xml(meta.vehicleDescription ?? "", 48)}</text>
        <text x="550" y="242" font-size="18">Supir</text>
        <text x="550" y="278" font-size="26" font-weight="700">${xml(meta.driverName ?? "Tidak tersedia", 25)}</text>
        <text x="550" y="309" font-size="15">${xml(meta.recordedBy ?? "Kru transport", 36)}</text>
      </g>
      ${meta.mockLocation ? `<text x="500" y="${cardY - 14}" text-anchor="middle" font-size="20" fill="#ffe32d">PERINGATAN: lokasi simulasi dilaporkan</text>` : ""}
      <text x="500" y="${viewHeight - 33}" text-anchor="middle" font-size="13">Alamat: © OpenStreetMap contributors</text>
      <text x="500" y="${viewHeight - 10}" text-anchor="middle" font-size="18" font-weight="700">By NovaLogistik</text>
    </g>
  </svg>`;
}

/** Bake the reference layout into the stored JPEG and strip EXIF. */
export async function watermarkActivityPhoto(photoUrl: string, meta: ActivityWatermark, maxDataUrlLength = 2_500_000): Promise<string> {
  const source = Buffer.from(photoUrl.slice(photoUrl.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(source, { limitInputPixels: 20_000_000 }).rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
  const locationLabel = meta.locationLabel || await reverseEvidenceAddress(meta.latitude, meta.longitude);
  // Short landscape captures need extra room to keep the card clear of the header.
  const outputHeight = Math.max(info.height, Math.round(info.width * 0.62));
  const overlay = Buffer.from(activityWatermarkSvg({ ...meta, locationLabel, companyName: currentCompanyName() ?? COMPANY_NAME }, info.width, outputHeight));
  const stamped = await sharp(data).extend({ bottom: outputHeight - info.height, background: "#073d37" })
    .composite([{ input: overlay, left: 0, top: 0 }]).png().toBuffer();
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
