"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  apiGet,
  apiPost,
  apiPut,
  employeesByPosition,
  type Options,
  type Shipment,
  type Transport,
} from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { Field, FormSelect, SubmitButton } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface TransportForm {
  routeId: string;
  vehicleId: string;
  driverId: string;
  kenekId: string;
  origin: string;
  destination: string;
  plannedDepartureAt: string; // datetime-local
  plannedArrivalAt: string; // datetime-local
  shipmentIds: number[];
}

const EMPTY: TransportForm = {
  routeId: "", vehicleId: "", driverId: "", kenekId: "",
  origin: "", destination: "", plannedDepartureAt: "", plannedArrivalAt: "",
  shipmentIds: [],
};

/** datetime-local value (local timezone) for a Date. */
export function toLocalInput(d: Date | null | undefined): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Shared create/edit Transport dialog (used by the Transports list page AND
 * the Transport detail page).
 *
 * Validation (user requirements):
 * - Rute wajib dipilih (required)
 * - Rencana Berangkat & Rencana Tiba wajib diisi (required)
 * - Picking a Rute auto-fills Asal & Tujuan from the route — the values land
 *   in editable inputs so the user can still override them.
 */
export function TransportFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode; a transport row = edit mode (PLANNED only). */
  editing: Transport | null;
  onSaved: () => void;
}) {
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [form, setForm] = useState<TransportForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [readyShipments, setReadyShipments] = useState<Shipment[]>([]);

  // (Re)initialize the form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        routeId: editing.routeId ? String(editing.routeId) : "",
        vehicleId: String(editing.vehicleId),
        driverId: "",
        kenekId: "",
        origin: editing.origin ?? "",
        destination: editing.destination ?? "",
        plannedDepartureAt: toLocalInput(editing.plannedDepartureAt ? new Date(editing.plannedDepartureAt) : null),
        plannedArrivalAt: toLocalInput(editing.plannedArrivalAt ? new Date(editing.plannedArrivalAt) : null),
        shipmentIds: [],
      });
    } else {
      setForm(EMPTY);
      apiGet<Shipment[]>("/shipments?status=RECEIVED_AT_GUDANG")
        .then(setReadyShipments)
        .catch(() => undefined);
    }
  }, [open, editing]);

  // Position-filtered crew dropdowns: Driver select lists ONLY drivers and the
  // Kenek select ONLY keneks. Falls back to the full list only when no
  // employee has a position set.
  const driverOptions = employeesByPosition(options?.employees ?? [], "Driver").map((e) => ({ value: String(e.id), label: e.name }));
  const kenekOptions = employeesByPosition(options?.employees ?? [], "Kenek").map((e) => ({ value: String(e.id), label: e.name }));
  const routeOptions = (options?.routes ?? []).map((r) => ({ value: String(r.id), label: r.name }));
  const selectedRouteMeta = options?.routes?.find((r) => String(r.id) === form.routeId);

  function onRouteChange(v: string) {
    const route = options?.routes?.find((r) => String(r.id) === v);
    // Auto-fill Asal & Tujuan from the selected route — ALWAYS refreshed on
    // route change (the user can still edit the inputs afterwards).
    setForm((f) => ({
      ...f,
      routeId: v,
      origin: route?.origin ?? f.origin,
      destination: route?.destination ?? f.destination,
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Client-side required validation (the API enforces the same rules).
    if (!form.routeId) {
      toast.error("Rute wajib dipilih.");
      return;
    }
    if (!form.vehicleId) {
      toast.error("Kendaraan wajib dipilih.");
      return;
    }
    if (!form.plannedDepartureAt) {
      toast.error("Rencana Berangkat wajib diisi.");
      return;
    }
    if (!form.plannedArrivalAt) {
      toast.error("Rencana Tiba wajib diisi.");
      return;
    }
    if (form.plannedArrivalAt < form.plannedDepartureAt) {
      toast.error("Rencana Tiba tidak boleh lebih awal dari Rencana Berangkat.");
      return;
    }
    setBusy(true);
    const payload: Record<string, unknown> = {
      routeId: Number(form.routeId),
      vehicleId: Number(form.vehicleId),
      origin: form.origin || null,
      destination: form.destination || null,
      plannedDepartureAt: form.plannedDepartureAt ? new Date(form.plannedDepartureAt).toISOString() : null,
      plannedArrivalAt: form.plannedArrivalAt ? new Date(form.plannedArrivalAt).toISOString() : null,
    };
    if (form.driverId) payload.driverId = Number(form.driverId);
    if (form.kenekId) payload.kenekId = Number(form.kenekId);
    if (!editing && form.shipmentIds.length > 0) payload.shipmentIds = form.shipmentIds;
    const ok = await runAction(
      () => (editing ? apiPut(`/transports/${editing.id}`, payload) : apiPost("/transports", payload)),
      { success: editing ? "Transport diperbarui." : "Transport direncanakan." },
    );
    setBusy(false);
    if (ok) {
      onOpenChange(false);
      onSaved();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit Transport — ${editing.transportCode}` : "Rencanakan Transport"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Hanya transport PLANNED yang bisa diubah. Rute, Rencana Berangkat & Rencana Tiba wajib terisi."
              : "Rute, Kendaraan, Rencana Berangkat & Rencana Tiba wajib diisi. Asal & Tujuan terisi otomatis dari rute (masih bisa diubah)."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rute" htmlFor="t-route" hint="Wajib">
              <FormSelect
                value={form.routeId}
                onValueChange={onRouteChange}
                placeholder="Pilih rute"
                options={routeOptions}
                disabled={busy}
              />
            </Field>
            <Field label="Kendaraan" htmlFor="t-vehicle" hint="Wajib">
              <FormSelect
                value={form.vehicleId}
                onValueChange={(v) => setForm({ ...form, vehicleId: v })}
                placeholder="Pilih kendaraan aktif"
                options={(options?.vehicles ?? []).map((v) => ({ value: String(v.id), label: `${v.vehicleNumber}${v.name ? ` — ${v.name}` : ""}` }))}
                disabled={busy}
              />
            </Field>
            <Field label="Driver" htmlFor="t-driver">
              <FormSelect value={form.driverId} onValueChange={(v) => setForm({ ...form, driverId: v })} placeholder="Pilih driver" options={driverOptions} disabled={busy} />
            </Field>
            <Field label="Kenek (opsional)" htmlFor="t-kenek">
              <FormSelect value={form.kenekId} onValueChange={(v) => setForm({ ...form, kenekId: v })} placeholder="Pilih kenek" options={kenekOptions} disabled={busy} />
            </Field>
            <Field label="Asal (Origin)" htmlFor="t-origin" hint="Otomatis dari rute — dapat diubah">
              <input
                id="t-origin"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                value={form.origin}
                onChange={(e) => setForm({ ...form, origin: e.target.value })}
                placeholder={selectedRouteMeta?.origin ?? "mis. Medan"}
                disabled={busy}
              />
            </Field>
            <Field label="Tujuan (Destination)" htmlFor="t-destination" hint="Otomatis dari rute — dapat diubah">
              <input
                id="t-destination"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
                placeholder={selectedRouteMeta?.destination ?? "mis. Banda Aceh"}
                disabled={busy}
              />
            </Field>
            <Field label="Rencana Berangkat" htmlFor="t-planned-dep" hint="Wajib">
              <input
                id="t-planned-dep"
                type="datetime-local"
                required
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                value={form.plannedDepartureAt}
                onChange={(e) => setForm({ ...form, plannedDepartureAt: e.target.value })}
                disabled={busy}
              />
            </Field>
            <Field label="Rencana Tiba" htmlFor="t-planned-arr" hint="Wajib">
              <input
                id="t-planned-arr"
                type="datetime-local"
                required
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                value={form.plannedArrivalAt}
                onChange={(e) => setForm({ ...form, plannedArrivalAt: e.target.value })}
                disabled={busy}
              />
            </Field>
          </div>

          {!editing && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Muat shipment (status RECEIVED_AT_GUDANG)</p>
              {readyShipments.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3.5 py-3 text-sm text-muted-foreground">
                  Tidak ada shipment siap dimuat saat ini — transport tetap bisa dibuat kosong.
                </p>
              ) : (
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
                  {readyShipments.map((s) => (
                    <label key={s.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={form.shipmentIds.includes(s.id)}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            shipmentIds: e.target.checked ? [...f.shipmentIds, s.id] : f.shipmentIds.filter((id) => id !== s.id),
                          }))
                        }
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      <span className="font-mono text-xs font-semibold">{s.masterCode}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {s.customer?.name} · {s.destination}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Batal
            </Button>
            <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Rencanakan Transport"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
