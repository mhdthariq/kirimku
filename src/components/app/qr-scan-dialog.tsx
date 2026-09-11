"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, PackageCheck, QrCode, ScanLine, TriangleAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, type PaymentSummary, type ScanProgress, type ScanResponse } from "@/lib/client-api";
import { ScanConsole, type ScanMethod } from "@/components/app/scan-console";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Input, Textarea, NumberInput, formatRupiah } from "@/components/app/form-parts";
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

/** Small badge differentiating SCANNED (camera / reader) from TYPED (manual). */
function MethodBadge({ method }: { method: string | null }) {
  if (!method) return null;
  const scanned = method === "SCANNED";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        scanned ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
      )}
      title={scanned ? "Discan via kamera / reader tool" : "Diketik manual"}
    >
      {scanned ? <ScanLine className="h-3 w-3" /> : null}
      {scanned ? "Scanned" : "Typed"}
    </span>
  );
}

/**
 * QR handover scan dialog shared by Pickups & Deliveries (kurir).
 * Revision rules:
 * - the package codes / QR images are NOT displayed anywhere — the kurir must
 *   read them from the physical labels (prevents copy-paste);
 * - scanning is done via phone CAMERA (jsQR), a hardware reader tool (fast
 *   keyboard-wedge input auto-detected), or manual typing;
 * - camera + reader are recorded as SCANNED, manual typing as TYPED — shown
 *   in Riwayat Scan below;
 * - pickup confirmation enforces the DP rule (≥ 50% paid) and lets the kurir
 *   collect & record the remaining balance on the spot.
 */
export function QrScanDialog({ open, onOpenChange, mode, task, onDone }: QrScanDialogProps) {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [balance, setBalance] = useState("");
  const [balanceMethod, setBalanceMethod] = useState("CASH");

  const basePath = mode === "pickup" ? `/pickups/${task?.id}` : `/deliveries/${task?.id}`;
  const isPickup = mode === "pickup";
  const completed = task?.status === "COMPLETED";

  // Load scan state when dialog opens
  useEffect(() => {
    if (!open || !task) return;
    setProgress(null);
    setPayment(null);
    setFeedback(null);
    setNotes("");
    setProof("");
    setBalance("");
    apiGet<{ progress: ScanProgress; paymentSummary?: PaymentSummary }>(basePath)
      .then((d) => {
        setProgress(d.progress);
        setPayment(d.paymentSummary ?? null);
        if (d.paymentSummary?.remainingAmount) setBalance(String(Math.round(d.paymentSummary.remainingAmount)));
      })
      .catch(() => setFeedback({ kind: "warn", text: "Gagal memuat daftar paket." }));
  }, [open, task, basePath]);

  const onScan = useCallback(
    async (code: string, method: ScanMethod) => {
      if (!task || busy) return;
      setBusy(true);
      try {
        const res = await apiPost<ScanResponse>(`${basePath}/scans`, { payload: code, method });
        setProgress(res.progress);
        const result = res.scan.result;
        setFeedback({
          kind: result === "unexpected" ? "warn" : result === "duplicate" ? "info" : "ok",
          text: res.message,
        });
      } catch (err) {
        setFeedback({ kind: "warn", text: err instanceof Error ? err.message : "Scan gagal." });
      } finally {
        setBusy(false);
      }
    },
    [task, busy, basePath],
  );

  const onConfirm = useCallback(async () => {
    if (!task || confirming) return;
    if (!isPickup && !proof.trim()) {
      setFeedback({ kind: "warn", text: "Isi nama penerima sebagai bukti serah terima (proof of delivery)." });
      return;
    }
    setConfirming(true);
    try {
      const balanceAmount = isPickup && balance.trim() ? Number(balance) : null;
      const body = isPickup
        ? {
            notes: notes || null,
            ...(balanceAmount != null && balanceAmount > 0
              ? { payment: { method: balanceMethod, amount: balanceAmount } }
              : {}),
          }
        : { proofOfDelivery: proof.trim(), notes: notes || null };
      const res = await apiPost<{ tracking: string }>(`${basePath}/${isPickup ? "confirm" : "complete"}`, body);
      toast.success(
        isPickup
          ? `Paket ${task.code} telah diambil (Picked Up) — tracking: ${res.tracking ?? "Picked-up"}. Pickup selesai otomatis saat paket tiba di gudang.`
          : `Delivery ${task.code} selesai — ${res.tracking ?? "Delivered"}`,
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      setFeedback({ kind: "warn", text: err instanceof Error ? err.message : "Konfirmasi gagal." });
    } finally {
      setConfirming(false);
    }
  }, [task, confirming, isPickup, proof, notes, balance, balanceMethod, basePath, onOpenChange, onDone]);

  const pct = progress && progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] gap-3 p-3 sm:max-w-lg sm:gap-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-6 text-base leading-snug sm:text-lg">
            <QrCode className="h-5 w-5 text-primary" />
            {isPickup ? `Scan Paket — Pickup ${task?.code ?? ""}` : `Scan Paket — Delivery ${task?.code ?? ""}`}
          </DialogTitle>

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

        {/* Scan console: camera / reader / manual */}
        {!completed && <ScanConsole onScan={onScan} busy={busy} placeholder="Ketik kode dari label / tembak dengan reader…" />}

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
            <span className="text-xs leading-relaxed">{feedback.text}</span>
          </div>
        )}

        {/* Package checklist — codes hidden, method badges visible (Riwayat Scan) */}
        <div className="max-h-[28dvh] space-y-1.5 overflow-y-auto rounded-lg border p-2 sm:max-h-56">
          {progress?.details.map((d, i) => (
            <div
              key={d.id}
              className={cn(
                "flex items-center gap-3 rounded-md px-2 py-1.5",
                d.scanned ? "bg-emerald-50/60 dark:bg-emerald-950/40" : "bg-card hover:bg-accent",
              )}
            >
              {d.scanned ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold text-muted-foreground">
                  {i + 1}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-xs font-semibold", d.scanned ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")}>
                  Paket {i + 1} — {d.description}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {d.scanned && d.scannedByName ? `oleh ${d.scannedByName}` : "belum discan"}
                  {d.scanned && d.scannedAt ? ` · ${new Date(d.scannedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` : ""}
                </p>
              </div>
              {d.scanned && <MethodBadge method={d.scanMethod} />}
              {d.scanned && <PackageCheck className="h-4 w-4 shrink-0 text-emerald-600/60 dark:text-emerald-400/60" />}
            </div>
          ))}
          {progress && progress.details.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">Shipment ini belum punya detail barang.</p>
          )}
          {!progress && <p className="px-2 py-4 text-center text-sm text-muted-foreground">Memuat daftar paket…</p>}
        </div>

        {/* DP rule info (pickup only) */}
        {isPickup && payment && payment.priceAmount != null && (
          <div className={cn("rounded-lg border px-3 py-2 text-xs", payment.dpOk ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/40" : "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/40")}>
            <p className="flex items-center gap-1.5 font-semibold text-foreground">
              <Wallet className="h-3.5 w-3.5" /> Harga {formatRupiah(payment.priceAmount)} · terbayar {formatRupiah(payment.paidAmount)}
            </p>
            <p className={payment.dpOk ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
              {payment.dpOk
                ? payment.remainingAmount > 0
                  ? `DP cukup — sisa ${formatRupiah(payment.remainingAmount)} bisa diambil saat pickup.`
                  : "Lunas."
                : `DP minimal 50% (${formatRupiah(payment.dpRequirement)}) belum terpenuhi — catat DP dulu sebelum pickup.`}
            </p>
          </div>
        )}

        {/* Confirm section — unlocked when all packages scanned */}
        {!completed && progress?.allScanned && (
          <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              Semua paket sudah ter-scan — siap konfirmasi {isPickup ? "pickup" : "serah terima"}.
            </p>
            {isPickup && payment && payment.remainingAmount > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="balance-amt" className="text-xs font-medium text-foreground">
                    Sisa dibayar customer (Rp)
                  </label>
                  <NumberInput
                    id="balance-amt"
                    value={balance}
                    onChange={(e) => setBalance(e.target.value)}
                    placeholder={String(Math.round(payment.remainingAmount))}
                    disabled={confirming}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="balance-method" className="text-xs font-medium text-foreground">
                    Metode
                  </label>
                  <select
                    id="balance-method"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                    value={balanceMethod}
                    onChange={(e) => setBalanceMethod(e.target.value)}
                    disabled={confirming}
                  >
                    <option value="CASH">Cash</option>
                    <option value="TRANSFER">Transfer</option>
                  </select>
                </div>
              </div>
            )}
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
              {confirming ? "Memproses…" : isPickup ? "Konfirmasi Paket Diambil (Picked Up)" : "Konfirmasi Delivered (Di Tangan Customer)"}
            </Button>
            {isPickup && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Pickup berstatus <strong>Picked Up</strong> setelah paket diambil — pickup baru menjadi <strong>Completed</strong> saat paket tiba dan diterima di gudang (dikonfirmasi Admin Gudang).
              </p>
            )}
          </div>
        )}

        {completed && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            Task ini sudah selesai {task?.completedAt ? `pada ${new Date(task.completedAt).toLocaleString("id-ID")}` : ""} — daftar di atas adalah Riwayat Scan (badge Scanned / Typed).
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
