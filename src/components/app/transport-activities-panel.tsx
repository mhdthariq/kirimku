"use client";

import { useState } from "react";
import Image from "next/image";
import { Download, Share2 } from "lucide-react";
import { downloadActivityPhotos, shareActivityPhotos } from "@/presentation/activity-photo-sharing";
import { apiGet, apiPost, type TransportActivityInput, type TransportActivityRow } from "@/infrastructure/http/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { ActivityCamera } from "@/components/app/activity-camera";
import { formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TransportActivitiesPanel({ transportId, canCreate, onChanged, onViewPhoto }: {
  transportId: number;
  canCreate: boolean;
  onChanged: () => void;
  onViewPhoto?: (activity: TransportActivityRow) => void;
}) {
  const { data, loading, error, reload } = useApiData<TransportActivityRow[]>(
    () => apiGet(`/transports/${transportId}/activities`), [transportId],
  );
  const [cameraOpen, setCameraOpen] = useState(false);
  const [draft, setDraft] = useState<TransportActivityInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  async function exportPhotos(photos: TransportActivityRow[], download = false) {
    if (sharing) return;
    setSharing(true);
    setShareMessage(null);
    setShareError(null);
    try {
      if (download) {
        await downloadActivityPhotos(photos, transportId);
        setShareMessage("Foto siap diunduh. Kirim file hasil unduhan melalui WhatsApp atau aplikasi lain.");
      } else {
        const result = await shareActivityPhotos(photos, transportId);
        if (result === "unsupported") setShareMessage("Browser ini belum mendukung berbagi file foto. Gunakan Unduh, lalu kirim hasil unduhan melalui WhatsApp atau aplikasi lain.");
      }
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : "Foto gagal disiapkan. Coba lagi.");
    } finally {
      setSharing(false);
    }
  }

  async function save() {
    if (!draft || !canCreate || busy) return;
    setBusy(true);
    setSaveError(null);
    const ok = await runAction(() => apiPost(`/transports/${transportId}/activities`, draft), {
      success: "Foto aktivitas disimpan.", onError: setSaveError,
    });
    setBusy(false);
    if (ok) {
      setDraft(null);
      void reload();
      onChanged();
    }
  }

  return (
    <Card className="min-w-0 rounded-2xl shadow-sm">
      <CardHeader className="gap-3">
        <CardTitle className="text-base">Activity Tracking (Tanpa Checkpoint)</CardTitle>
        {!!data?.length && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="outline" disabled={sharing || loading || !!error} onClick={() => void exportPhotos(data)}><Share2 className="h-4 w-4 shrink-0" />Bagikan semua ({data.length})</Button>
          <Button variant="outline" disabled={sharing || loading || !!error} onClick={() => void exportPhotos(data, true)}><Download className="h-4 w-4 shrink-0" />Unduh semua{data.length > 1 ? " (ZIP)" : ""}</Button>
        </div>}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Tambahkan beberapa foto melalui pengambilan berulang. Setiap foto menyimpan waktu dan lokasi GPS sendiri.</p>
        <p className="text-xs text-muted-foreground">Watermark waktu, GPS, transport, dan pencatat ditambahkan otomatis saat foto disimpan. Bagikan foto ke WhatsApp atau aplikasi lain melalui menu berbagi perangkat.</p>
        {sharing && <p role="status" className="text-sm text-muted-foreground">Menyiapkan foto…</p>}
        {shareMessage && <p role="status" className="break-words text-sm text-muted-foreground">{shareMessage}</p>}
        {shareError && <p role="alert" className="break-words text-sm text-destructive">{shareError}</p>}
        {canCreate && !cameraOpen && !draft && <Button onClick={() => setCameraOpen(true)}>Tambah Foto Aktivitas</Button>}
        {canCreate && cameraOpen && !draft && (
          <div className="space-y-3">
            <ActivityCamera onCaptured={(capture) => { setDraft(capture); setCameraOpen(false); }} />
            <Button variant="outline" onClick={() => setCameraOpen(false)}>Tutup Kamera</Button>
          </div>
        )}
        {canCreate && draft && (
          <div className="space-y-3 rounded-lg border p-3">
            <Image unoptimized src={draft.photo} alt="Foto aktivitas yang akan disimpan" width={640} height={480} className="max-h-72 w-full rounded-md object-contain" />
            <p className="break-words text-xs">{formatDate(draft.capturedAt, true)} · {draft.latitude}, {draft.longitude} · Akurasi {draft.locationAccuracy} m</p>
            {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button disabled={busy} onClick={() => void save()}>{busy ? "Menyimpan…" : "Simpan Foto"}</Button>
              <Button variant="outline" disabled={busy} onClick={() => { setDraft(null); setSaveError(null); setCameraOpen(true); }}>Ambil Ulang</Button>
            </div>
          </div>
        )}
        {!canCreate && <p className="text-xs text-muted-foreground">Pencatatan hanya untuk kru yang ditugaskan dengan izin check-in pada transport PLANNED / DEPARTED.</p>}
        {loading && <p role="status">Memuat aktivitas…</p>}
        {error ? (
          <div role="alert" className="space-y-2">
            <p>Gagal memuat aktivitas: {error}</p>
            <Button variant="outline" onClick={() => void reload()}>Coba lagi</Button>
          </div>
        ) : !loading && data?.length === 0 && <p className="text-sm text-muted-foreground">Belum ada foto aktivitas.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {data?.map((activity) => (
            <article key={activity.id} className="min-w-0 space-y-2 break-words rounded-xl border p-3">
              <Image unoptimized src={activity.photoUrl} alt={`Foto aktivitas ${activity.id}`} width={640} height={480} className="max-h-72 w-full rounded-md object-contain" />
              <div className="flex flex-wrap gap-2">
                {onViewPhoto && <Button variant="outline" size="sm" onClick={() => onViewPhoto(activity)}>Lihat Foto Aktivitas {activity.id}</Button>}
                <Button variant="outline" size="sm" aria-label={`Bagikan foto aktivitas ${activity.id}`} disabled={sharing} onClick={() => void exportPhotos([activity])}><Share2 className="h-4 w-4" />Bagikan</Button>
                <Button variant="outline" size="sm" aria-label={`Unduh foto aktivitas ${activity.id}`} disabled={sharing} onClick={() => void exportPhotos([activity], true)}><Download className="h-4 w-4" />Unduh</Button>
              </div>
              <p className="text-sm">Diambil: {formatDate(activity.capturedAt, true)}</p>
              <p className="text-xs text-muted-foreground">Dicatat: {formatDate(activity.recordedAt, true)} · {activity.recordedByUsername ?? "-"}</p>
              <p className="text-xs">GPS: {activity.latitude}, {activity.longitude}{activity.locationAccuracy != null && ` · Akurasi ${activity.locationAccuracy} m`}</p>
              <a className="text-sm text-primary underline" href={`https://www.google.com/maps?q=${activity.latitude},${activity.longitude}`} target="_blank" rel="noopener noreferrer">Lihat lokasi di peta</a>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
