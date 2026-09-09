"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCircle2, PackageCheck, QrCode, ScanLine, Store, UserCheck, Zap } from "lucide-react";
import {
  apiGet,
  apiPost,
  type GudangArrivalQueueItem,
  type GudangWalkInItem,
  type ScanProgress,
  type ScanResponse,
} from "@/lib/client-api";
import { runAction } from "@/hooks/use-api-data";
import { ScanConsole, type ScanMethod } from "@/components/app/scan-console";
import { Field, FormSelect, SubmitButton, Textarea, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Feedback = { kind: "ok" | "warn" | "info"; text: string } | null;

/** Minimal shape the arrival scan dialog needs — buildable from a shipment row. */
export interface ArrivalScanTask {
  id: number;
  masterCode: string;
  kurirName?: string | null;
  detailsCount: number;
  originWarehouseId: number | null;
}

/** Minimal shape the walk-in dialog needs. */
export interface WalkInTask {
  id: number;
  masterCode: string;
  originWarehouseId: number | null;
}

// ---------------------------------------------------------------------------
// Arrival scan dialog — camera / reader / manual + Scan-Semua + confirm
// ---------------------------------------------------------------------------

export function ArrivalScanDialog({
  task,
  warehouses,
  scopedWarehouseId,
  onClose,
  onDone,
}: {
  task: ArrivalScanTask | null;
  warehouses: { id: number; name: string }[];
  scopedWarehouseId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [scanningAll, setScanningAll] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // default receiving gudang: own scope → shipment origin gudang → first listed
  const [warehouseId, setWarehouseId] = useState<string>(() => {
    if (scopedWarehouseId != null) return String(scopedWarehouseId);
    const origin = warehouses.find((w) => w.id === task?.originWarehouseId);
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
        setFeedback({ kind: "ok", text: "Semua paket ter-scan (mode reader) — siap konfirmasi tiba di gudang." });
      } catch {
        /* ignore */
      }
    }
    setScanningAll(false);
  }

  async function onConfirmArrival() {
    if (!task || !warehouseId) return;
    setConfirming(true);
    const ok = await runAction(
      () => apiPost(`/shipments/${task.id}/arrive`, { mode: "scan", warehouseId: Number(warehouseId), notes: notes || null }),
      { success: `Paket ${task.masterCode} diterima di gudang.` },
    );
    setConfirming(false);
    if (ok) {
      onClose();
      onDone();
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0;

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" /> Terima Paket — {task?.masterCode ?? ""}
          </DialogTitle>
          <DialogDescription>
            Scan setiap paket yang dibawa kurir {task?.kurirName ?? ""} ({task?.detailsCount ?? 0} paket). Kode tidak ditampilkan — baca dari
            label fisik paket.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">
              Paket ter-scan: {progress?.scanned ?? 0}/{progress?.total ?? "…"}
            </span>
            <span className={cn("text-xs font-semibold", progress?.allScanned ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
              {progress?.allScanned ? "SEMUA PAKET LENGKAP" : `${pct}%`}
            </span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>

        <ScanConsole onScan={onScan} busy={busy || scanningAll} placeholder="Ketik kode dari label / tembak dengan reader…" />

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
            {scanningAll ? "Memproses…" : "Scan Semua Paket (mode reader)"}
          </Button>

          {progress?.allScanned && (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Semua paket ter-scan — konfirmasi tiba di gudang.</p>
              {scopedWarehouseId == null && (
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
              <Button className="w-full" onClick={onConfirmArrival} disabled={confirming || !warehouseId}>
                <PackageCheck className="h-4 w-4" />
                {confirming ? "Memproses…" : "Konfirmasi Tiba di Gudang"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Walk-in confirm dialog (customer hands package over directly, no scanning)
// ---------------------------------------------------------------------------

export function WalkInDialog({
  task,
  warehouses,
  scopedWarehouseId,
  onClose,
  onDone,
}: {
  task: WalkInTask | null;
  warehouses: { id: number; name: string }[];
  scopedWarehouseId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState(() => {
    if (scopedWarehouseId != null) return String(scopedWarehouseId);
    const origin = warehouses.find((w) => w.id === task?.originWarehouseId);
    return String(origin?.id ?? warehouses[0]?.id ?? "");
  });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !warehouseId) return;
    setBusy(true);
    const ok = await runAction(
      () => apiPost(`/shipments/${task.id}/arrive`, { mode: "walk_in", warehouseId: Number(warehouseId), notes: notes || null }),
      { success: `Paket ${task.masterCode} dikonfirmasi tiba di gudang (walk-in).` },
    );
    setBusy(false);
    if (ok) {
      onClose();
      onDone();
    }
  }

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" /> Pelanggan Langsung — {task?.masterCode ?? ""}
          </DialogTitle>
          <DialogDescription>
            Customer menyerahkan paket langsung di gudang. Tidak perlu scan — konfirmasi langsung status Tiba di Gudang.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {scopedWarehouseId == null && (
            <Field label="Gudang Penerima" htmlFor="walk-warehouse">
              <FormSelect
                value={warehouseId}
                onValueChange={(v) => setWarehouseId(v)}
                placeholder="Pilih gudang…"
                options={warehouses.map((w) => ({ value: String(w.id), label: w.name }))}
                disabled={busy}
              />
            </Field>
          )}
          <Field label="Catatan (opsional)" htmlFor="walk-notes">
            <Textarea id="walk-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="mis. dibawa langsung oleh customer" disabled={busy} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <SubmitButton busy={busy}>
              <UserCheck className="h-4 w-4" /> Konfirmasi Tiba di Gudang
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Notify marketing dialog (unpaid shipment at gudang)
// ---------------------------------------------------------------------------

export function NotifyMarketingDialog({
  task,
  onClose,
  onDone,
}: {
  task: { id: number; masterCode: string; remaining: number } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!task) return;
    setBusy(true);
    const ok = await runAction(() => apiPost(`/shipments/${task.id}/notify-marketing`, { note: note || null }), {
      success: "Marketing diberi tahu — tercatat di tracking & audit.",
    });
    setBusy(false);
    if (ok) {
      onClose();
      onDone();
    }
  }

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" /> Notify Marketing — {task?.masterCode ?? ""}
          </DialogTitle>
          <DialogDescription>
            Sisa pembayaran {formatRupiah(task?.remaining ?? 0)}. Marketing akan follow-up apakah customer tetap ingin melanjutkan pengiriman.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Catatan untuk marketing" htmlFor="notify-note">
            <Textarea
              id="notify-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="mis. Customer bilang akan bayar minggu depan, mohon diproses."
              disabled={busy}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <SubmitButton busy={busy}>
              <Bell className="h-4 w-4" /> Kirim Notifikasi
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
