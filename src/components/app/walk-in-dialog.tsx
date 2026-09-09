"use client";

import { useState } from "react";
import { Store, UserCheck } from "lucide-react";
import { apiPost, type GudangWalkInItem } from "@/lib/client-api";
import { runAction } from "@/hooks/use-api-data";
import { Field, FormSelect, SubmitButton, Textarea } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Walk-in arrival dialog — a customer comes straight to the gudang counter and
 * hands the package over. Admin Gudang (or anyone with the
 * `shipment.confirm_arrival` permission) confirms "Tiba di Gudang" WITHOUT
 * scanning every package. The shipment flips to RECEIVED_AT_GUDANG and its
 * journey starts at that gudang.
 *
 * Used by:
 * - Shipment detail — "Tiba di Gudang" button beside "Submit for Pickup"
 *   (walk-in customers whose shipment was created at the counter)
 */
export function WalkInDialog({
  task,
  warehouses,
  scopedWarehouseId,
  onClose,
  onDone,
}: {
  task: GudangWalkInItem | null;
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
            <Store className="h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 truncate">Pelanggan Langsung — {task?.masterCode ?? ""}</span>
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
