import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { parseExpensePhotos } from "@/infrastructure/services/expense-photos";
import { describe, expect, it, vi } from "vitest";
import { activityWatermarkSvg, watermarkActivityPhoto } from "@/infrastructure/services/activity-watermark";
import { reverseEvidenceAddress } from "@/infrastructure/services/evidence-address";

vi.mock("@/infrastructure/persistence/tenant-context", () => ({ currentCompanyName: () => "PT Contoh Logistics" }));
vi.mock("@/infrastructure/services/evidence-address", () => ({ reverseEvidenceAddress: vi.fn(async () => "Jl. Pulau Palu, Medan") }));

const metadata = {
  capturedAt: new Date("2026-10-27T13:44:00Z"), latitude: 5.205373, longitude: 97.114832,
  locationAccuracy: 5, transportCode: "TR-2026-001", recordedBy: "driver.andi",
};
describe("embedded activity watermark", () => {
  it("keeps a native address without requesting a web lookup", async () => {
    vi.mocked(reverseEvidenceAddress).mockClear();
    const image = await sharp({ create: { width: 500, height: 700, channels: 3, background: "white" } }).png().toBuffer();
    await watermarkActivityPhoto(`data:image/png;base64,${image.toString("base64")}`, { ...metadata, locationLabel: "Native address" });
    expect(reverseEvidenceAddress).not.toHaveBeenCalled();
  });
  it("labels capture time explicitly in WIB, GPS, accuracy and trusted actor", () => {
    const svg = activityWatermarkSvg(metadata, 1000, 1600);
    for (const value of ["20:44", "WIB", "27 Oktober 2026", "5.205373, 97.114832", "±5 m", "TR-2026-001", "driver.andi"]) expect(svg).toContain(value);
    expect(svg).not.toContain("100% akurat");
  });
  it.each([["Asia/Makassar", "21:44", "WITA"], ["Asia/Jayapura", "22:44", "WIT"]] as const)("supports %s without changing the instant", (timeZone, time, label) => {
    const svg = activityWatermarkSvg({ ...metadata, timeZone }, 1000, 1600);
    expect(svg).toContain(time);
    expect(svg).toContain(`>${label}</text>`);
  });
  it("rolls the capture date forward in WITA while WIB is still the previous day", () => {
    const capture = { ...metadata, capturedAt: new Date("2026-11-03T16:30:00Z") };
    const wib = activityWatermarkSvg(capture, 1000, 1600);
    const wita = activityWatermarkSvg({ ...capture, timeZone: "Asia/Makassar" }, 1000, 1600);
    expect(wib).toContain("23:30");
    expect(wib).toContain("3 November 2026");
    expect(wita).toContain("00:30");
    expect(wita).toContain("4 November 2026");
  });
  it("renders the trip card, wrapped address and device warning safely", async () => {
    const trip = { ...metadata, timeZone: "Asia/Makassar" as const, origin: "Medan", destination: "Banda Aceh",
      shipmentCount: 5, vehiclePlate: "BK 8623 HB", vehicleDescription: "Mitsubishi Colt Diesel HDL 136 PS",
      driverName: "Ricky Pratama", locationLabel: "Jl. Pelabuhan No. 12, Kelurahan Baru, Kecamatan Utara, Kota Balikpapan, Kalimantan Timur <script>", mockLocation: true };
    const svg = activityWatermarkSvg(trip, 1000, 1600);
    for (const text of ["Medan", "Banda Aceh", "5 shipment", "BK 8623 HB", "Mitsubishi Colt Diesel HDL 136 PS", "Ricky Pratama", "Balikpapan", "Kalimantan", "lokasi simulasi", "&lt;script&gt;"]) expect(svg).toContain(text);
    expect(svg).not.toContain("<script>");
    const source = await sharp({ create: { width: 1000, height: 700, channels: 3, background: "white" } }).png().toBuffer();
    const output = await watermarkActivityPhoto(`data:image/png;base64,${source.toString("base64")}`, trip);
    const image = await sharp(Buffer.from(output.split(",")[1], "base64")).metadata();
    expect(image.height).toBe(700);
    expect(image.exif).toBeUndefined();
  });
  it("uses company branding, plain byline and the reference card", () => {
    const svg = activityWatermarkSvg({ ...metadata, companyName: "PT Customer & Co" }, 1000, 1600);
    expect(svg).toContain("PT Customer &amp; Co");
    expect(svg).toContain(">By NovaLogistik</text>");
    expect(svg).toContain("OpenStreetMap contributors");
    expect(svg).toContain("Alamat Lokasi");
  });
  it("escapes injected markup and handles optional accuracy", () => {
    const svg = activityWatermarkSvg({ ...metadata, recordedBy: '<script>&"', locationAccuracy: null }, 640, 1000);
    expect(svg).toContain("&lt;script&gt;&amp;&quot;");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("Akurasi tidak tersedia");
  });
  it("keeps detailed stamped receipts within upload and aggregate edit budgets", async () => {
    const source = await sharp(randomBytes(1600 * 1600 * 3), { raw: { width: 1600, height: 1600, channels: 3 } }).jpeg({ quality: 60 }).toBuffer();
    const limit = Math.floor(10 * 1024 * 1024 / 8);
    const output = await watermarkActivityPhoto(`data:image/jpeg;base64,${source.toString("base64")}`, { ...metadata, origin: "Medan" }, limit);
    expect(output.length).toBeLessThanOrEqual(limit);
    const existing = Array.from({ length: 7 }, (_, i) => `${output}${" ".repeat(i)}`);
    // A subsequent web edit can append an eighth receipt under the aggregate budget.
    expect(parseExpensePhotos({ photos: [output + "        "] }, { photoUrls: existing })).not.toHaveProperty("error");
  });
  it.each([[800, 1200], [1280, 720], [2000, 1000]])("stamps a readable layout onto %sx%s photos", async (width, height) => {
    const image = await sharp({ create: { width, height, channels: 3, background: "#eeeeee" } }).png().toBuffer();
    const output = await watermarkActivityPhoto(`data:image/png;base64,${image.toString("base64")}`, metadata);
    expect(output).toMatch(/^data:image\/jpeg;base64,/);
    const decoded = Buffer.from(output.split(",")[1], "base64");
    const result = await sharp(decoded).metadata();
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const expectedWidth = Math.round(width * scale);
    const photoHeight = Math.round(height * scale);
    expect(result.width).toBe(expectedWidth);
    expect(result.height).toBe(Math.max(photoHeight, Math.round(expectedWidth * 0.62)));
    const { data } = await sharp(decoded).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(220); // Original photo remains visible.
    const footerPixel = (result.height! - Math.round(expectedWidth * 0.35)) * expectedWidth * 3 + Math.round(expectedWidth * 0.08) * 3;
    expect(data[footerPixel]).toBeLessThan(100); // Footer is part of the image pixels.
    expect(result.exif).toBeUndefined();
  });
});
