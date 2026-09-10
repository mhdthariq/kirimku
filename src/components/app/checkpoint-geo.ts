/**
 * Client-safe checkpoint geo helpers (no Leaflet import — safe for SSR).
 * Extracted from checkpoint-map-editor so pages can use them without
 * evaluating the Leaflet module on the server.
 */

// Revision Part H — the system operates in Medan / North Sumatra: never
// default the map to Jakarta/Java.
export const MEDAN_CENTER: [number, number] = [3.5952, 98.6722];

export const DEFAULT_RADIUS_KM = 0.25;

export const kmToMeters = (km: number) => Math.round(km * 1000);

/** meters → km rounded to 2 decimals. */
export const metersToKm = (m: number) => Math.round((m / 1000) * 100) / 100;
