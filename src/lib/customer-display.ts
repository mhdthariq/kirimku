/**
 * Customer display rules (fix, 2026-09-26):
 *  - B2C customers: the person's name IS the customer - show `name`, no subtitle.
 *  - B2B customers: the COMPANY is the customer - show `companyName` as the
 *    primary label, with the PIC (`name`) as a secondary line underneath.
 *    Previously the PIC name was shown on top (and sometimes the only name
 *    shown at all), which is backwards for a company account.
 *
 * Use `customerPrimaryName` anywhere only a single string fits (table cells,
 * dropdown options, printed documents). Use `customerDisplayParts` when the
 * UI has room to show both lines.
 */

export interface CustomerDisplayable {
  name: string;
  companyName?: string | null;
  type?: string | null;
}

function isB2b(c: CustomerDisplayable): boolean {
  return c.type === "b2b" && !!c.companyName;
}

/** The one name to show when only a single line fits. */
export function customerPrimaryName(c: CustomerDisplayable): string {
  return isB2b(c) ? (c.companyName as string) : c.name;
}

/** The PIC name shown under the company name — null for B2C (nothing to show). */
export function customerSecondaryName(c: CustomerDisplayable): string | null {
  return isB2b(c) ? c.name : null;
}

/** Convenience: both lines at once, for two-line renders. */
export function customerDisplayParts(c: CustomerDisplayable): { primary: string; secondary: string | null } {
  return { primary: customerPrimaryName(c), secondary: customerSecondaryName(c) };
}
