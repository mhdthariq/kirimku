"use client";

import { useEffect, useRef, useState } from "react";
import type { TransportActivityInput } from "@/infrastructure/http/client-api";
import { Button } from "@/components/ui/button";

/** Evidence must come from the live camera, paired with a fresh GPS fix. */
export function ActivityCamera({ onCaptured, disabled = false }: {
  onCaptured: (capture: TransportActivityInput) => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Kamera tidak tersedia. Gunakan HTTPS dan izinkan akses kamera.");
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
        }
      } catch {
        if (!cancelled) setError("Kamera gagal dibuka. Gunakan HTTPS dan izinkan akses kamera, lalu buka ulang kamera.");
      }
    }
    void start();
    return () => {
      cancelled = true;
      mounted.current = false;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, []);

  async function capture() {
    setBusy(true);
    setError(null);
    try {
      if (!navigator.geolocation) throw new Error("GPS tidak tersedia. Foto tidak dapat disimpan tanpa lokasi.");
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("GPS gagal diperoleh. Izinkan lokasi dan coba lagi.")), {
          enableHighAccuracy: true, timeout: 15000, maximumAge: 0,
        });
      });
      if (!mounted.current) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0) {
        throw new Error("Lokasi GPS tidak valid. Coba lagi.");
      }
      const source = video.current;
      if (!source || !source.videoWidth || !source.videoHeight || !stream.current?.getVideoTracks().some((track) => track.readyState === "live")) {
        throw new Error("Kamera belum siap atau terputus. Buka ulang kamera.");
      }
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / Math.max(source.videoWidth, source.videoHeight));
      canvas.width = Math.round(source.videoWidth * scale);
      canvas.height = Math.round(source.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Pengambilan foto gagal. Coba lagi.");
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL("image/jpeg", 0.8);
      if (!photo.startsWith("data:image/jpeg;base64,")) throw new Error("Pengambilan foto gagal. Coba lagi.");
      onCaptured({ photo, latitude, longitude, locationAccuracy: accuracy, capturedAt: new Date().toISOString() });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Pengambilan foto gagal.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <video ref={video} autoPlay muted playsInline aria-label="Pratinjau kamera aktivitas" onLoadedData={() => setReady(true)} className="max-h-80 w-full rounded-lg bg-black" />
      <p className="text-xs text-muted-foreground">Kamera dan GPS wajib diizinkan. Lokasi baru diambil setiap kali foto ditangkap.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="button" disabled={!ready || busy || disabled} onClick={() => void capture()}>
        {busy ? "Mengambil GPS & foto…" : "Ambil Foto dengan GPS"}
      </Button>
    </div>
  );
}
