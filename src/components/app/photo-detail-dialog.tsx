"use client";

import { Camera, ImageIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasPermission } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Revise round 9 — Photo Detail Dialog.
 *
 * A reusable dialog that shows photo evidence (pickup proof, delivery PoD,
 * checkpoint selfie, etc.) at full size. Display is gated by the
 * `proof_photo.view` permission — Admin Gudang + Owner by default.
 *
 * Other roles can OPEN the dialog (so the button is visible) but see a
 * "foto terkunci" placeholder instead of the actual image, so they know
 * a photo exists but cannot view it without the permission.
 *
 * Pass either a single `photoUrl` or an array of `{ url, label, recordedAt, recordedBy }`
 * for multi-photo views (e.g. checkpoint records).
 */
export interface PhotoDetail {
  url: string;
  label: string;
  recordedAt?: string | null;
  recordedBy?: string | null;
}

interface PhotoDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  photos: PhotoDetail[];
}

export function PhotoDetailDialog({ open, onOpenChange, title, description, photos }: PhotoDetailDialogProps) {
  const { user } = useAuth();
  const canView = hasPermission(user, "proof_photo.view");
  const hasAnyPhoto = photos.some((p) => p.url);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {!hasAnyPhoto ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-sm text-muted-foreground">
            <Camera className="h-8 w-8" />
            <p>Belum ada foto bukti untuk item ini.</p>
          </div>
        ) : !canView ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-10 text-center dark:border-amber-700 dark:bg-amber-950/40">
            <Camera className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Foto bukti tersedia — terkunci
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Hanya Admin Gudang / Owner yang dapat melihat foto bukti (proof_photo.view). Hubungi admin gudang untuk melihat foto.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {photos.map((photo, idx) => (
              <div key={idx} className="space-y-1.5">
                <a
                  href={photo.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Klik untuk membuka foto asli"
                  className="block overflow-hidden rounded-lg border bg-muted"
                >
                  <img
                    src={photo.url}
                    alt={photo.label}
                    className="max-h-72 w-full object-contain"
                  />
                </a>
                <div className="px-1 text-xs">
                  <p className="font-semibold text-foreground">{photo.label}</p>
                  {photo.recordedAt && (
                    <p className="text-muted-foreground">
                      {new Date(photo.recordedAt).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                  {photo.recordedBy && (
                    <p className="text-muted-foreground">oleh: {photo.recordedBy}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
