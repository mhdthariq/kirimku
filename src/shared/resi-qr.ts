export interface ResiQr { corporateId: string; resi: string }

/** URLs open directly in a phone camera's browser and contain no personal data. */
export function buildResiQrUrl(origin: string, corporateId: string, resi: string): string {
  const url = new URL("/tracking-paket", origin);
  url.searchParams.set("corporateId", corporateId);
  url.searchParams.set("resi", resi);
  return url.toString();
}

export function parseResiQrUrl(value: string): ResiQr | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.pathname !== "/tracking-paket") return null;
    const corporateId = url.searchParams.get("corporateId")?.trim();
    const resi = url.searchParams.get("resi")?.trim();
    if (!corporateId || corporateId.length > 128 || !resi || resi.length > 128) return null;
    return { corporateId, resi };
  } catch { return null; }
}
