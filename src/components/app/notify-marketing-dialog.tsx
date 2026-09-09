"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { apiPost } from "@/lib/client-api";
import { runAction } from "@/hooks/use-api-data";
import { Field, SubmitButton, Textarea, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Notify marketing dialog — fired from the Gudang "Isi Gudang" tab for
 * shipments held at a gudang that still have an unpaid remainder. The note is
 * written to tracking + audit so Marketing can follow up with the customer.
 * Requires the `shipment.notify_marketing` permission.
 */
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
            <Bell className="h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 truncate">Notify Marketing — {task?.masterCode ?? ""}</span>
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
