"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, MapPin, PackageCheck, Phone, QrCode, ScanLine, TriangleAlert, User, X } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, type PaymentSummary, type ScanProgress, type ScanResponse } from "@/lib/client-api";
import { ScanConsole, type ScanMethod } from "@/components/app/scan-console";
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
  /** Revise round 7 — Pickup-only. Address where the kurir should go to
   *  pick up the package. Sourced from MasterShipment.pengirimAddress.
   *  Null/absent for delivery scans. */
  pickupAddress?: string | null;
  pickupContact?: string | null;
  pickupSenderName?: string | null;
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
 * - DP rule sudah dihapus. Biaya B2C ditanggung Marketing, biaya B2B ditagih
 *   via invoice. Pickup B2B wajib sudah masuk ke invoice perusahaan customer.
 *   Kurir tidak menarik pembayaran dari customer — setelah semua paket ter-scan,
 *   hanya tombol Konfirmasi yang ditampilkan (tanpa field sisa/metode/catatan).
 */
export function QrScanDialog({ open, onOpenChange, mode, task, onDone }: QrScanDialogProps) {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState("");
  // Step 5 — proof photo (bukti pickup / bukti serah terima). REQUIRED
  // before the kurir / driver can confirm. Captured via the device camera
  // ONLY (file upload is intentionally NOT supported — the photo must be
  // taken live with the camera so it's proof of the actual handover, not
  // a pre-existing image). Stored as a JPEG data URL (~720px, ~0.72
  // quality — same compression the checkpoint selfie check-in uses) and
  // POSTed to the confirm / complete endpoint as `photoUrl`. The backend
  // writes it to `Pickup.photoUrl` / `Delivery.photoUrl`.
  const [photo, setPhoto] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
    setPhoto(null);
    apiGet<{ progress: ScanProgress; paymentSummary?: PaymentSummary }>(basePath)
      .then((d) => {
        setProgress(d.progress);
        setPayment(d.paymentSummary ?? null);
      })
      .catch(() => setFeedback({ kind: "warn", text: "Gagal memuat daftar paket." }));
  }, [open, task, basePath]);

  // Step 5 — stop the camera when the dialog closes (frees the stream so
  // the camera light turns off and the next open can re-acquire cleanly).
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);
  useEffect(() => {
    if (!open) stopCamera();
    return () => stopCamera();
  }, [open, stopCamera]);

  // Step 5 — open the device camera (rear-facing preferred for shooting
  // package labels / receiver handover). Mirrors the checkpoint-checkin
  // dialog's getUserMedia pattern. Errors are surfaced inline so the user
  // knows to grant camera permission. NOTE: file upload is intentionally
  // NOT supported — the photo MUST be taken live with the camera so it's
  // proof of the actual handover, not a pre-existing image.
  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("Browser ini tidak mendukung akses kamera — gunakan perangkat dengan kamera.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setCameraError(
        name === "NotAllowedError"
          ? "Akses kamera ditolak — izinkan kamera di browser, lalu coba lagi."
          : name === "NotFoundError"
            ? "Kamera tidak ditemukan di perangkat ini."
            : "Kamera gagal dijalankan — coba lagi.",
      );
      setCameraOn(false);
    }
  }, []);

  // Step 5 — capture the current video frame, downscale to ~720px and
  // re-encode as JPEG ~0.72 quality so the data URL stays under 2.5MB
  // (the same cap the checkpoint check-in enforces server-side). Falls
  // back silently to the original dimensions when the canvas API is
  // unavailable.
  const captureFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const maxSide = 720;
    const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight) || 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", 0.72));
    stopCamera();
  }, [stopCamera]);

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
    // Step 5 — proof photo is REQUIRED for both pickup and delivery (the
    // whole point of the photo: admin / owner can later verify the package
    // was really picked up / handed over). Surface the missing-photo case
    // as a friendly inline warning instead of letting the backend reject.
    if (!photo) {
      setFeedback({ kind: "warn", text: isPickup ? "Foto bukti pickup wajib diambil sebelum konfirmasi." : "Foto bukti serah terima wajib diambil sebelum konfirmasi." });
      return;
    }
    setConfirming(true);
    try {
      // Pickup: kurir tidak menarik pembayaran — body kosong kecuali photo.
      // Delivery: tetap kirim POD (bukti serah terima) + catatan opsional +
      // foto bukti serah terima.
      const body = isPickup ? { photoUrl: photo } : { proofOfDelivery: proof.trim(), notes: notes || null, photoUrl: photo };
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
  }, [task, confirming, isPickup, proof, notes, photo, basePath, onOpenChange, onDone]);

  const pct = progress
    ? progress.isB2B
      ? progress.masterScanned
        ? 100
        : 0
      : progress.total > 0
        ? Math.round((progress.scanned / progress.total) * 100)
        : 0
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] gap-3 p-3 sm:max-w-lg sm:gap-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-6 text-base leading-snug sm:text-lg">
            <QrCode className="h-5 w-5 text-primary" />
            {isPickup ? `Scan Paket Pickup ${task?.code ?? ""}` : `Scan Paket Delivery ${task?.code ?? ""}`}
          </DialogTitle>
          {progress?.isB2B && (
            <DialogDescription className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
              <strong>Shipment B2B — cukup scan Master Resi sekali.</strong> Semua paket pada konsinyasi ini akan otomatis ter-scan setelah Master Resi terbaca.
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Revise round 7 — Pickup address panel.
            For pickups, show the address where the kurir needs to go to pick
            up the package. Sourced from MasterShipment.pengirimAddress (the
            per-shipment sender address the staff typed — NOT the customer's
            master DB record, which may differ). Helps the kurir know where
            to go and who to ask for on arrival. Hidden for deliveries. */}
        {isPickup && task?.pickupAddress && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-primary">
              <MapPin className="h-3.5 w-3.5" /> Alamat Pickup
            </p>
            <p className="mt-1 pl-5 font-medium text-foreground">{task.pickupAddress}</p>
            {(task.pickupSenderName || task.pickupContact) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-foreground/80">
                {task.pickupSenderName && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" /> {task.pickupSenderName}
                  </span>
                )}
                {task.pickupContact && (
                  <a
                    href={`tel:${task.pickupContact.replace(/[^+\d]/g, "")}`}
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    <Phone className="h-3 w-3" /> {task.pickupContact}
                  </a>
                )}
              </div>
            )}
          </div>
        )}
        {isPickup && !task?.pickupAddress && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <strong>Alamat pickup belum diisi.</strong> Hubungi admin gudang / staff untuk alamat penjemputan sebelum berangkat.
          </div>
        )}

        {/* Progress */}
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

        {/* Pickup info — kurir tidak menarik pembayaran, info box singkat. */}
        {isPickup && (
          <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs dark:border-sky-900 dark:bg-sky-950/40">
            <p className="text-sky-800 dark:text-sky-300">
              Kurir tidak menarik pembayaran biaya B2C ditanggung Marketing, B2B via invoice.
            </p>
          </div>
        )}

        {/* Confirm section — unlocked when all packages scanned.
            Pickup: hanya tombol Konfirmasi (tanpa field sisa/metode/catatan). */}
        {!completed && progress?.allScanned && (
          <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              Semua paket sudah ter-scan — siap konfirmasi {isPickup ? "pickup" : "serah terima"}.
            </p>
            {!isPickup && (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="pod-name" className="text-xs font-medium text-foreground">
                    Diterima oleh (POD) <span className="text-destructive">*</span>
                  </label>
                  <Input id="pod-name" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Nama penerima di lokasi customer" disabled={confirming} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="scan-notes" className="text-xs font-medium text-foreground">
                    Catatan (opsional)
                  </label>
                  <Textarea id="scan-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Info serah terima…" disabled={confirming} />
                </div>
              </>
            )}
            {/* Step 5 — Proof photo capture (REQUIRED before confirm).
                Same pattern as the checkpoint check-in dialog: phone
                camera (getUserMedia) only. File upload is intentionally
                NOT supported — the photo MUST be taken live with the
                camera so it's proof of the actual handover, not a
                pre-existing image. The preview thumbnail + "Ganti Foto"
                button let the user retake if the shot is blurry. */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                {isPickup ? "Foto Bukti Pickup" : "Foto Bukti Serah Terima"} <span className="text-destructive">*</span>
              </label>
              {photo ? (
                <div className="space-y-2">
                  <img src={photo} alt="Foto bukti" className="h-40 w-full rounded-lg border object-cover" />
                  <Button type="button" variant="outline" size="sm" onClick={() => setPhoto(null)} disabled={confirming}>
                    <X className="h-3.5 w-3.5" /> Ganti Foto
                  </Button>
                </div>
              ) : cameraOn ? (
                <div className="space-y-2">
                  <video ref={videoRef} playsInline muted autoPlay className="h-40 w-full rounded-lg border bg-black object-cover" />
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={captureFrame} disabled={confirming}>
                      <Camera className="h-3.5 w-3.5" /> Ambil Foto
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={stopCamera} disabled={confirming}>
                      Batal
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Button type="button" variant="outline" className="w-full" onClick={() => void startCamera()} disabled={confirming}>
                    <Camera className="h-4 w-4" /> Buka Kamera
                  </Button>
                  {cameraError && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">{cameraError}</p>
                  )}
                </div>
              )}
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
