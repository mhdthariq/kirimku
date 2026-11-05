const cache = new Map<string, { address: string | null; expires: number }>();
let nextRequestAt = 0;

/** Native addresses take precedence; this is the web/server fallback. */
export async function reverseEvidenceAddress(latitude: number, longitude: number): Promise<string | null> {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null;
  try {
    const endpoint = new URL(`${(process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "")}/reverse`);
    if (!["https:", "http:"].includes(endpoint.protocol)) return null;
    const key = `${endpoint.origin}${endpoint.pathname}:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.address;
    // shortcut: one MVP server process; use a shared limiter/cache before adding replicas.
    if (Date.now() < nextRequestAt) return null;
    nextRequestAt = Date.now() + 1100;
    endpoint.search = new URLSearchParams({ format: "jsonv2", lat: String(latitude), lon: String(longitude), "accept-language": "id" }).toString();
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "NovaLogistik/0.2 (operational evidence photos)", Accept: "application/json" },
      signal: AbortSignal.timeout(3000), cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const address = body && typeof body === "object" && "display_name" in body && typeof body.display_name === "string"
      ? Array.from(body.display_name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 240).join("") || null : null;
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, { address, expires: Date.now() + (address ? 86_400_000 : 60_000) });
    return address;
  } catch {
    return null;
  }
}
