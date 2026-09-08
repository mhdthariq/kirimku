"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Pencil, Plus, Truck, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Transport, type Options, type Shipment } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, FormSelect, SubmitButton, Textarea, formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TransportForm {
  routeId: string;
  vehicleId: string;
  driverId: string;
  kenekId: string;
  shipmentIds: number[];
  notes: string;
}

const EMPTY: TransportForm = { routeId: "", vehicleId: "", driverId: "", kenekId: "", shipmentIds: [], notes: "" };

export function TransportsPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "transport.view"),
    create: hasPermission(user, "transport.create"),
    depart: hasPermission(user, "transport.depart"),
    arrive: hasPermission(user, "transport.arrive"),
  };

  const { data, loading, reload } = useApiData<Transport[]>(() => apiGet<Transport[]>("/transports"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [readyShipments, setReadyShipments] = useState<Shipment[]>([]);

  useEffect(() => {
    if (!can.create) return;
    apiGet<Shipment[]>("/shipments?status=RECEIVED_AT_GUDANG")
      .then(setReadyShipments)
      .catch(() => undefined);
  }, [can.create, data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transport | null>(null);
  const [form, setForm] = useState<TransportForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Transport | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (t) =>
        (statusFilter === "all" || t.status === statusFilter) &&
        (!q ||
          t.transportCode.toLowerCase().includes(q) ||
          (t.routeName ?? "").toLowerCase().includes(q) ||
          t.vehicleNumber.toLowerCase().includes(q)),
    );
  }, [data, search, statusFilter]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(t: Transport) {
    setEditing(t);
    setForm({
      routeId: t.routeId ? String(t.routeId) : "",
      vehicleId: String(t.vehicleId),
      driverId: "",
      kenekId: "",
      shipmentIds: [],
      notes: "",
    });
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload: Record<string, unknown> = {
      routeId: Number(form.routeId),
      vehicleId: Number(form.vehicleId),
    };
    if (form.driverId) payload.driverId = Number(form.driverId);
    if (form.kenekId) payload.kenekId = Number(form.kenekId);
    if (!editing && form.shipmentIds.length > 0) payload.shipmentIds = form.shipmentIds;
    const ok = await runAction(
      () => (editing ? apiPut(`/transports/${editing.id}`, payload) : apiPost("/transports", payload)),
      { success: editing ? "Transport diperbarui." : "Transport dibuat." },
    );
    setBusy(false);
    if (ok) {
      setDialogOpen(false);
      reload();
    }
  }

  async function onDepart(t: Transport) {
    const ok = await runAction(() => apiPost(`/transports/${t.id}/depart`), { success: `${t.transportCode} berangkat.` });
    if (ok) reload();
  }

  async function onArrive(t: Transport) {
    const ok = await runAction(() => apiPost(`/transports/${t.id}/arrive`), { success: `${t.transportCode} tiba di tujuan.` });
    if (ok) reload();
  }

  async function onDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    const ok = await runAction(() => apiDelete(`/transports/${target.id}`), { success: "Transport dihapus." });
    if (ok) reload();
  }

  if (!can.view) {
    return <PageHeader title="Transports" subtitle="Anda tidak memiliki izin melihat transport." />;
  }

  const employeeOptions = (options?.employees ?? []).map((e) => ({ value: String(e.id), label: `${e.name}${e.position ? ` — ${e.position}` : ""}` }));
  const routeOptions = (options?.routes ?? []).map((r) => ({ value: String(r.id), label: r.name }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transports"
        subtitle="Perjalanan linehaul antar gudang mengikuti rute checkpoint."
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Buat Transport
            </Button>
          )
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Daftar</TabsTrigger>
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-3">
          <DataTable
            rows={rows}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Cari kode / rute / nopol…"
            toolbar={
              <div className="flex items-center gap-1.5">
                {["all", "PLANNED", "DEPARTED", "ARRIVED"].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={statusFilter === s ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === "all" ? "Semua" : s}
                  </Button>
                ))}
              </div>
            }
            emptyMessage="Belum ada transport. Klik “Buat Transport” untuk menjadwalkan linehaul."
            columns={[
              {
                key: "code",
                header: "Kode",
                primary: true,
                render: (t) => (
                  <div>
                    <p className="font-mono text-xs font-semibold text-foreground">{t.transportCode}</p>
                    <p className="text-xs text-muted-foreground">{t.vehicleNumber}</p>
                  </div>
                ),
              },
              {
                key: "route",
                header: "Rute",
                render: (t) => (
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.routeName ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground">{t.shipments.length} shipment</p>
                  </div>
                ),
              },
              {
                key: "crew",
                header: "Kru",
                hideOnMobile: true,
                render: (t) => (
                  <span className="text-sm text-muted-foreground">
                    {t.driverName ?? "—"}{t.kenekName ? ` · ${t.kenekName}` : ""}
                  </span>
                ),
              },
              { key: "departedAt", header: "Depart", hideOnMobile: true, render: (t) => formatDate(t.departedAt, true) },
              { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status} /> },
              {
                key: "actions",
                header: "Aksi",
                render: (t) => (
                  <div className="flex flex-wrap gap-1.5">
                    {t.status === "PLANNED" && can.depart && (
                      <Button size="sm" className="h-7" onClick={() => onDepart(t)}>
                        <Truck className="h-3.5 w-3.5" /> Depart
                      </Button>
                    )}
                    {t.status === "DEPARTED" && can.arrive && (
                      <Button size="sm" variant="secondary" className="h-7" onClick={() => onArrive(t)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Arrive
                      </Button>
                    )}
                    {t.status === "PLANNED" && can.create && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)} aria-label={`Edit ${t.transportCode}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(t)} aria-label={`Hapus ${t.transportCode}`}>
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["transport"]} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Transport — ${editing.transportCode}` : "Buat Transport"}</DialogTitle>
            <DialogDescription>
              {editing ? "Hanya transport PLANNED yang bisa diubah." : "Pilih rute (wajib ≥ 3 checkpoint), kendaraan, kru, dan shipment yang dimuat."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rute" htmlFor="t-route">
                <FormSelect value={form.routeId} onValueChange={(v) => setForm({ ...form, routeId: v })} placeholder="Pilih rute" options={routeOptions} disabled={busy} />
              </Field>
              <Field label="Kendaraan" htmlFor="t-vehicle">
                <FormSelect
                  value={form.vehicleId}
                  onValueChange={(v) => setForm({ ...form, vehicleId: v })}
                  placeholder="Pilih kendaraan aktif"
                  options={(options?.vehicles ?? []).map((v) => ({ value: String(v.id), label: `${v.vehicleNumber}${v.name ? ` — ${v.name}` : ""}` }))}
                  disabled={busy}
                />
              </Field>
              <Field label="Driver" htmlFor="t-driver">
                <FormSelect value={form.driverId} onValueChange={(v) => setForm({ ...form, driverId: v })} placeholder="Pilih driver" options={employeeOptions} disabled={busy} />
              </Field>
              <Field label="Kenek" htmlFor="t-kenek">
                <FormSelect value={form.kenekId} onValueChange={(v) => setForm({ ...form, kenekId: v })} placeholder="Pilih kenek" options={employeeOptions} disabled={busy} />
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
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Buat Transport"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus transport {confirmDelete?.transportCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Hanya transport berstatus PLANNED yang bisa dihapus. Shipment yang belum berangkat akan dikembalikan ke status RECEIVED_AT_GUDANG.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
