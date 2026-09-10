"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Crosshair, Loader2, MapPin, RefreshCw, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { apiPost, type CheckinResponse, type Checkpoint } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatNumber } from "@/components/app/form-parts";

export interface CheckinCheckpointInfo extends Checkpoint {
  checkedIn: boolean;
  latestRecordAt: string | null;
}

interface CheckinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transportId: number;
  transportCode: string;
  checkpoints: CheckinCheckpointInfo[];
  onDone: () => void;
}

/** Haversine distance (meters) — client-side preview only; the server
 *  recomputes and enforces the radius (Revision Part Z). */
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Compress a captured frame / file to a ~720px JPEG data URL. */
function compressToJpeg(source: HTMLVideoElement | HTMLImageElement, maxSide = 720): string {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w, h) || 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

/**
 * Checkpoint selfie check-in dialog (Revision Part O).
 * - pick the checkpoint (unchecked ones only)
 * - capture GPS (live distance preview vs the checkpoint radius)
 * - take a selfie with the camera (getUserMedia; fallback: file capture)
 * - submit → server validates the radius and stores photo + location + user
 */
export function CheckpointCheckinDialog({ open, onOpenChange, transportId, transportCode, checkpoints, onDone }: CheckinDialogProps) {
  const [checkpointId, setCheckpointId] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pending = checkpoints.filter((c) => !c.checkedIn);
  const selected = checkpoints.find((c) => c.id === checkpointId) ?? null;

  // reset when opened
  useEffect(() => {
    if (open) {
      setCheckpointId(pending[0]?.id ?? null);
      setPhoto(null);
      setError(null);
      setCoords(null);
    }
     
  }, [open]);

  // cleanup camera on close
  useEffect(() => {
    if (!open) stopCamera();
    return () => stopCamera();
     
  }, [open]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError("Kamera tidak dapat diakses — gunakan tombol “Unggah Foto” sebagai gantinya.");
    }
  }, []);

  const capture = useCallback(() => {
    if (!videoRef.current) return;
    try {
      const dataUrl = compressToJpeg(videoRef.current);
      setPhoto(dataUrl);
      stopCamera();
    } catch {
      setError("Gagal memproses foto — coba lagi.");
    }
  }, [stopCamera]);

  const onPickFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("bad image"));
        image.src = url;
      });
      setPhoto(compressToJpeg(img));
    } catch {
      setError("File foto tidak dapat dibaca.");
    }
  }, []);

  const locate = useCallback(() => {
    setError(null);
    if (!navigator.geolocation) {
      setError("Perangkat tidak mendukung lokasi GPS.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError("Lokasi tidak dapat diambil — pastikan izin lokasi aktif, lalu coba lagi.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 },
    );
  }, []);

  // auto-locate once when a checkpoint is selected and we have no fix yet
  useEffect(() => {
    if (open && selected && !coords && !locating) locate();
     
  }, [open, selected?.id]);

  const liveDistance = selected && coords ? distanceMeters(coords.lat, coords.lng, selected.latitude, selected.longitude) : null;
  const radiusM = selected?.radiusMeters ?? 0;
  const inRadius = liveDistance != null && liveDistance <= radiusM;

  async function submit() {
    if (!selected || submitting) return;
    if (!coords) {
      setError("Lokasi GPS belum didapat — tekan tombol lokasi.");
      return;
    }
    if (!photo) {
      setError("Foto selfie wajib diambil sebagai bukti check-in.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<CheckinResponse>(`/transports/${transportId}/checkins`, {
        checkpointId: selected.id,
        latitude: coords.lat,
        longitude: coords.lng,
        photo,
      });
      toast.success(res.message);
      onOpenChange(false);
      onDone();
    } catch (err) {
      // The server explains precisely why a check-in was rejected (distance
      // vs radius) — surface it verbatim (Revision Part O).
      setError(err instanceof Error ? err.message : "Check-in gagal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" /> Check-in Checkpoint — {transportCode}
          </DialogTitle>
          <DialogDescription>
            Ambil foto selfie di lokasi checkpoint. Sistem memvalidasi jarak Anda terhadap radius checkpoint.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* checkpoint picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Checkpoint</label>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              value={checkpointId ?? ""}
              onChange={(e) => setCheckpointId(Number(e.target.value) || null)}
              disabled={submitting || pending.length === 0}
            >
              {pending.length === 0 && <option value="">Semua checkpoint sudah check-in</option>}
              {pending.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.sequence} · {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* GPS */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">Lokasi GPS</label>
              <Button type="button" variant="outline" size="sm" className="h-7" onClick={locate} disabled={locating || submitting}>
                {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Ambil Lokasi
              </Button>
            </div>
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                coords
                  ? inRadius
                    ? "border-emerald-300 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-amber-300 bg-amber-50/60 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                  : "bg-muted/40 text-muted-foreground"
              }`}
            >
              {coords ? (
                <div className="flex items-start gap-2">
                  <Crosshair className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-mono">{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)} (±{coords.accuracy} m)</p>
                    {selected && (
                      <p className="mt-0.5">
                        Jarak ke {selected.name}: <strong>{formatNumber((liveDistance ?? 0) / 1000, 2)} KM</strong> · radius{" "}
                        <strong>{formatNumber(radiusM / 1000, 2)} KM</strong>{" "}
                        {inRadius ? "— dalam radius ✓" : "— DI LUAR RADIUS, mendekatlah ke checkpoint"}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2">
                  <Crosshair className="h-3.5 w-3.5" /> {locating ? "Mencari lokasi GPS…" : "Lokasi belum diambil."}
                </p>
              )}
            </div>
          </div>

          {/* selfie */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Foto Selfie (bukti check-in)</label>
            {photo ? (
              <div className="space-y-2">
                { }
                <img src={photo} alt="Bukti selfie check-in" className="h-44 w-full rounded-lg border object-cover" />
                <Button type="button" variant="outline" size="sm" onClick={() => setPhoto(null)} disabled={submitting}>
                  <Upload className="h-3.5 w-3.5" /> Ganti Foto
                </Button>
              </div>
            ) : cameraOn ? (
              <div className="space-y-2">
                <video ref={videoRef} playsInline muted className="h-44 w-full rounded-lg border bg-black object-cover" />
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={capture} disabled={submitting}>
                    <Camera className="h-3.5 w-3.5" /> Ambil Foto
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={stopCamera} disabled={submitting}>
                    Batal
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Button type="button" variant="outline" className="w-full" onClick={startCamera} disabled={submitting}>
                  <Camera className="h-4 w-4" /> Buka Kamera Selfie
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onPickFile(file);
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="ghost" className="w-full text-xs text-muted-foreground" onClick={() => fileInputRef.current?.click()} disabled={submitting}>
                  atau unggah foto dari galeri
                </Button>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={submit} disabled={submitting || !photo || !coords || !selected}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {submitting ? "Mengirim…" : "Kirim Check-in"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
