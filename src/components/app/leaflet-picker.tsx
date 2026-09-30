"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { googleTileLayer } from "@/lib/map-tiles";

/**
 * Simple single-point location picker (used by the Gudang, Pickup and
 * Delivery forms). Click the map to set coordinates; marker is draggable.
 * Tiles: Google Maps (roadmap) instead of OpenStreetMap.
 */
export function LeafletPicker({
  latitude,
  longitude,
  onChange,
  height = 280,
  zoom = 11,
  markerColor = "#0d9d70",
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
  height?: number;
  zoom?: number;
  /** Pin color — e.g. red for pickup points, green for delivery points. */
  markerColor?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Revision Part H — default focus is Medan / North Sumatra (never Jakarta).
    const center: [number, number] =
      latitude != null && longitude != null ? [latitude, longitude] : [3.5952, 98.6722];

    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(center, zoom);
    // Google Maps roadmap tiles (replaces OpenStreetMap).
    googleTileLayer(L).addTo(map);
    mapRef.current = map;

    const icon = L.divIcon({
      className: "kirimku-pin",
      html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${markerColor};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 22],
    });

    if (latitude != null && longitude != null) {
      markerRef.current = L.marker([latitude, longitude], { draggable: true, icon }).addTo(map);
    }

    function setPoint(lat: number, lng: number) {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], { draggable: true, icon }).addTo(map);
        markerRef.current.on("dragend", () => {
          const pos = markerRef.current!.getLatLng();
          onChangeRef.current(pos.lat, pos.lng);
        });
      }
      onChangeRef.current(lat, lng);
    }

    map.on("click", (e: L.LeafletMouseEvent) => {
      setPoint(e.latlng.lat, e.latlng.lng);
    });
    if (markerRef.current) {
      markerRef.current.on("dragend", () => {
        const pos = markerRef.current!.getLatLng();
        onChangeRef.current(pos.lat, pos.lng);
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
     
  }, []);

  // Sync external value changes (e.g. form reset)
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (latitude == null || longitude == null) return;
    const current = marker.getLatLng();
    if (Math.abs(current.lat - latitude) > 1e-7 || Math.abs(current.lng - longitude) > 1e-7) {
      marker.setLatLng([latitude, longitude]);
      map.setView([latitude, longitude], Math.max(map.getZoom(), 13));
    }
  }, [latitude, longitude]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full overflow-hidden rounded-lg border bg-muted/40"
      role="application"
      aria-label="Peta pemilih lokasi - klik untuk menentukan koordinat"
    />
  );
}
