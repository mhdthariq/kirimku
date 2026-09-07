"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Simple single-point location picker (used by the Gudang form).
 * Click the map to set coordinates; marker is draggable.
 */
export function LeafletPicker({
  latitude,
  longitude,
  onChange,
  height = 280,
  zoom = 11,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
  height?: number;
  zoom?: number;
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

    const center: [number, number] =
      latitude != null && longitude != null ? [latitude, longitude] : [-6.2, 106.816666];

    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(center, zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;

    const icon = L.divIcon({
      className: "kirimku-pin",
      html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#0d9d70;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);"></div>',
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
      aria-label="Peta pemilih lokasi — klik untuk menentukan koordinat"
    />
  );
}
