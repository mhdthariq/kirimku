import { describe, expect, it } from "vitest";
import { maskResiValue, normalizeResiPhone } from "@/shared/resi-privacy";
import { buildResiQrUrl, parseResiQrUrl } from "@/shared/resi-qr";
import { normalizeResiScan } from "@/infrastructure/services/resi-scan";
import { allowTrackingAttempt } from "@/infrastructure/services/tracking-attempts";

describe("resi privacy and QR", () => {
  it("hides at least half of addresses and phone numbers including short values", () => {
    expect(maskResiValue("081234567890")).toBe("081234******");
    expect(maskResiValue("Jalan Mawar 123")).toBe("Jalan M********");
    expect(maskResiValue("A")).toBe("*");
    expect(maskResiValue(null)).toBeNull();
  });
  it("compares complete domestic/international numbers, rejects partial and malformed input", () => {
    expect(normalizeResiPhone("+62 812-3456-7890")).toBe(normalizeResiPhone("081234567890"));
    expect(normalizeResiPhone("7890")).toBeNull();
    expect(normalizeResiPhone("0812****7890")).toBeNull();
    expect(normalizeResiPhone("' OR 1=1--")).toBeNull();
    expect(normalizeResiPhone(null)).toBeNull();
  });
  it.each(["MKT-001", "CHILD-001"])("encodes corporate ID and %s as a camera-openable URL", (resi) => {
    const url = buildResiQrUrl("https://example.test", "CORP A", resi);
    expect(parseResiQrUrl(url)).toEqual({ corporateId: "CORP A", resi });
    expect(normalizeResiScan(url, "CORP A")).toBe(resi);
    expect(() => normalizeResiScan(url, "OTHER")).toThrow("corporate");
    expect(normalizeResiScan(resi, "CORP A")).toBe(resi);
  });
  it("rejects missing QR identity and unrelated URLs", () => {
    expect(parseResiQrUrl("https://example.test/tracking-paket?resi=MKT-1")).toBeNull();
    expect(parseResiQrUrl("https://example.test/other?corporateId=A&resi=MKT-1")).toBeNull();
    expect(parseResiQrUrl("MKT-1")).toBeNull();
  });
  it("limits repeated verification attempts and allows them after the window", () => {
    for (let i = 0; i < 10; i++) expect(allowTrackingAttempt("test-resi", 1000)).toBe(true);
    expect(allowTrackingAttempt("test-resi", 1001)).toBe(false);
    expect(allowTrackingAttempt("test-resi", 901001)).toBe(true);
  });
});
