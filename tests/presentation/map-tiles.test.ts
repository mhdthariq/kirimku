import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { GOOGLE_TILE_OPTIONS, GOOGLE_TILE_URL, googleTileLayer } from "@/presentation/map-tiles";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("map tiles are Google Maps everywhere", () => {
  it("the shared config points at Google, not OpenStreetMap", () => {
    expect(GOOGLE_TILE_URL).toContain("google.com/vt");
    expect(GOOGLE_TILE_URL).not.toMatch(/openstreetmap/i);
    expect(GOOGLE_TILE_OPTIONS.subdomains).toEqual(["mt0", "mt1", "mt2", "mt3"]);
  });

  it("googleTileLayer builds the layer from that config", () => {
    const calls: unknown[][] = [];
    const fakeL = { tileLayer: (...args: unknown[]) => (calls.push(args), {}) };
    googleTileLayer(fakeL as never);
    expect(calls[0]).toEqual([GOOGLE_TILE_URL, GOOGLE_TILE_OPTIONS]);
  });

  it("no source file uses an OpenStreetMap tile URL or calls tileLayer() directly", () => {
    const root = path.resolve(__dirname, "../../src");
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (/map-tiles(\.test)?\.ts$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      if (/tile\.openstreetmap\.org/i.test(text) || /\btileLayer\s*\(/.test(text)) offenders.push(path.relative(root, file));
    }
    // Any new map must use googleTileLayer(L) from "@/presentation/map-tiles".
    expect(offenders).toEqual([]);
  });
});
