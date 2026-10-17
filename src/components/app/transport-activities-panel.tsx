"use client";

import { useState } from "react";
import Image from "next/image";
import { apiGet, apiPost, type TransportActivityInput, type TransportActivityRow } from "@/infrastructure/http/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { ActivityCamera } from "@/components/app/activity-camera";
import { formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TransportActivitiesPanel({ transportId, canCreate, onChanged }: {
  transportId: number;
  canCreate: boolean;
  onChanged: () => void;
}) {
  const { data, loading, error, reload } = useApiData<TransportActivityRow[]>(
    () => apiGet(`/transports/${transportId}/activities`), [transportId],
  );
  const [cameraOpen, setCameraOpen] = useState(false);
  const [draft, setDraft] = useState<TransportActivityInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      <CardHeader>
        <CardTitle className="text-base">Activity Tracking (Tanpa Checkpoint)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Tambahkan beberapa foto melalui pengambilan berulang. Setiap foto menyimpan waktu dan lokasi GPS sendiri.</p>
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
            <p className="text-xs">{formatDate(draft.capturedAt, true)} · {draft.latitude}, {draft.longitude} · Akurasi {draft.locationAccuracy} m</p>
            {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
            <div className="flex gap-2">
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
            <article key={activity.id} className="space-y-2 rounded-lg border p-3">
              <Image unoptimized src={activity.photoUrl} alt={`Foto aktivitas ${activity.id}`} width={640} height={480} className="max-h-72 w-full rounded-md object-contain" />
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
