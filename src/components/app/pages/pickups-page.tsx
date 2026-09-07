"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Pencil, Plus, Truck, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type PickupTask, type Options, type Shipment } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, FormSelect, SubmitButton, Textarea, formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PickupForm {
  masterId: string;
  kurirId: string;
  notes: string;
}

const EMPTY: PickupForm = { masterId: "", kurirId: "", notes: "" };

export function PickupsPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "pickup.view"),
    create: hasPermission(user, "pickup.create"),
    assign: hasPermission(user, "pickup.assign_kurir"),
    confirm: hasPermission(user, "pickup.confirm"),
  };

  const { data, loading, reload } = useApiData<PickupTask[]>(() => apiGet<PickupTask[]>("/pickups"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [readyShipments, setReadyShipments] = useState<Shipment[]>([]);

  useEffect(() => {
    if (!can.create) return;
    apiGet<Shipment[]>("/shipments?status=READY_FOR_PICKUP")
      .then(setReadyShipments)
      .catch(() => undefined);
  }, [can.create, data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PickupTask | null>(null);
  const [form, setForm] = useState<PickupForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PickupTask | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (p) =>
        (statusFilter === "all" || p.status === statusFilter) &&
        (!q ||
          p.pickupCode.toLowerCase().includes(q) ||
          p.masterCode.toLowerCase().includes(q) ||
          p.customerName.toLowerCase().includes(q)),
    );
  }, [data, search, statusFilter]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(p: PickupTask) {
    setEditing(p);
    setForm({ masterId: String(p.id), kurirId: p.kurirId ? String(p.kurirId) : "", notes: p.notes ?? "" });
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await runAction(
      () =>
        editing
          ? apiPut(`/pickups/${editing.id}`, { kurirId: form.kurirId ? Number(form.kurirId) : undefined, notes: form.notes || null })
          : apiPost("/pickups", { masterId: Number(form.masterId), kurirId: Number(form.kurirId), notes: form.notes || null }),
      { success: editing ? "Pickup diperbarui." : "Pickup dibuat & kurir ditugaskan." },
    );
    setBusy(false);
    if (ok) {
      setDialogOpen(false);
      reload();
    }
  }

  async function onConfirm(p: PickupTask) {
    const ok = await runAction(() => apiPost(`/pickups/${p.id}/confirm`, {}), { success: `Pickup ${p.pickupCode} selesai.` });
    if (ok) reload();
  }

  async function onDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    const ok = await runAction(() => apiDelete(`/pickups/${target.id}`), { success: "Pickup dibatalkan." });
    if (ok) reload();
  }

  if (!can.view) {
    return <PageHeader title="Pickups" subtitle="Anda tidak memiliki izin melihat pickup." />;
  }

  const kurirOptions = (options?.employees ?? []).map((e) => ({ value: String(e.id), label: `${e.name}${e.position ? ` — ${e.position}` : ""}` }));
  const shipmentOptions = readyShipments.map((s) => ({
    value: String(s.id),
    label: `${s.masterCode} · ${s.customer?.name ?? ""} (${s.details?.length ?? s._count?.details ?? 0} detail)`,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pickups"
        subtitle="Penjemputan kiriman oleh kurir dari alamat customer."
        icon={<Truck className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Buat Pickup
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
            searchPlaceholder="Cari kode pickup / resi / customer…"
            toolbar={
              <div className="flex items-center gap-1.5">
                {["all", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((s) => (
                  <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setStatusFilter(s)}>
                    {s === "all" ? "Semua" : s.replace("_", " ")}
                  </Button>
                ))}
              </div>
            }
            emptyMessage="Belum ada task pickup. Shipment berstatus READY_FOR_PICKUP bisa dijemput."
            columns={[
              {
                key: "code",
                header: "Kode",
                primary: true,
                render: (p) => (
                  <div>
                    <p className="font-mono text-xs font-semibold text-foreground">{p.pickupCode}</p>
                    <p className="text-xs text-muted-foreground">{p.masterCode}</p>
                  </div>
                ),
              },
              {
                key: "customer",
                header: "Customer & Rute",
                render: (p) => (
                  <div>
                    <p className="text-sm font-medium text-foreground">{p.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.origin} → {p.destination}
                    </p>
                  </div>
                ),
              },
              {
                key: "kurir",
                header: "Kurir",
                render: (p) => {
                  const kurir = options?.employees?.find((e) => e.id === p.kurirId);
                  return <span className="text-sm text-muted-foreground">{kurir?.name ?? "—"}</span>;
                },
              },
              { key: "createdAt", header: "Dibuat", hideOnMobile: true, render: (p) => formatDate(p.createdAt, true) },
              { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
              {
                key: "actions",
                header: "Aksi",
                render: (p) => (
                  <div className="flex flex-wrap gap-1.5">
                    {p.status !== "COMPLETED" && p.status !== "CANCELLED" && can.confirm && (
                      <Button size="sm" className="h-7" onClick={() => onConfirm(p)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Selesaikan
                      </Button>
                    )}
                    {p.status !== "COMPLETED" && p.status !== "CANCELLED" && can.assign && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)} aria-label={`Edit ${p.pickupCode}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(p)} aria-label={`Batalkan ${p.pickupCode}`}>
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
          <ActivityLogPanel entityTypes={["pickup"]} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Pickup — ${editing.pickupCode}` : "Buat Pickup"}</DialogTitle>
            <DialogDescription>
              {editing ? "Ganti kurir atau catatan." : "Pilih shipment READY_FOR_PICKUP dan kurir pelaksana."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            {!editing && (
              <Field label="Shipment" htmlFor="p-master">
                <FormSelect
                  value={form.masterId}
                  onValueChange={(v) => setForm({ ...form, masterId: v })}
                  placeholder={shipmentOptions.length ? "Pilih shipment…" : "Tidak ada shipment siap"}
                  options={shipmentOptions}
                  disabled={busy || shipmentOptions.length === 0}
                />
              </Field>
            )}
            <Field label="Kurir" htmlFor="p-kurir">
              <FormSelect value={form.kurirId} onValueChange={(v) => setForm({ ...form, kurirId: v })} placeholder="Pilih kurir" options={kurirOptions} disabled={busy} />
            </Field>
            <Field label="Catatan" htmlFor="p-notes">
              <Textarea id="p-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Opsional — instruksi khusus untuk kurir" disabled={busy} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Tugaskan Kurir"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan pickup {confirmDelete?.pickupCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Shipment akan dikembalikan ke status READY_FOR_PICKUP agar bisa dijadwalkan ulang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tidak</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Ya, batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
