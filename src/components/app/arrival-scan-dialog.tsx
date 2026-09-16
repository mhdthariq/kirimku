"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, PackageCheck, QrCode, Warehouse, Zap } from "lucide-react";
import {
  apiGet,
  apiPost,
  type GudangArrivalQueueItem,
  type GudangTransportArrivalItem,
  type ScanProgress,
  type ScanResponse,
} from "@/lib/client-api";
import { runAction } from "@/hooks/use-api-data";
import { ScanConsole, type ScanMethod } from "@/components/app/scan-console";
import { Field, FormSelect, Textarea } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Feedback = { kind: "ok" | "warn" | "info"; text: string } | null;

/** Either arrival queue shape — the dialog adapts to the arrival mode. */
type ArrivalTask = GudangArrivalQueueItem | GudangTransportArrivalItem;

/**
 * Arrival scan dialog — Admin Gudang (or anyone with `shipment.confirm_arrival`)
 * scans every package of an arriving shipment (camera / reader tool / manual —
 * codes hidden, anti copy-paste) and, once all packages are accounted for,
 * confirms receipt:
 *
 * - mode "kurir":     shipment PICKED_UP — the kurir brings the packages back
 *                     to the ORIGIN gudang. Confirming flips the shipment to
 *                     RECEIVED_AT_GUDANG.
 * - mode "transport": shipment AT_DEST_GUDANG — the transport driver checked
 *                     in at the LAST checkpoint (packages from ANOTHER gudang
 *                     at this destination gudang). Confirming stamps
 *                     destReceivedAt AND flips the shipment to ARRIVED_AT_GUDANG
 *                     ("Arrived at {Gudang}") so it can be assigned for
 *                     delivery.
 *
 * Shared by:
 * - Gudang → Kedatangan tab (per-row "Terima / Scan" button)
 * - Shipments → "Scan Kedatangan" quick-access button beside "Buat Shipment"
 */
export function ArrivalScanDialog({
  task,
  mode = "kurir",
  warehouses,
  scopedWarehouseId,
  onClose,
  onDone,
}: {
  task: ArrivalTask | null;
  /** "kurir" = kurir drop-off at the origin gudang; "transport" = driver drop-off at the destination gudang */
  mode?: "kurir" | "transport";
  warehouses: { id: number; name: string }[];
  scopedWarehouseId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const isTransport = mode === "transport";
  // normalize the union for convenient field access
  const t = task as (GudangArrivalQueueItem & Partial<GudangTransportArrivalItem>) | null;
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [scanningAll, setScanningAll] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // default receiving gudang: own scope → shipment origin gudang → first listed
  const [warehouseId, setWarehouseId] = useState<string>(() => {
    if (scopedWarehouseId != null) return String(scopedWarehouseId);
    const origin = warehouses.find((w) => w.id === t?.originWarehouseId);
    return String(origin?.id ?? warehouses[0]?.id ?? "");
  });
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!task) return;
    apiGet<{ progress: ScanProgress }>(`/shipments/${task.id}/arrival-scans`)
      .then((d) => setProgress(d.progress))
      .catch(() => setFeedback({ kind: "warn", text: "Gagal memuat progres scan." }));
  }, [task]);

  const onScan = useCallback(
    async (code: string, method: ScanMethod) => {
      if (!task || busy) return;
      setBusy(true);
      try {
        const res = await apiPost<ScanResponse>(`/shipments/${task.id}/arrival-scans`, { payload: code, method });
        setProgress(res.progress);
        setFeedback({
          kind: res.scan.result === "unexpected" ? "warn" : res.scan.result === "duplicate" ? "info" : "ok",
          text: res.message,
        });
      } catch (err) {
        setFeedback({ kind: "warn", text: err instanceof Error ? err.message : "Scan gagal." });
      } finally {
        setBusy(false);
      }
    },
    [task, busy],
  );

  async function onScanAll() {
    if (!task) return;
    setScanningAll(true);
    const ok = await runAction(() => apiPost<{ message: string }>(`/shipments/${task.id}/arrival-scan-all`), {
      success: "Semua paket ditandai ter-scan.",
    });
    if (ok) {
      try {
        const d = await apiGet<{ progress: ScanProgress }>(`/shipments/${task.id}/arrival-scans`);
        setProgress(d.progress);
        setFeedback({
          kind: "ok",
          text: isTransport
            ? "Semua paket ter-scan (mode reader) — siap konfirmasi penerimaan dari transport."
            : "Semua paket ter-scan (mode reader) — siap konfirmasi tiba di gudang.",
        });
      } catch {
        /* ignore */
      }
    }
    setScanningAll(false);
  }

  async function onConfirmArrival() {
    if (!task) return;
    if (!isTransport && !warehouseId) return;
    setConfirming(true);
    const ok = await runAction(
      () =>
        apiPost(`/shipments/${task.id}/arrive`, {
          mode: isTransport ? "transport" : "scan",
          ...(isTransport ? {} : { warehouseId: Number(warehouseId) }),
          notes: notes || null,
        }),
      {
        success: isTransport
          ? `Paket ${task.masterCode} diterima dari transport & terverifikasi scan.`
          : `Paket ${task.masterCode} diterima di gudang.`,
      },
    );
    setConfirming(false);
    if (ok) {
      onClose();
      onDone();
    }
  }

  const pct = progress
    ? progress.isB2B
      ? progress.masterScanned
        ? 100
        : 0
      : progress.total > 0
        ? Math.round((progress.scanned / progress.total) * 100)
        : 0
    : 0;

  const whoLabel = isTransport
    ? [t?.driverName, t?.kenekName].filter(Boolean).join(" & ") || "driver transport"
    : t?.kurirName ?? "";

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            {isTransport ? "Terima Paket dari Transport" : "Terima Paket"} — {t?.masterCode ?? ""}
          </DialogTitle>
          <DialogDescription>
            {isTransport ? (
              <>
                Scan setiap paket yang dibawa <b>{whoLabel}</b> dari <b>{t?.originWarehouseName ?? t?.origin ?? "gudang asal"}</b> (
                {t?.detailsCount ?? 0} paket). Kode tidak ditampilkan — baca dari label fisik paket.
              </>
            ) : (
              <>
                Scan setiap paket yang dibawa kurir {t?.kurirName ?? ""} ({t?.detailsCount ?? 0} paket). Kode tidak ditampilkan — baca dari
                label fisik paket.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {isTransport && (
          <div className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
            <Warehouse className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>
                Shipment ini <b>dari {t?.originWarehouseName ?? t?.origin ?? "gudang lain"}</b>
                {t?.transportCode ? (
                  <>
                    {" "}
                    via transport <span className="font-mono font-semibold">{t.transportCode}</span>
                  </>
                ) : null}
                . Scan semua paket untuk menerimanya di gudang Anda — setelah diterima, shipment bisa ditugaskan ke kurir untuk
                dikirim ke penerima.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">
              {progress?.isB2B
                ? progress.masterScanned
                  ? "Master Resi ter-scan — semua paket lengkap"
                  : "Menunggu scan Master Resi"
                : `Paket ter-scan: ${progress?.scanned ?? 0}/${progress?.total ?? "…"}`}
            </span>
            <span className={cn("text-xs font-semibold", progress?.allScanned ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
              {progress?.allScanned ? "SEMUA PAKET LENGKAP" : `${pct}%`}
            </span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>

        {progress?.isB2B && !progress?.masterScanned && (
          <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
            <strong>Shipment B2B — cukup scan Master Resi sekali.</strong> Tidak perlu scan tiap paket. Gunakan kamera / reader untuk membaca Master Resi, atau klik <strong>Scan Master Resi</strong> di bawah.
          </div>
        )}

        <ScanConsole onScan={onScan} busy={busy || scanningAll} placeholder={progress?.isB2B ? "Arahkan QR Master Resi ke kamera / tembak dengan reader…" : "Ketik kode dari label / tembak dengan reader…"} />

        {feedback && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
              feedback.kind === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
              feedback.kind === "warn" && "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
              feedback.kind === "info" && "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
            )}
          >
            {feedback.kind === "warn" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Zap className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="text-xs leading-relaxed">{feedback.text}</span>
          </div>
        )}

        {/* Package checklist — codes hidden, methods visible */}
        <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border p-2">
          {progress?.details.map((d, i) => (
            <div
              key={d.id}
              className={cn("flex items-center gap-3 rounded-md px-2 py-1.5", d.scanned ? "bg-emerald-50/60 dark:bg-emerald-950/40" : "bg-card hover:bg-accent")}
            >
              {d.scanned ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold text-muted-foreground">{i + 1}</div>
              )}
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-xs font-semibold", d.scanned ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")}>
                  Paket {i + 1} — {d.description}
                </p>
                {d.scanned && d.scannedByName && <p className="truncate text-[11px] text-muted-foreground">oleh {d.scannedByName}</p>}
              </div>
              {d.scanned && (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    d.scanMethod === "SCANNED" ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
                  )}
                >
                  {d.scanMethod === "SCANNED" ? "Scanned" : "Typed"}
                </span>
              )}
              {d.scanned && <PackageCheck className="h-4 w-4 shrink-0 text-emerald-600/60 dark:text-emerald-400/60" />}
            </div>
          ))}
          {!progress && <p className="px-2 py-4 text-center text-sm text-muted-foreground">Memuat daftar paket…</p>}
        </div>

        {/* Scan all + confirm */}
        <div className="space-y-3">
          <Button type="button" variant="secondary" className="w-full" onClick={onScanAll} disabled={scanningAll || busy || !!progress?.allScanned}>
            <Zap className="h-4 w-4" />
            {scanningAll
              ? "Memproses…"
              : progress?.isB2B
                ? progress?.masterScanned
                  ? "Master Resi Sudah Ter-scan"
                  : "Scan Master Resi (mode reader)"
                : "Scan Semua Paket (mode reader)"}
          </Button>

          {progress?.allScanned && (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {isTransport ? "Semua paket ter-scan — konfirmasi penerimaan dari transport." : "Semua paket ter-scan — konfirmasi tiba di gudang."}
              </p>
              {!isTransport && scopedWarehouseId == null && (
                <Field label="Gudang Penerima" htmlFor="arr-warehouse">
                  <FormSelect
                    value={warehouseId}
                    onValueChange={(v) => setWarehouseId(v)}
                    placeholder="Pilih gudang…"
                    options={warehouses.map((w) => ({ value: String(w.id), label: w.name }))}
                    disabled={confirming}
                  />
                </Field>
              )}
              <Field label="Catatan (opsional)" htmlFor="arr-notes">
                <Textarea id="arr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Kondisi paket, info tambahan…" disabled={confirming} />
              </Field>
              <Button className="w-full" onClick={onConfirmArrival} disabled={confirming || (!isTransport && !warehouseId)}>
                <PackageCheck className="h-4 w-4" />
                {confirming
                  ? "Memproses…"
                  : isTransport
                    ? "Konfirmasi Terima dari Transport"
                    : "Konfirmasi Tiba di Gudang"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
