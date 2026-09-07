"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Navigation } from "lucide-react";
import type { TransportCheckpoint, TransportCheckpointRecord } from "@/lib/client-api";
import { formatDate, formatNumber } from "@/components/app/form-parts";

export interface TransportPosition {
  latitude: number;
  longitude: number;
  label: string;
  kind: string;
  recordedAt: string | null;
}

const TRUCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 18H3c-.6 0-1-.4-1-1V7c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v11"/><path d="M14 9h4l4 4v4c0 .6-.4 1-1 1h-2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>`;

function cpIcon(sequence: number, passed: boolean) {
  return L.divIcon({
    className: "kirimku-cp",
    html: `<div style="width:30px;height:30px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 12px/1 var(--font-geist-sans, sans-serif);background:${passed ? "#0d9d70" : "#334155"};color:#fff;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);${passed ? "" : "opacity:.92;"}">${sequence}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function truckIcon() {
  return L.divIcon({
    className: "kirimku-truck",
    html: `<div class="transport-truck-pin" style="width:38px;height:38px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:#0d9d70;color:#fff;border:3px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,.45);">${TRUCK_SVG}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function breadcrumbIcon() {
  return L.divIcon({
    className: "kirimku-bc",
    html: `<div style="width:10px;height:10px;border-radius:9999px;background:#64748b;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

/**
 * Read-only Leaflet map for a transport (linehaul) journey:
 * - numbered route checkpoints (emerald = already passed, slate = upcoming)
 * - dashed route polyline + subtle radius circles
 * - live vehicle position (truck pin, pulsing) with a detail popup
 * - off-route GPS breadcrumbs from manual position records
 */
export function TransportMap({
  checkpoints,
  records,
  currentPosition,
  vehicleNumber,
  height = 420,
}: {
  checkpoints: TransportCheckpoint[];
  records: TransportCheckpointRecord[];
  currentPosition: TransportPosition | null;
  vehicleNumber: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const circlesRef = useRef<Map<number, L.Circle>>(new Map());
  const breadcrumbsRef = useRef<Map<number, L.Marker>>(new Map());
  const polylineRef = useRef<L.Polyline | null>(null);
  const truckRef = useRef<L.Marker | null>(null);

  const center = useMemo<[number, number]>(() => {
    if (checkpoints.length === 0) return [-6.35, 107.1];
    return [checkpoints[0].latitude, checkpoints[0].longitude];
  }, [checkpoints]);

  // Init map once — read-only, no click-to-add
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(center, 7);
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
      breadcrumbsRef.current.clear();
      polylineRef.current = null;
      truckRef.current = null;
    };
  }, []);

  // Render checkpoint markers / circles / route path
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<number>();
    checkpoints.forEach((cp) => {
      seen.add(cp.id);
      let marker = markersRef.current.get(cp.id);
      if (!marker) {
        marker = L.marker([cp.latitude, cp.longitude], { draggable: false }).addTo(map);
        markersRef.current.set(cp.id, marker);
      } else {
        marker.setLatLng([cp.latitude, cp.longitude]);
      }
      marker.setIcon(cpIcon(cp.sequence, cp.passed));
      const when = cp.passed && cp.lastRecordAt ? ` · dilewati ${formatDate(cp.lastRecordAt, true)}` : "";
      marker.bindTooltip(`${cp.sequence}. ${cp.name}${when}`, { direction: "top", offset: [0, -14] });

      let circle = circlesRef.current.get(cp.id);
      if (!circle) {
        circle = L.circle([cp.latitude, cp.longitude], {
          radius: cp.radiusMeters,
          color: cp.passed ? "#0d9d70" : "#94a3b8",
          weight: 1.2,
          fillColor: cp.passed ? "#0d9d70" : "#94a3b8",
          fillOpacity: 0.1,
        }).addTo(map);
        circlesRef.current.set(cp.id, circle);
      } else {
        circle.setLatLng([cp.latitude, cp.longitude]);
        circle.setRadius(cp.radiusMeters);
        circle.setStyle({ color: cp.passed ? "#0d9d70" : "#94a3b8", fillColor: cp.passed ? "#0d9d70" : "#94a3b8" });
      }
    });

    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
    for (const [id, circle] of circlesRef.current) {
      if (!seen.has(id)) {
        circle.remove();
        circlesRef.current.delete(id);
      }
    }

    const latlngs = checkpoints.map((c) => [c.latitude, c.longitude] as [number, number]);
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
  }, [checkpoints]);

  // GPS breadcrumbs (manual / off-route position records)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const offRoute = records.filter((r) => !r.withinRadius);
    const seen = new Set<number>();
    offRoute.forEach((r) => {
      seen.add(r.id);
      let m = breadcrumbsRef.current.get(r.id);
      if (!m) {
        m = L.marker([r.latitude, r.longitude], { icon: breadcrumbIcon(), interactive: true }).addTo(map);
        m.bindTooltip(`Posisi GPS — ${r.checkpointName} · ${formatDate(r.recordedAt, true)}`, { direction: "top" });
        breadcrumbsRef.current.set(r.id, m);
      }
    });
    for (const [id, m] of breadcrumbsRef.current) {
      if (!seen.has(id)) {
        m.remove();
        breadcrumbsRef.current.delete(id);
      }
    }
  }, [records]);

  // Vehicle position pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentPosition) {
      if (truckRef.current) {
        truckRef.current.remove();
        truckRef.current = null;
      }
      return;
    }
    const at = currentPosition.recordedAt ? `<br/>Posisi terakhir: ${formatDate(currentPosition.recordedAt, true)}` : "";
    const popup = `<div style="font:500 12px/1.5 var(--font-geist-sans, sans-serif)"><strong>${vehicleNumber}</strong><br/>${currentPosition.label}${at}</div>`;
    if (!truckRef.current) {
      truckRef.current = L.marker([currentPosition.latitude, currentPosition.longitude], {
        icon: truckIcon(),
        zIndexOffset: 1000,
      })
        .addTo(map)
        .bindPopup(popup);
    } else {
      truckRef.current.setLatLng([currentPosition.latitude, currentPosition.longitude]);
      truckRef.current.setPopupContent(popup);
    }
    truckRef.current.bindTooltip(currentPosition.label, { direction: "top", offset: [0, -18] });
  }, [currentPosition, vehicleNumber]);

  // Fit bounds once per transport
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts = checkpoints.map((c) => [c.latitude, c.longitude] as [number, number]);
    if (currentPosition) pts.push([currentPosition.latitude, currentPosition.longitude]);
    if (pts.length === 0) return;
    if (!map.getBounds().contains(L.latLng(pts[0]))) {
      map.fitBounds(L.latLngBounds(pts).pad(0.25), { animate: false });
    }
  }, [checkpoints, currentPosition]);

  const passedCount = checkpoints.filter((c) => c.passed).length;

  return (
    <div className="relative">
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full overflow-hidden rounded-xl border bg-muted/40"
        role="application"
        aria-label={`Peta perjalanan transport — ${vehicleNumber}`}
      />
      <div className="pointer-events-none absolute left-3 top-3 z-[400] max-w-[70%] rounded-lg bg-background/90 px-3 py-2 shadow-sm backdrop-blur">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Navigation className="h-3.5 w-3.5 text-primary" /> {vehicleNumber}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{currentPosition?.label ?? "Posisi tidak diketahui"}</p>
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-[400] flex flex-col gap-1 rounded-lg bg-background/90 px-2.5 py-2 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> Checkpoint dilewati ({passedCount}/{checkpoints.length})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-500" /> Checkpoint berikutnya
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-primary/30" /> Posisi kendaraan
        </span>
      </div>
      {records.length > 0 && (
        <p className="absolute bottom-3 left-3 z-[400] rounded-lg bg-background/90 px-2.5 py-1.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
          {formatNumber(records.length, 0)} catatan posisi · terakhir{" "}
          {records[0]?.recordedAt ? formatDate(records[0].recordedAt, true) : "—"}
        </p>
      )}
    </div>
  );
}
