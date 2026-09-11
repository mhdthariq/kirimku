/**
 * Company branding printed at the top of every Resi Shipment and Resi Detail.
 * Override via NEXT_PUBLIC_COMPANY_NAME env var without code changes.
 */
export const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME ?? "KirimKu Logistics";
export const COMPANY_TAGLINE = "Shipment Management";

/**
 * Company bank account shown to Marketing partners in the Top Up workflow
 * (Revise.md §10 — Admin Kantor provides Bank Transfer Information).
 * Override via env vars without code changes.
 */
export const COMPANY_BANK = {
  bankName: process.env.NEXT_PUBLIC_COMPANY_BANK_NAME ?? "Bank Mandiri",
  accountNumber: process.env.NEXT_PUBLIC_COMPANY_BANK_ACCOUNT ?? "123-00-4567890",
  accountName: process.env.NEXT_PUBLIC_COMPANY_BANK_HOLDER ?? "PT KirimKu Logistics",
};
