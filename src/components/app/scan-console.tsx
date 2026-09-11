"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, CameraOff, Keyboard, ScanLine, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/app/form-parts";
import { cn } from "@/lib/utils";

export type ScanMethod = "SCANNED" | "TYPED";

interface ScanConsoleProps {
  /** Called with the decoded/typed code and how it was captured. */
  onScan: (code: string, method: ScanMethod) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  busy?: boolean;
}

/**
 * Shared scan console used by kurir (pickup / delivery) and Admin Gudang
 * (arrival scanning):
 * - 📷 Camera scanning via getUserMedia + jsQR (works on phone & desktop
 *   browsers in secure contexts) → method SCANNED
 * - 🖲️ Hardware reader tools (USB / bluetooth barcode guns) act as fast
 *   keyboards — rapid keystrokes + Enter are auto-detected → SCANNED
 * - ⌨️ Manual typing → TYPED (shown as "Diketik" in Riwayat Scan)
 * Codes are never displayed anywhere in this console (anti copy-paste) and
 * paste into the scan field is blocked.
 */
export function ScanConsole({ onScan, disabled, placeholder = "Arahkan QR ke kamera / scan dengan reader…", busy }: ScanConsoleProps) {
  const [value, setValue] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<{ method: ScanMethod; at: number } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDecodeRef = useRef<number>(0);
  // keystroke timing — hardware readers emit the whole code in <100 ms
  const firstKeyAtRef = useRef<number | null>(null);
  const keyCountRef = useRef(0);
  const disabledRef = useRef(disabled || busy);
  disabledRef.current = disabled || busy;

  const stopCamera = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const submit = useCallback(
    async (code: string, method: ScanMethod) => {
      if (!code.trim() || disabledRef.current) return;
      setLastCapture({ method, at: Date.now() });
      setValue("");
      firstKeyAtRef.current = null;
      keyCountRef.current = 0;
      await onScan(code.trim(), method);
      inputRef.current?.focus();
    },
    [onScan],
  );

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("Browser ini tidak mendukung akses kamera — gunakan reader tool atau ketik kode manual.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      // Reveal the <video> element first (it isn't mounted yet — it only
      // renders once cameraOn is true) — the effect below attaches the
      // stream once the element actually exists in the DOM. Attaching
      // synchronously here would silently no-op because videoRef.current
      // is still null on this render pass, which was the root cause of
      // "camera doesn't work" (permission granted, no preview, no scans).
      setCameraOn(true);
      // decode loop
      timerRef.current = setInterval(() => {
        const v = videoRef.current;
        const canvas = canvasRef.current;
        if (!v || !canvas || v.readyState !== v.HAVE_ENOUGH_DATA || !v.videoWidth) return;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if (found?.data && Date.now() - lastDecodeRef.current > 700) {
          lastDecodeRef.current = Date.now();
          void submit(found.data, "SCANNED");
        }
      }, 180);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setCameraError(
        name === "NotAllowedError"
          ? "Akses kamera ditolak — izinkan kamera di browser, atau gunakan reader tool / ketik manual."
          : name === "NotFoundError"
            ? "Kamera tidak ditemukan di perangkat ini."
            : "Kamera gagal dijalakan — gunakan reader tool atau ketik kode manual.",
      );
      setCameraOn(false);
    }
  }, [submit]);

  // Attach the live stream to the <video> element once it's actually
  // mounted (it only renders while cameraOn is true). Doing this in an
  // effect — rather than right after getUserMedia resolves — guarantees
  // videoRef.current is populated, since effects run after React commits
  // the DOM for the render that turned cameraOn on.
  useEffect(() => {
    if (!cameraOn) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    const playPromise = video.play();
    if (playPromise) playPromise.catch(() => undefined);
  }, [cameraOn]);

  // cleanup on unmount
  useEffect(() => () => stopCamera(), [stopCamera]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const code = value.trim();
      if (!code) return;
      const startedAt = firstKeyAtRef.current;
      const typingDuration = startedAt != null ? Date.now() - startedAt : Infinity;
      const looksLikeReader = code.length >= 4 && typingDuration < 300; // hardware guns type <100ms
      void submit(code, looksLikeReader ? "SCANNED" : "TYPED");
      return;
    }
    if (e.key.length === 1) {
      if (firstKeyAtRef.current == null) {
        firstKeyAtRef.current = Date.now();
        keyCountRef.current = 0;
      }
      keyCountRef.current += 1;
    }
  }

  const flash = lastCapture && Date.now() - lastCapture.at < 1500;

  return (
    <div className="space-y-3">
      {/* Camera */}
      <div className="space-y-2">
        {cameraOn ? (
          <div className="relative overflow-hidden rounded-xl border bg-black">
            <video ref={videoRef} className="h-44 w-full object-cover sm:h-56" playsInline muted autoPlay aria-label="Pratinjau kamera scan" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className={cn("h-32 w-32 rounded-xl border-2 transition-colors", flash ? "border-emerald-400" : "border-white/70")}>
                <div className={cn("m-[46px] h-9 w-9 rounded-lg transition-colors", flash ? "bg-emerald-400/80" : "bg-white/30")} />
              </div>
            </div>
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium text-white">
              <span className={cn("h-1.5 w-1.5 rounded-full", flash ? "bg-emerald-400" : "bg-white/60 animate-pulse")} />
              {flash ? "KODE TERBACA" : "MENCARI QR…"}
            </div>
            <Button type="button" variant="secondary" size="sm" className="absolute right-2 top-2 h-7" onClick={stopCamera}>
              <CameraOff className="h-3.5 w-3.5" /> Matikan
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => void startCamera()} disabled={disabled || busy}>
            <Camera className="h-4 w-4" /> Scan dengan Kamera HP
          </Button>
        )}
        {cameraError && <p className="text-xs text-amber-600 dark:text-amber-400">{cameraError}</p>}
        <canvas ref={canvasRef} className="hidden" aria-hidden />
      </div>

      {/* Manual input / reader wedge */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const code = value.trim();
          if (!code) return;
          const startedAt = firstKeyAtRef.current;
          const typingDuration = startedAt != null ? Date.now() - startedAt : Infinity;
          void submit(code, code.length >= 4 && typingDuration < 300 ? "SCANNED" : "TYPED");
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <div className="relative flex-1">
          <ScanLine className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={(e) => e.preventDefault()} // anti copy-paste: must read from physical label
            placeholder={placeholder}
            className="min-h-11 pl-8 font-mono tracking-wider"
            disabled={disabled || busy}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
          />
        </div>
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={disabled || busy || !value.trim()}>
          <Keyboard className="h-4 w-4" />
          <span className="hidden sm:inline">Kirim</span>
        </Button>
      </form>

      <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
        Kamera &amp; reader tool tercatat <span className="font-semibold text-foreground">Scanned</span> · ketik manual tercatat{" "}
        <span className="font-semibold text-foreground">Typed</span> di Riwayat Scan. Kode tidak ditampilkan supaya tidak bisa di-copy paste.
      </p>
    </div>
  );
}
