import { describe, expect, it } from "vitest";
import { parseEvidenceMetadata } from "@/infrastructure/services/evidence-photo";

const now = new Date("2026-11-03T16:30:00Z");
describe("optional evidence metadata", () => {
  it("keeps legacy clients valid with server capture time and WIB default", () => {
    expect(parseEvidenceMetadata({}, now)).toEqual({ metadata: {
      capturedAt: now, timeZone: "Asia/Jakarta", locationLabel: null, mockLocation: null,
    } });
  });
  it("accepts WITA offset and sanitizes address controls without dropping Unicode", () => {
    expect(parseEvidenceMetadata({ capturedAt: "2026-11-04T00:30:00+08:00", timeZone: "Asia/Makassar",
      locationLabel: "  Jalan\n  Pelabuhan 日本 \u202e", mockLocation: false }, now)).toEqual({ metadata: {
      capturedAt: now, timeZone: "Asia/Makassar", locationLabel: "Jalan Pelabuhan 日本", mockLocation: false,
    } });
  });
  it.each([
    { timeZone: "WITA" }, { timeZone: null }, { locationLabel: "x".repeat(241) }, { locationLabel: 23 },
    { capturedAt: "2026-11-03T16:30:00" }, { capturedAt: "2026-11-03T16:24:59Z" },
    { capturedAt: "2026-11-03T16:30:31Z" }, { mockLocation: "false" }, { locationAccuracy: -1 },
    { locationAccuracy: Infinity }, { capturedAt: null },
  ])("rejects invalid or stale metadata %j", (body) => {
    expect(parseEvidenceMetadata(body, now)).toHaveProperty("error");
  });
  it("does not enable offline capture", () => {
    expect(parseEvidenceMetadata({ capturedOffline: true, capturedAt: "2026-11-03T15:30:00Z" }, now)).toHaveProperty("error");
  });
});
