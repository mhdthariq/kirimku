"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Checkpoint } from "@/lib/client-api";

export interface TransportMapCheckpoint extends Checkpoint {
  checkedIn: boolean;
  latestRecordAt: string | null;
  latestBy: string | null;
}

export interface TransportCheckinPoint {
  latitude: number;
  longitude: number;
  recordedAt: string;
}

/**
 * Transport position map (Revision Part K §2):
 * - route polyline + every checkpoint with its radius circle
 * - checkpoints already checked in are highlighted with a green cargo marker
 * - the transport's current (last known) position marker
 * - zoom controls bottom-left, overlays inside an isolated stacking context
 *   (never covers the navbar — Revision Part F)
 */
export function TransportMap({
  checkpoints,
  currentPosition,
  checkins,
  height = 340,
  fitTo = "route",
}: {
  checkpoints: TransportMapCheckpoint[];
  currentPosition: { latitude: number; longitude: number; recordedAt: string | null } | null;
  checkins: TransportCheckinPoint[];
  height?: number;
  fitTo?: "route" | "position";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false, scrollWheelZoom: true }).setView([3.5952, 98.6722], 8);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const latlngs: [number, number][] = [];

    checkpoints.forEach((c) => {
      latlngs.push([c.latitude, c.longitude]);
      // radius circle (Revision Part G — visualized on the map)
      L.circle([c.latitude, c.longitude], {
        radius: c.radiusMeters,
        color: c.checkedIn ? "#0d9d70" : "#94a3b8",
        weight: 1.5,
        fillColor: c.checkedIn ? "#0d9d70" : "#94a3b8",
        fillOpacity: 0.12,
      }).addTo(layer);

      const icon = L.divIcon({
        className: "kirimku-tp",
        html: `<div style="min-width:${c.checkedIn ? "38px" : "30px"};height:${c.checkedIn ? "38px" : "30px"};border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 ${c.checkedIn ? "17px" : "12px"}/1 var(--font-geist-sans, sans-serif);background:${c.checkedIn ? "#0d9d70" : "#334155"};color:#fff;border:${c.checkedIn ? "3px solid #86efac" : "3px solid #fff"};box-shadow:0 2px 8px rgba(0,0,0,.35);padding:0 6px;">${c.checkedIn ? "📦" : c.sequence}</div>`,
        iconSize: c.checkedIn ? [38, 38] : [30, 30],
        iconAnchor: c.checkedIn ? [19, 19] : [15, 15],
      });
      const label = `${c.sequence}. ${c.name}${c.checkedIn ? ` — check-in ${c.latestRecordAt ? new Date(c.latestRecordAt).toLocaleString("id-ID") : ""}${c.latestBy ? ` oleh ${c.latestBy}` : ""}` : ` · radius ${(c.radiusMeters / 1000).toFixed(2)} KM`}`;
      const marker = L.marker([c.latitude, c.longitude], { icon }).addTo(layer).bindTooltip(label, { direction: "top", offset: [0, c.checkedIn ? -19 : -12] });
      if (c.checkedIn) marker.openTooltip();
    });

    if (latlngs.length >= 2) {
      L.polyline(latlngs, { color: "#0d9d70", weight: 2.5, opacity: 0.55, dashArray: "6 8" }).addTo(layer);
    }

    // current position marker (last known)
    if (currentPosition) {
      const icon = L.divIcon({
        className: "kirimku-truck",
        html: `<div style="width:34px;height:34px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:#2563eb;color:#fff;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4);font-size:16px;">🚚</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      L.marker([currentPosition.latitude, currentPosition.longitude], { icon })
        .addTo(layer)
        .bindTooltip(
          `Posisi terakhir transport${currentPosition.recordedAt ? ` — ${new Date(currentPosition.recordedAt).toLocaleString("id-ID")}` : ""}`,
          { direction: "top", offset: [0, -12] },
        );
    }

    // all check-in points (trace)
    checkins.forEach((p) => {
      L.circleMarker([p.latitude, p.longitude], {
        radius: 4,
        color: "#2563eb",
        weight: 2,
        fillColor: "#2563eb",
        fillOpacity: 0.8,
      })
        .addTo(layer)
        .bindTooltip(`Check-in ${new Date(p.recordedAt).toLocaleString("id-ID")}`, { direction: "top" });
    });

    // fit bounds
    const all: [number, number][] = [...latlngs];
    if (currentPosition && fitTo === "position") all.push([currentPosition.latitude, currentPosition.longitude]);
    if (all.length > 0) {
      map.fitBounds(L.latLngBounds(all).pad(0.25), { animate: false });
    }
  }, [checkpoints, currentPosition, checkins, fitTo]);

  return (
    <div className="relative isolate">
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full overflow-hidden rounded-xl border bg-muted/40"
        role="application"
        aria-label="Peta posisi transport dan checkpoint"
      />
    </div>
  );
}
