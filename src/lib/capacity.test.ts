import { describe, it, expect } from "vitest";
import {
  calculateDetailVolume,
  computeDimensionStatus,
  calculateTransportCapacityStatus,
  type VehicleCapacity,
  type TransportLoad,
} from "@/lib/capacity";

// ---------------------------------------------------------------------------
// calculateDetailVolume — shared volume (must match pricing.ts:detailVolumeM3)
// ---------------------------------------------------------------------------
describe("calculateDetailVolume", () => {
  it("uses L×W×H/1.000.000 when volumeM3 is absent", () => {
    expect(calculateDetailVolume({ lengthCm: 100, widthCm: 100, heightCm: 100 })).toBe(1);
    expect(calculateDetailVolume({ lengthCm: 50, widthCm: 40, heightCm: 20 })).toBe(0.04);
  });

  it("uses direct volumeM3 when set (> 0), ignoring L×W×H", () => {
    expect(calculateDetailVolume({ lengthCm: 100, widthCm: 100, heightCm: 100, volumeM3: 2.5 })).toBe(2.5);
    expect(calculateDetailVolume({ volumeM3: 0.75 })).toBe(0.75);
  });

  it("falls back to L×W×H when volumeM3 is null/0/negative", () => {
    expect(calculateDetailVolume({ lengthCm: 100, widthCm: 100, heightCm: 100, volumeM3: null })).toBe(1);
    expect(calculateDetailVolume({ lengthCm: 100, widthCm: 100, heightCm: 100, volumeM3: 0 })).toBe(1);
    expect(calculateDetailVolume({ lengthCm: 100, widthCm: 100, heightCm: 100, volumeM3: -3 })).toBe(1);
  });

  it("returns 0 when no usable dimensions", () => {
    expect(calculateDetailVolume({})).toBe(0);
    expect(calculateDetailVolume({ lengthCm: 0, widthCm: 0, heightCm: 0 })).toBe(0);
    expect(calculateDetailVolume({ lengthCm: null, widthCm: null, heightCm: null })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeDimensionStatus — one dimension (plan §3/§4/§5/§10/§22/§25)
// ---------------------------------------------------------------------------
describe("computeDimensionStatus", () => {
  it("current <= maximum, utilization < 90% → OK", () => {
    const s = computeDimensionStatus(2800, 3500); // 80%
    expect(s.status).toBe("OK");
    expect(s.current).toBe(2800);
    expect(s.maximum).toBe(3500);
    expect(s.overBy).toBe(0);
    expect(s.remaining).toBe(700);
    expect(s.utilizationPercent).toBeCloseTo(80, 2);
  });

  it("utilization >= 90% but not over → WARNING (plan §31 SOFT limit)", () => {
    const s = computeDimensionStatus(3200, 3500); // 91.43%
    expect(s.status).toBe("WARNING");
    expect(s.overBy).toBe(0);
    expect(s.remaining).toBe(300);
    expect(s.utilizationPercent).toBeCloseTo(91.43, 2);
  });

  it("current == maximum (100%) → WARNING (at the limit, not over)", () => {
    expect(computeDimensionStatus(3500, 3500).status).toBe("WARNING");
  });

  it("current > maximum → OVERLIMIT (plan §3)", () => {
    const s = computeDimensionStatus(3800, 3500);
    expect(s.status).toBe("OVERLIMIT");
    expect(s.overBy).toBe(300);
    expect(s.remaining).toBe(-300);
    expect(s.utilizationPercent).toBeCloseTo(108.57, 2);
  });

  it("current == maximum + 1 → OVERLIMIT (boundary, plan §25)", () => {
    expect(computeDimensionStatus(3501, 3500).status).toBe("OVERLIMIT");
  });

  it("custom warning threshold — 80% → WARNING at 85%", () => {
    expect(computeDimensionStatus(850, 1000, 2, 80).status).toBe("WARNING");
    expect(computeDimensionStatus(799, 1000, 2, 80).status).toBe("OK");
  });

  it("maximum == null → UNCONFIGURED (plan §10)", () => {
    const s = computeDimensionStatus(82, null);
    expect(s.status).toBe("UNCONFIGURED");
    expect(s.maximum).toBeNull();
    expect(s.utilizationPercent).toBeNull();
    expect(s.remaining).toBeNull();
    expect(s.overBy).toBeNull();
    expect(s.current).toBe(82); // current is still reported
  });

  it("maximum == 0 → UNCONFIGURED (plan §22: 0 = invalid/unconfigured)", () => {
    expect(computeDimensionStatus(100, 0).status).toBe("UNCONFIGURED");
  });

  it("maximum < 0 → UNCONFIGURED (negative invalid)", () => {
    expect(computeDimensionStatus(100, -5).status).toBe("UNCONFIGURED");
  });

  it("empty transport (current 0) with configured limit → OK (plan §22)", () => {
    const s = computeDimensionStatus(0, 3500);
    expect(s.status).toBe("OK");
    expect(s.utilizationPercent).toBe(0);
    expect(s.remaining).toBe(3500);
  });

  it("koli uses 0 dp rounding", () => {
    const s = computeDimensionStatus(75, 60, 0);
    expect(s.current).toBe(75);
    expect(s.overBy).toBe(15);
    expect(s.status).toBe("OVERLIMIT");
  });

  it("volume uses 6 dp rounding (93.3% → WARNING)", () => {
    const s = computeDimensionStatus(11.2, 12, 6); // 93.33%
    expect(s.current).toBeCloseTo(11.2, 6);
    expect(s.status).toBe("WARNING");
  });
});

// ---------------------------------------------------------------------------
// calculateTransportCapacityStatus — overall + independence (plan §15/§26)
// ---------------------------------------------------------------------------
function cap(maxWeightKg: number | null, maxVolumeM3: number | null, maxKoli: number | null): VehicleCapacity {
  return { maxWeightKg, maxVolumeM3, maxKoli };
}
function load(actualKg: number, volM3: number, koli: number): TransportLoad {
  return { totalActualWeightKg: actualKg, totalVolumeM3: volM3, totalKoli: koli };
}

describe("calculateTransportCapacityStatus — overall status (plan §15/§26/§31)", () => {
  it("all OK (utilizations < 90%) → overall OK", () => {
    const c = calculateTransportCapacityStatus(cap(5000, 15, 100), load(3000, 10, 50));
    expect(c.weight.status).toBe("OK");
    expect(c.volume.status).toBe("OK");
    expect(c.koli.status).toBe("OK");
    expect(c.overallStatus).toBe("OK");
  });

  it("weight OVERLIMIT only → overall OVERLIMIT", () => {
    const c = calculateTransportCapacityStatus(cap(3500, 15, 100), load(3800, 10, 50));
    expect(c.weight.status).toBe("OVERLIMIT");
    expect(c.volume.status).toBe("OK");
    expect(c.koli.status).toBe("OK");
    expect(c.overallStatus).toBe("OVERLIMIT");
  });

  it("volume OVERLIMIT only → overall OVERLIMIT", () => {
    const c = calculateTransportCapacityStatus(cap(5000, 10, 100), load(3000, 12, 50));
    expect(c.weight.status).toBe("OK");
    expect(c.volume.status).toBe("OVERLIMIT");
    expect(c.koli.status).toBe("OK");
    expect(c.overallStatus).toBe("OVERLIMIT");
  });

  it("koli OVERLIMIT only → overall OVERLIMIT", () => {
    const c = calculateTransportCapacityStatus(cap(5000, 15, 60), load(3000, 10, 75));
    expect(c.weight.status).toBe("OK");
    expect(c.volume.status).toBe("OK");
    expect(c.koli.status).toBe("OVERLIMIT");
    expect(c.overallStatus).toBe("OVERLIMIT");
  });

  it("all three OVERLIMIT → overall OVERLIMIT", () => {
    const c = calculateTransportCapacityStatus(cap(3500, 10, 60), load(3800, 12, 75));
    expect(c.weight.status).toBe("OVERLIMIT");
    expect(c.volume.status).toBe("OVERLIMIT");
    expect(c.koli.status).toBe("OVERLIMIT");
    expect(c.overallStatus).toBe("OVERLIMIT");
  });

  it("one UNCONFIGURED + rest OK → PARTIALLY_CONFIGURED", () => {
    const c = calculateTransportCapacityStatus(cap(5000, 15, null), load(3000, 10, 50));
    expect(c.weight.status).toBe("OK");
    expect(c.volume.status).toBe("OK");
    expect(c.koli.status).toBe("UNCONFIGURED");
    expect(c.overallStatus).toBe("PARTIALLY_CONFIGURED");
  });

  it("all three UNCONFIGURED → UNCONFIGURED", () => {
    const c = calculateTransportCapacityStatus(cap(null, null, null), load(4500, 12, 82));
    expect(c.weight.status).toBe("UNCONFIGURED");
    expect(c.volume.status).toBe("UNCONFIGURED");
    expect(c.koli.status).toBe("UNCONFIGURED");
    expect(c.overallStatus).toBe("UNCONFIGURED");
  });

  it("OVERLIMIT takes precedence over UNCONFIGURED", () => {
    const c = calculateTransportCapacityStatus(cap(3500, null, 60), load(3800, 12, 75));
    expect(c.weight.status).toBe("OVERLIMIT");
    expect(c.volume.status).toBe("UNCONFIGURED");
    expect(c.koli.status).toBe("OVERLIMIT");
    expect(c.overallStatus).toBe("OVERLIMIT");
  });

  it("dimensions are independent (weight OK, volume OK, koli OVERLIMIT)", () => {
    const c = calculateTransportCapacityStatus(cap(5000, 15, 60), load(3000, 10, 75));
    expect(c.weight.status).toBe("OK");
    expect(c.volume.status).toBe("OK");
    expect(c.koli.status).toBe("OVERLIMIT");
    expect(c.overallStatus).toBe("OVERLIMIT");
  });

  it("one WARNING + rest OK → overall WARNING (plan §31 SOFT limit)", () => {
    const c = calculateTransportCapacityStatus(cap(5000, 15, 100), load(4600, 10, 50)); // 92% weight
    expect(c.weight.status).toBe("WARNING");
    expect(c.volume.status).toBe("OK");
    expect(c.koli.status).toBe("OK");
    expect(c.overallStatus).toBe("WARNING");
  });

  it("OVERLIMIT takes precedence over WARNING", () => {
    const c = calculateTransportCapacityStatus(cap(3500, 15, 60), load(3800, 10, 50));
    expect(c.weight.status).toBe("OVERLIMIT");
    expect(c.overallStatus).toBe("OVERLIMIT");
  });

  it("uses ACTUAL weight not chargeable (plan §6) — load is actual kg", () => {
    // 500 actual kg in a 1000 max vehicle → OK even though chargeable would be
    // volumetric 1000. The capacity calc only ever sees actual kg via load.
    const c = calculateTransportCapacityStatus(cap(1000, 15, 100), load(500, 4, 5));
    expect(c.weight.status).toBe("OK");
    expect(c.weight.current).toBe(500);
    expect(c.weight.maximum).toBe(1000);
  });

  it("empty transport → OK (plan §22)", () => {
    const c = calculateTransportCapacityStatus(cap(5000, 15, 100), load(0, 0, 0));
    expect(c.overallStatus).toBe("OK");
  });
});
