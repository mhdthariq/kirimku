/**
 * Parse coordinates pasted straight from Google Maps (fix, 2026-09-26).
 *
 * Supports the formats Google Maps actually gives you when you right-click
 * a point → "Copy coordinates", or copy them out of the address bar / share
 * sheet:
 *   -6.914744, 107.609810                 (decimal, comma-separated — most common)
 *   -6.914744 107.609810                  (decimal, space-separated)
 *   6°54'53.1"S 107°36'35.3"E             (DMS with hemisphere letters)
 *   6 54 53.1 S, 107 36 35.3 E            (loose DMS)
 */

export interface LatLng {
  lat: number;
  lng: number;
}

function clampValid(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function dmsToDecimal(deg: number, min: number, sec: number, hemisphere: string): number {
  const value = deg + min / 60 + sec / 3600;
  return hemisphere === "S" || hemisphere === "W" ? -value : value;
}

/** Parse one free-text string pasted from Google Maps into { lat, lng }, or null if unparseable. */
export function parseCoordinates(input: string): LatLng | null {
  const text = input.trim();
  if (!text) return null;

  // 1) Plain decimal pair: "-6.914744, 107.609810" or "-6.914744 107.609810"
  const decimalMatch = text.match(/^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
  if (decimalMatch) {
    return clampValid(parseFloat(decimalMatch[1]), parseFloat(decimalMatch[2]));
  }

  // 2) DMS pair, e.g. 6°54'53.1"S 107°36'35.3"E (also accepts loose spacing,
  //    straight quotes, and no degree/minute symbols at all).
  const dmsPart = String.raw`(\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["]?\s*([NSEW])`;
  const dmsMatch = text.match(new RegExp(`^${dmsPart}[,\\s]+${dmsPart}$`, "i"));
  if (dmsMatch) {
    const [, d1, m1, s1, h1, d2, m2, s2, h2] = dmsMatch;
    const first = dmsToDecimal(Number(d1), Number(m1), Number(s1), h1.toUpperCase());
    const second = dmsToDecimal(Number(d2), Number(m2), Number(s2), h2.toUpperCase());
    // lat is whichever one carries N/S, lng whichever carries E/W
    const isFirstLat = /[NS]/i.test(h1);
    return clampValid(isFirstLat ? first : second, isFirstLat ? second : first);
  }

  return null;
}

/** Format { lat, lng } back into the canonical "lat, lng" paste format. */
export function formatCoordinates(point: LatLng | null | undefined, digits = 6): string {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return "";
  return `${point.lat.toFixed(digits)}, ${point.lng.toFixed(digits)}`;
}

/** Build a Google Maps link for a point — handy as an "open in Maps" affordance. */
export function googleMapsLink(point: LatLng): string {
  return `https://www.google.com/maps?q=${point.lat},${point.lng}`;
}
