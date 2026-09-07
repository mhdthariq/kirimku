"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { CheckCircle2, PackageCheck, QrCode, ScanLine, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, type ScanProgress, type ScanResponse } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Input, Textarea } from "@/components/app/form-parts";
import { cn } from "@/lib/utils";

export interface ScanTaskInfo {
  id: number;
  code: string; // pickupCode / deliveryCode
  masterCode: string;
  customerName: string;
  route: string; // "origin → destination" or destination
  status: string;
  completedAt?: string | null;
}

interface QrScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "pickup" | "delivery";
  task: ScanTaskInfo | null;
  onDone: () => void; // called after successful confirm/complete
}

type Feedback = { kind: "ok" | "warn" | "info"; text: string } | null;

/**
 * QR handover scan dialog shared by Pickups & Deliveries.
 * Kurir scans every package QR (detailCode). Each match is marked scanned;
 * when all packages are scanned the confirm action unlocks. USB/phone QR
 * readers act as keyboards — the input is focused and Enter submits.
 * A rendered QR per package is shown so the flow can be exercised with a
 * phone camera during demos.
 */
export function QrScanDialog({ open, onOpenChange, mode, task, onDone }: QrScanDialogProps) {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [payload, setPayload] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [qrImages, setQrImages] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const basePath = mode === "pickup" ? `/pickups/${task?.id}` : `/deliveries/${task?.id}`;
  const isPickup = mode === "pickup";
  const completed = task?.status === "COMPLETED";

  // Load scan state when dialog opens
  useEffect(() => {
    if (!open || !task) return;
    setProgress(null);
    setPayload("");
    setFeedback(null);
    setNotes("");
    setProof("");
    apiGet<{ progress: ScanProgress }>(basePath)
      .then((d) => setProgress(d.progress))
      .catch(() => setFeedback({ kind: "warn", text: "Gagal memuat daftar paket." }));
  }, [open, task, basePath]);

  // Render a small QR per unscanned detail so demos can use a phone camera
  useEffect(() => {
    if (!progress) return;
    const pending = progress.details.filter((d) => !d.scanned);
    if (pending.length === 0) {
      setQrImages({});
      return;
    }
    let cancelled = false;
    Promise.all(
      pending.map(async (d) => {
        const url = await QRCode.toDataURL(d.detailCode, { margin: 1, width: 96, color: { dark: "#0f172a", light: "#ffffff" } });
        return [d.id, url] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) setQrImages(Object.fromEntries(entries));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [progress]);

  const onScan = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const value = payload.trim();
      if (!value || !task || busy) return;
      setBusy(true);
      try {
        const res = await apiPost<ScanResponse>(`${basePath}/scans`, { payload: value });
        setProgress(res.progress);
        const result = res.scan.result;
        setFeedback({
          kind: result === "unexpected" ? "warn" : result === "duplicate" ? "info" : "ok",
          text: res.message,
        });
        setPayload("");
        inputRef.current?.focus();
      } catch (err) {
        setFeedback({ kind: "warn", text: err instanceof Error ? err.message : "Scan gagal." });
      } finally {
        setBusy(false);
      }
    },
    [payload, task, busy, basePath],
  );

  const onConfirm = useCallback(async () => {
    if (!task || confirming) return;
    if (!isPickup && !proof.trim()) {
      setFeedback({ kind: "warn", text: "Isi nama penerima sebagai bukti serah terima (proof of delivery)." });
      return;
    }
    setConfirming(true);
    try {
      const body = isPickup ? { notes: notes || null } : { proofOfDelivery: proof.trim(), notes: notes || null };
      const res = await apiPost<{ tracking: string }>(`${basePath}/${isPickup ? "confirm" : "complete"}`, body);
      toast.success(
        isPickup
          ? `Pickup ${task.code} selesai — tracking: ${res.tracking ?? "Picked-up"}`
          : `Delivery ${task.code} selesai — ${res.tracking ?? "Delivered"}`,
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      setFeedback({ kind: "warn", text: err instanceof Error ? err.message : "Konfirmasi gagal." });
    } finally {
      setConfirming(false);
    }
  }, [task, confirming, isPickup, proof, notes, basePath, onOpenChange, onDone]);

  const pct = progress && progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            {isPickup ? `Scan QR — Pickup ${task?.code ?? ""}` : `Scan QR — Delivery ${task?.code ?? ""}`}
          </DialogTitle>
          <DialogDescription>
            {isPickup
              ? `Scan QR setiap paket dari ${task?.customerName ?? ""} (${task?.masterCode ?? ""}). Setelah semua paket ter-scan, konfirmasi pickup.`
              : `Scan QR setiap paket untuk ${task?.customerName ?? ""} (${task?.masterCode ?? ""}). Setelah semua ter-scan, konfirmasi serah terima.`}
          </DialogDescription>
        </DialogHeader>

        {/* Progress */}
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

        {/* Scan input */}
        {!completed && (
          <form onSubmit={onScan} className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                autoFocus
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder="Tempel/scan QR code di sini…"
                className="pl-8 font-mono"
                disabled={busy || progress?.allScanned}
              />
            </div>
            <Button type="submit" disabled={busy || !payload.trim() || progress?.allScanned}>
              Scan
            </Button>
          </form>
        )}

        {/* Feedback */}
        {feedback && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
              feedback.kind === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
              feedback.kind === "warn" && "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
              feedback.kind === "info" && "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
            )}
          >
            {feedback.kind === "warn" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="font-mono text-xs leading-relaxed">{feedback.text}</span>
          </div>
        )}

        {/* Package checklist with QR */}
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border p-2">
          {progress?.details.map((d) => (
            <div
              key={d.id}
              className={cn(
                "flex items-center gap-3 rounded-md px-2 py-1.5",
                d.scanned ? "bg-emerald-50/60 dark:bg-emerald-950/40" : "bg-card hover:bg-accent",
              )}
            >
              {d.scanned ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : qrImages[d.id] ? (
                <img src={qrImages[d.id]} alt={`QR ${d.detailCode}`} className="h-10 w-10 shrink-0 rounded bg-white p-0.5" />
              ) : (
                <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className={cn("truncate font-mono text-xs font-semibold", d.scanned ? "text-emerald-700 line-through dark:text-emerald-400" : "text-foreground")}>
                  {d.detailCode}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {d.description} · qty {d.quantity}
                  {d.scanned && d.scannedByName ? ` · oleh ${d.scannedByName}` : ""}
                </p>
              </div>
              {d.scanned && <PackageCheck className="h-4 w-4 shrink-0 text-emerald-600/60 dark:text-emerald-400/60" />}
            </div>
          ))}
          {progress && progress.details.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">Shipment ini belum punya detail barang.</p>
          )}
          {!progress && <p className="px-2 py-4 text-center text-sm text-muted-foreground">Memuat daftar paket…</p>}
        </div>

        {/* Confirm section — unlocked when all packages scanned */}
        {!completed && progress?.allScanned && (
          <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              Semua paket sudah ter-scan — siap konfirmasi {isPickup ? "pickup" : "serah terima"}.
            </p>
            {!isPickup && (
              <div className="space-y-1.5">
                <label htmlFor="pod-name" className="text-xs font-medium text-foreground">
                  Diterima oleh (POD) <span className="text-destructive">*</span>
                </label>
                <Input id="pod-name" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Nama penerima di lokasi customer" disabled={confirming} />
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="scan-notes" className="text-xs font-medium text-foreground">
                Catatan (opsional)
              </label>
              <Textarea id="scan-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={isPickup ? "Kondisi kiriman, info tambahan…" : "Info serah terima…"} disabled={confirming} />
            </div>
            <Button className="w-full" onClick={onConfirm} disabled={confirming}>
              <CheckCircle2 className="h-4 w-4" />
              {confirming ? "Memproses…" : isPickup ? "Konfirmasi Pickup Selesai" : "Konfirmasi Delivered (Di Tangan Customer)"}
            </Button>
          </div>
        )}

        {completed && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            Task ini sudah selesai {task?.completedAt ? `pada ${new Date(task.completedAt).toLocaleString("id-ID")}` : ""} — daftar di atas menunjukkan riwayat scan.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
