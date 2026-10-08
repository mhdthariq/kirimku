import { describe, expect, it } from "vitest";
import { formatCoordinates, googleMapsLink, parseCoordinates } from "@/shared/coordinates";

describe("parseCoordinates — decimal format", () => {
  it("parses a comma-separated decimal pair (the common 'Copy coordinates' format)", () => {
    expect(parseCoordinates("-6.914744, 107.609810")).toEqual({ lat: -6.914744, lng: 107.60981 });
  });

  it("parses a space-separated decimal pair", () => {
    expect(parseCoordinates("-6.914744 107.609810")).toEqual({ lat: -6.914744, lng: 107.60981 });
  });

  it("parses positive latitude/longitude", () => {
    expect(parseCoordinates("3.5952, 98.6722")).toEqual({ lat: 3.5952, lng: 98.6722 });
  });

  it("tolerates extra surrounding whitespace", () => {
    expect(parseCoordinates("  -6.9147, 107.6098  ")).toEqual({ lat: -6.9147, lng: 107.6098 });
  });

  it("returns null for out-of-range values", () => {
    expect(parseCoordinates("200, 300")).toBeNull(); // lat > 90, lng > 180
    expect(parseCoordinates("-95, 10")).toBeNull();
  });
});

describe("parseCoordinates — DMS format", () => {
  it("parses degrees/minutes/seconds with hemisphere letters", () => {
    const result = parseCoordinates(`6°54'53.1"S 107°36'35.3"E`);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(-(6 + 54 / 60 + 53.1 / 3600), 4);
    expect(result!.lng).toBeCloseTo(107 + 36 / 60 + 35.3 / 3600, 4);
  });

  it("handles the order lng/lat as well, based on the hemisphere letter", () => {
    const result = parseCoordinates(`107°36'35.3"E, 6°54'53.1"S`);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeLessThan(0); // S → negative
    expect(result!.lng).toBeGreaterThan(0); // E → positive
  });

  it("applies N/W hemisphere signs correctly", () => {
    const result = parseCoordinates(`40°26'46"N 79°58'56"W`);
    expect(result!.lat).toBeGreaterThan(0);
    expect(result!.lng).toBeLessThan(0);
  });
});

describe("parseCoordinates — invalid input", () => {
  it("returns null for empty or garbage strings", () => {
    expect(parseCoordinates("")).toBeNull();
    expect(parseCoordinates("   ")).toBeNull();
    expect(parseCoordinates("not a coordinate")).toBeNull();
    expect(parseCoordinates("Jl. Sudirman No. 1")).toBeNull();
  });

  it("returns null for a single number with no pair", () => {
    expect(parseCoordinates("-6.9147")).toBeNull();
  });
});

describe("formatCoordinates", () => {
  it("formats a point back to the canonical 'lat, lng' string", () => {
    expect(formatCoordinates({ lat: -6.914744, lng: 107.60981 })).toBe("-6.914744, 107.609810");
  });

  it("respects a custom digit count", () => {
    expect(formatCoordinates({ lat: -6.9147441, lng: 107.6098102 }, 2)).toBe("-6.91, 107.61");
  });

  it("returns an empty string for null/undefined", () => {
    expect(formatCoordinates(null)).toBe("");
    expect(formatCoordinates(undefined)).toBe("");
  });

  it("round-trips through parseCoordinates", () => {
    const original = { lat: -6.914744, lng: 107.60981 };
    const roundTripped = parseCoordinates(formatCoordinates(original));
    expect(roundTripped!.lat).toBeCloseTo(original.lat, 5);
    expect(roundTripped!.lng).toBeCloseTo(original.lng, 5);
  });
});

describe("googleMapsLink", () => {
  it("builds a link Google Maps understands", () => {
    expect(googleMapsLink({ lat: -6.914744, lng: 107.60981 })).toBe(
      "https://www.google.com/maps?q=-6.914744,107.60981",
    );
  });
});
