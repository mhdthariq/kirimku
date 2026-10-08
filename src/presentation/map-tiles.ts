/**
 * Single source of truth for map tiles (2026-10-01).
 *
 * Every Leaflet map in the app (location picker, task map, transport map,
 * checkpoint editor) must get its tiles from here, so they all use Google
 * Maps and can't drift back to OpenStreetMap. `map-tiles.test.ts` also scans
 * the whole codebase and fails if an OSM tile URL or a direct
 * `L.tileLayer(` call shows up anywhere else.
 *
 * Note: this is Google's unofficial `mt0-3.google.com/vt` tile endpoint (no API
 * key). For production traffic Google expects the official Maps JavaScript API.
 */
export const GOOGLE_TILE_URL = "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";

export const GOOGLE_TILE_OPTIONS = {
  maxZoom: 20,
  subdomains: ["mt0", "mt1", "mt2", "mt3"],
  attribution: "© Google Maps",
};

/** Build the Google Maps tile layer. Pass the Leaflet module (`L`). */
export function googleTileLayer(L: Pick<typeof import("leaflet"), "tileLayer">) {
  return L.tileLayer(GOOGLE_TILE_URL, GOOGLE_TILE_OPTIONS);
}
