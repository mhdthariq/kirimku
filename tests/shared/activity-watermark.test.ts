import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { activityWatermarkSvg, watermarkActivityPhoto } from "@/infrastructure/services/activity-watermark";

const metadata = {
  capturedAt: new Date("2026-10-27T13:44:00Z"), latitude: 5.205373, longitude: 97.114832,
  locationAccuracy: 5, transportCode: "TR-2026-001", recordedBy: "driver.andi",
};
describe("embedded activity watermark", () => {
  it("labels capture time explicitly in WIB, GPS, accuracy and trusted actor", () => {
    const svg = activityWatermarkSvg(metadata, 1000, 290);
    for (const value of ["20:44", "WIB", "27 Oktober 2026", "5.205373, 97.114832", "±5 m", "TR-2026-001", "driver.andi"]) expect(svg).toContain(value);
    expect(svg).not.toContain("100% akurat");
  });
  it("escapes injected markup and handles optional accuracy", () => {
    const svg = activityWatermarkSvg({ ...metadata, recordedBy: '<script>&"', locationAccuracy: null }, 640, 186);
    expect(svg).toContain("&lt;script&gt;&amp;&quot;");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("Akurasi tidak tersedia");
  });
  it.each([[800, 1200], [1280, 720], [2000, 1000]])("preserves the full %sx%s photo above a readable baked-in footer", async (width, height) => {
    const image = await sharp({ create: { width, height, channels: 3, background: "#eeeeee" } }).png().toBuffer();
    const output = await watermarkActivityPhoto(`data:image/png;base64,${image.toString("base64")}`, metadata);
    expect(output).toMatch(/^data:image\/jpeg;base64,/);
    const decoded = Buffer.from(output.split(",")[1], "base64");
    const result = await sharp(decoded).metadata();
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const expectedWidth = Math.round(width * scale);
    const photoHeight = Math.round(height * scale);
    expect(result.width).toBe(expectedWidth);
    expect(result.height).toBe(photoHeight + Math.round(expectedWidth * 0.29));
    const { data } = await sharp(decoded).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(220); // Original photo remains visible.
    const footerPixel = (photoHeight + 5) * expectedWidth * 3 + 100 * 3;
    expect(data[footerPixel]).toBeLessThan(50); // Footer is part of the image pixels.
    expect(result.exif).toBeUndefined();
  });
});
