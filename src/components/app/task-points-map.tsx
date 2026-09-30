"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { googleTileLayer } from "@/lib/map-tiles";

export interface TaskMapPoint {
  id: number;
  kind: "pickup" | "delivery";
  latitude: number;
  longitude: number;
  code: string;
  title: string;
  subtitle?: string | null;
}

const PIN_COLOR: Record<TaskMapPoint["kind"], string> = {
  pickup: "#dc2626", // red — package to collect
  delivery: "#16a34a", // green — package to drop off
};

function pinIcon(color: string) {
  return L.divIcon({
    className: "kirimku-pin",
    html: `<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -26],
  });
}

/**
 * Read-only task map for the kurir dashboard (fix, 2026-09-26) — plots every
 * pickup (RED) and delivery (GREEN) that has coordinates set, so the courier
 * can see at a glance where each package needs to be collected / dropped off.
 * Points without coordinates are simply skipped (nothing to plot).
 */
export function TaskPointsMap({ points, height = 320 }: { points: TaskMapPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // Revision Part H — default focus is Medan / North Sumatra (never Jakarta).
    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView([3.5952, 98.6722], 12);
    googleTileLayer(L).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
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

    const plottable = points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    for (const p of plottable) {
      L.marker([p.latitude, p.longitude], { icon: pinIcon(PIN_COLOR[p.kind]) })
        .bindPopup(
          `<div style="font-size:12px;line-height:1.4">
             <strong>${p.kind === "pickup" ? "🔴 Jemput" : "🟢 Antar"} · ${p.code}</strong><br/>
             ${p.title}${p.subtitle ? `<br/><span style="color:#666">${p.subtitle}</span>` : ""}
           </div>`,
        )
        .addTo(layer);
    }

    if (plottable.length > 0) {
      const bounds = L.latLngBounds(plottable.map((p) => [p.latitude, p.longitude] as [number, number]));
      map.fitBounds(bounds.pad(0.2), { maxZoom: 15 });
    }
  }, [points]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full overflow-hidden rounded-lg border bg-muted/40"
      role="application"
      aria-label="Peta tugas - titik merah jemput, titik hijau antar"
    />
  );
}
