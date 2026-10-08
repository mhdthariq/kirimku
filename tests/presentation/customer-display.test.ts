import { describe, expect, it } from "vitest";
import { customerDisplayParts, customerPrimaryName, customerSecondaryName } from "@/presentation/customer-display";

describe("B2C customer (person IS the customer)", () => {
  const b2c = { name: "Budi Santoso", companyName: null, type: "b2c" };

  it("shows the person's name as primary, with no secondary line", () => {
    expect(customerPrimaryName(b2c)).toBe("Budi Santoso");
    expect(customerSecondaryName(b2c)).toBeNull();
    expect(customerDisplayParts(b2c)).toEqual({ primary: "Budi Santoso", secondary: null });
  });
});

describe("B2B customer with a company name (the fixed case)", () => {
  const b2b = { name: "Siti (PIC Gudang)", companyName: "PT Maju Jaya", type: "b2b" };

  it("shows the COMPANY as primary — this was previously showing the PIC on top", () => {
    expect(customerPrimaryName(b2b)).toBe("PT Maju Jaya");
  });

  it("shows the PIC as the secondary line", () => {
    expect(customerSecondaryName(b2b)).toBe("Siti (PIC Gudang)");
  });

  it("customerDisplayParts returns both in one call", () => {
    expect(customerDisplayParts(b2b)).toEqual({ primary: "PT Maju Jaya", secondary: "Siti (PIC Gudang)" });
  });
});

describe("B2B customer WITHOUT a company name set (data gap, not a crash)", () => {
  const b2bNoCompany = { name: "Siti (PIC Gudang)", companyName: null, type: "b2b" };

  it("falls back to showing the name as primary with no secondary line", () => {
    expect(customerPrimaryName(b2bNoCompany)).toBe("Siti (PIC Gudang)");
    expect(customerSecondaryName(b2bNoCompany)).toBeNull();
  });
});

describe("type field is missing or unrecognized", () => {
  it("treats it like B2C (safe default — never hides a name)", () => {
    const noType = { name: "Ambiguous Co", companyName: "Ambiguous Holdings" };
    expect(customerPrimaryName(noType)).toBe("Ambiguous Co");
    expect(customerSecondaryName(noType)).toBeNull();
  });
});
