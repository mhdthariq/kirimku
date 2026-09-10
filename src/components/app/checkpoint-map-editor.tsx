"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CheckCircle2, Crosshair, GripVertical, Info, MapPin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/components/app/form-parts";
import { MEDAN_CENTER, DEFAULT_RADIUS_KM, kmToMeters, metersToKm } from "@/components/app/checkpoint-geo";

export interface DraftCheckpoint {
  id?: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

const MIN_CHECKPOINTS = 3;
// re-exported for convenience — import from checkpoint-geo in SSR-sensitive
// contexts (the module itself imports Leaflet)
export { MEDAN_CENTER, kmToMeters, metersToKm };

function seqIcon(sequence: number, highlight = false) {
  return L.divIcon({
    className: "kirimku-cp",
    html: `<div style="width:30px;height:30px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 12px/1 var(--font-geist-sans, sans-serif);background:${highlight ? "#0d9d70" : "#334155"};color:#fff;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);">${sequence}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/**
 * Interactive Leaflet route-checkpoint editor (Revision Parts B–H).
 *
 * ONE editable draft collection — the single source of truth lives in the
 * parent (RoutesPage); this component only mutates that draft through
 * `onChange`. There is deliberately NO per-checkpoint save button: newly added
 * checkpoints are committed by the parent's main "Simpan Semua Checkpoint"
 * action (bulk PUT /routes/{id}/checkpoints).
 *
 * - click the map OR press "Tambah Checkpoint" to append a checkpoint
 *   (both use the SAME editor form as existing checkpoints — Part C)
 * - drag markers to reposition, edit name/radius per checkpoint
 * - radius is edited & displayed in KILOMETERS (Part G), stored in meters
 * - every checkpoint radius is drawn as a circle on the map (Part G)
 * - zoom controls sit at the BOTTOM-LEFT (Part E)
 * - overlays are contained in an isolated stacking context so they can never
 *   cover the app navbar while scrolling (Part F)
 */
export function CheckpointMapEditor({
  checkpoints,
  onChange,
  canEdit = true,
  center = MEDAN_CENTER,
  height = 440,
}: {
  checkpoints: DraftCheckpoint[];
  onChange: (next: DraftCheckpoint[]) => void;
  canEdit?: boolean;
  center?: [number, number];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const circlesRef = useRef<Map<number, L.Circle>>(new Map());
  const polylineRef = useRef<L.Polyline | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);

  const idOf = (cp: DraftCheckpoint, index: number) => cp.id ?? -index - 1;
  const points = useMemo(
    () => checkpoints.map((cp, i) => ({ cp, key: idOf(cp, i) })),
    [checkpoints],
  );
  const boundsCenter = useMemo<[number, number]>(() => {
    if (checkpoints.length === 0) return center;
    const lat = checkpoints.reduce((s, c) => s + c.latitude, 0) / checkpoints.length;
    const lng = checkpoints.reduce((s, c) => s + c.longitude, 0) / checkpoints.length;
    return [lat, lng];
  }, [checkpoints.length]);

  // Init map once — no data-specific handlers here.
  // Revision Part E: zoom controls are moved to the bottom-left corner.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      scrollWheelZoom: true,
      zoomControl: false,
    }).setView(boundsCenter, checkpoints.length > 0 ? 8 : 10);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      circlesRef.current.clear();
      polylineRef.current = null;
    };
     
  }, []);

  // Append a checkpoint to the draft collection — the SAME editor form opens
  // for the new item as for existing ones (Revision Part C).
  function appendCheckpoint(lat: number, lng: number) {
    const next: DraftCheckpoint = {
      name: `Checkpoint ${checkpoints.length + 1}`,
      latitude: lat,
      longitude: lng,
      radiusMeters: kmToMeters(DEFAULT_RADIUS_KM),
    };
    onChangeRef.current([...checkpoints, next]);
    // auto-select the new checkpoint so its form opens instantly
    setSelectedKey(next.id ?? -(checkpoints.length + 1) - 1);
  }
  const appendRef = useRef(appendCheckpoint);
  useEffect(() => {
    appendRef.current = appendCheckpoint;
  });

  // Click-to-add checkpoint — re-registered so it always sees fresh checkpoints
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !canEdit) return;

    const handler = (e: L.LeafletMouseEvent) => {
      appendRef.current(Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7)));
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [canEdit]);

  // "Tambah Checkpoint" button — appends at the current map center (tiny
  // offset so consecutive adds don't stack exactly on one point).
  function addCheckpointAtCenter() {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const jitter = 0.006 * ((checkpoints.length % 5) - 2);
    appendCheckpoint(Number((c.lat + jitter).toFixed(7)), Number(c.lng.toFixed(7)));
  }

  // Re-render markers / circles / path when checkpoints change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<number>();
    points.forEach(({ cp, key }, index) => {
      seen.add(key);
      const isSel = selectedKey === key;
      let marker = markersRef.current.get(key);
      if (!marker) {
        marker = L.marker([cp.latitude, cp.longitude], { draggable: canEdit }).addTo(map);
        markersRef.current.set(key, marker);
      } else {
        marker.setLatLng([cp.latitude, cp.longitude]);
      }
      // Rebind handlers with fresh closures on every sync
      marker.off("dragend");
      marker.on("dragend", () => {
        const pos = marker!.getLatLng();
        const updated = checkpoints.map((c, i) =>
          idOf(c, i) === key
            ? { ...c, latitude: Number(pos.lat.toFixed(7)), longitude: Number(pos.lng.toFixed(7)) }
            : c,
        );
        onChangeRef.current(updated);
      });
      marker.off("click");
      marker.on("click", () => setSelectedKey(key));
      marker.setIcon(seqIcon(index + 1, isSel));
      marker.bindTooltip(`${index + 1}. ${cp.name}`, { direction: "top", offset: [0, -14] });

      // Revision Part G — radius circle per checkpoint, always in sync
      let circle = circlesRef.current.get(key);
      if (!circle) {
        circle = L.circle([cp.latitude, cp.longitude], {
          radius: cp.radiusMeters,
          color: "#0d9d70",
          weight: 1.5,
          fillColor: "#0d9d70",
          fillOpacity: 0.12,
        }).addTo(map);
        circlesRef.current.set(key, circle);
      } else {
        circle.setLatLng([cp.latitude, cp.longitude]);
        circle.setRadius(cp.radiusMeters);
      }
    });

    // remove stale
    for (const [key, marker] of markersRef.current) {
      if (!seen.has(key)) {
        marker.remove();
        markersRef.current.delete(key);
      }
    }
    for (const [key, circle] of circlesRef.current) {
      if (!seen.has(key)) {
        circle.remove();
        circlesRef.current.delete(key);
      }
    }

    // path polyline
    const latlngs = points.map((p) => [p.cp.latitude, p.cp.longitude] as [number, number]);
    if (latlngs.length >= 2) {
      if (polylineRef.current) {
        polylineRef.current.setLatLngs(latlngs);
      } else {
        polylineRef.current = L.polyline(latlngs, { color: "#0d9d70", weight: 2.5, opacity: 0.55, dashArray: "6 8" }).addTo(map);
      }
    } else if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    // fit bounds once when points appear / leave the viewport
    if (points.length > 0 && !map.getBounds().contains(L.latLng(points[0].cp.latitude, points[0].cp.longitude))) {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.25), { animate: false });
    }
  }, [points, selectedKey, canEdit]);

  function updateCheckpoint(key: number, patch: Partial<DraftCheckpoint>) {
    onChange(
      checkpoints.map((c, i) => (idOf(c, i) === key ? { ...c, ...patch } : c)),
    );
  }

  // Revision Parts B/AA: removal is a DRAFT-level operation — the checkpoint
  // is actually deleted server-side only when the main "Simpan Semua" commits.
  function removeCheckpoint(key: number) {
    onChange(checkpoints.filter((c, i) => idOf(c, i) !== key));
    if (selectedKey === key) setSelectedKey(null);
  }

  const selected = points.find((p) => p.key === selectedKey) ?? null;
  const belowMinimum = checkpoints.length < MIN_CHECKPOINTS;

  return (
    <div className="space-y-3">
      {/* Revision Part F — `isolate` creates a stacking context so the overlay
          chips below can NEVER float above the app navbar (z-30) on scroll. */}
      <div className="relative isolate">
        <div
          ref={containerRef}
          style={{ height }}
          className="w-full overflow-hidden rounded-xl border bg-muted/40"
          role="application"
          aria-label="Editor peta checkpoint — klik peta untuk menambah checkpoint"
        />
        {canEdit && (
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
            <Crosshair className="h-3.5 w-3.5 text-primary" />
            Klik peta / tombol untuk menambah checkpoint · tarik marker untuk menggeser
          </div>
        )}
        <Badge
          variant={belowMinimum ? "destructive" : "default"}
          className="absolute right-3 top-3 z-10 shadow-sm"
        >
          {checkpoints.length} checkpoint{belowMinimum && ` · min ${MIN_CHECKPOINTS}`}
        </Badge>
      </div>

      {/* Add Checkpoint — same editor form opens for the new item (Part C) */}
      {canEdit && (
        <Button type="button" variant="outline" onClick={addCheckpointAtCenter} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" /> Tambah Checkpoint
        </Button>
      )}

      {belowMinimum && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Rute wajib memiliki minimal <strong>{MIN_CHECKPOINTS} checkpoint</strong> (titik awal, minimal satu titik antara, titik akhir) dan tidak dibatasi jumlah maksimal.
          </span>
        </div>
      )}

      {/* Selected checkpoint editor — SHARED by existing AND new checkpoints
          (Revision Part C: one editor, not two). No nested save button: all
          changes are committed by the parent's main save action (Part D). */}
      {selected && canEdit && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              Checkpoint #{points.findIndex((p) => p.key === selected.key) + 1}
              {selected.cp.id ? (
                <Badge variant="outline" className="font-mono text-[10px]">tersimpan</Badge>
              ) : (
                <Badge className="font-mono text-[10px]">baru — tersimpan saat Simpan Semua</Badge>
              )}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => removeCheckpoint(selected.key)}
              aria-label="Hapus checkpoint dari draft"
            >
              <Trash2 className="h-4 w-4" /> Hapus
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="cp-name" className="text-xs font-medium text-foreground">
                Nama checkpoint
              </label>
              <Input
                id="cp-name"
                value={selected.cp.name}
                onChange={(e) => updateCheckpoint(selected.key, { name: e.target.value })}
                placeholder="mis. Rest Area KM 57"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cp-radius" className="text-xs font-medium text-foreground">
                Radius validasi (KM)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="cp-radius"
                  type="range"
                  min={0.05}
                  max={5}
                  step={0.05}
                  value={metersToKm(selected.cp.radiusMeters)}
                  onChange={(e) => updateCheckpoint(selected.key, { radiusMeters: kmToMeters(Number(e.target.value)) })}
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                  aria-label="Radius checkpoint dalam kilometer"
                />
                <Input
                  type="number"
                  min={0.01}
                  max={10}
                  step={0.05}
                  value={metersToKm(selected.cp.radiusMeters)}
                  onChange={(e) => {
                    const km = Math.max(0.01, Number(e.target.value) || 0.01);
                    updateCheckpoint(selected.key, { radiusMeters: kmToMeters(km) });
                  }}
                  className="h-8 w-24 text-xs"
                  aria-label="Nilai radius dalam kilometer"
                />
              </div>
            </div>
            <div className="sm:col-span-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>Latitude: <span className="font-mono">{selected.cp.latitude.toFixed(7)}</span></span>
              <span>Longitude: <span className="font-mono">{selected.cp.longitude.toFixed(7)}</span></span>
              <span>
                Radius: <span className="font-mono">{formatNumber(metersToKm(selected.cp.radiusMeters), 2)} KM</span>
                <span className="ml-1 opacity-70">({formatNumber(selected.cp.radiusMeters, 0)} m)</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Compact list for all checkpoints (saved + new) — one collection */}
      {points.length > 0 && (
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {points.map(({ cp, key }, index) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => setSelectedKey(key)}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition hover:border-primary/40 ${
                  selectedKey === key ? "border-primary/50 bg-accent" : "bg-card"
                }`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{cp.name}</span>
                {cp.id ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600/70 dark:text-emerald-400/70" aria-label="tersimpan" />
                ) : (
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-600/70 dark:text-amber-400/70" aria-label="baru" />
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatNumber(metersToKm(cp.radiusMeters), 2)} KM</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
