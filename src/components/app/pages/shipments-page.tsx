"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Calculator,
  Package,
  Pencil,
  Plus,
  Receipt,
  Send,
  Trash2,
  Truck,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  hasPermission,
  type DetailShipment,
  type Options,
  type Payment,
  type Shipment,
  type TrackingEvent,
} from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, FormSelect, Input, NumberInput, SubmitButton, formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ShipmentForm {
  customerId: string;
  origin: string;
  destination: string;
  originWarehouseId: string;
  destinationWarehouseId: string;
}

interface DetailForm {
  description: string;
  quantity: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  actualWeightKg: string;
}

const EMPTY_SHIPMENT: ShipmentForm = { customerId: "", origin: "", destination: "", originWarehouseId: "", destinationWarehouseId: "" };
const EMPTY_DETAIL: DetailForm = { description: "", quantity: "1", lengthCm: "", widthCm: "", heightCm: "", actualWeightKg: "" };

export function ShipmentsPage({ shipmentId }: { shipmentId: number | null }) {
  return shipmentId != null ? <ShipmentDetail id={shipmentId} /> : <ShipmentList />;
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function ShipmentList() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "shipment.view"),
    create: hasPermission(user, "shipment.create"),
    cancel: hasPermission(user, "shipment.cancel"),
    delete: hasPermission(user, "shipment.delete"),
  };

  const { data, loading, reload } = useApiData<Shipment[]>(() => apiGet<Shipment[]>("/shipments"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ShipmentForm>(EMPTY_SHIPMENT);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Shipment | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (s) =>
        (statusFilter === "all" || s.status === statusFilter) &&
        (!q ||
          s.masterCode.toLowerCase().includes(q) ||
          (s.customer?.name ?? "").toLowerCase().includes(q) ||
          s.origin.toLowerCase().includes(q) ||
          s.destination.toLowerCase().includes(q)),
    );
  }, [data, search, statusFilter]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = {
      customerId: Number(form.customerId),
      origin: form.origin,
      destination: form.destination,
      originWarehouseId: form.originWarehouseId ? Number(form.originWarehouseId) : null,
      destinationWarehouseId: form.destinationWarehouseId ? Number(form.destinationWarehouseId) : null,
    };
    const ok = await runAction(() => apiPost("/shipments", payload), { success: "Shipment dibuat (CREATED). Tambahkan detail barang lalu submit untuk pickup." });
    setBusy(false);
    if (ok) {
      setDialogOpen(false);
      reload();
    }
  }

  async function onDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    const ok = await runAction(() => apiDelete(`/shipments/${target.id}`), { success: "Shipment dihapus." });
    if (ok) reload();
  }

  if (!can.view) {
    return <PageHeader title="Shipments" subtitle="Anda tidak memiliki izin melihat shipment." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shipments"
        subtitle="Master shipment beserta lifecycle CREATED → DELIVERED."
        icon={<Package className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={() => { setForm(EMPTY_SHIPMENT); setDialogOpen(true); }}>
              <Plus className="h-4 w-4" /> Buat Shipment
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
            searchPlaceholder="Cari resi / customer / kota…"
            toolbar={
              <div className="flex flex-wrap items-center gap-1.5">
                {["all", "CREATED", "READY_FOR_PICKUP", "PICKED_UP", "IN_TRANSPORT", "DELIVERED", "CANCELLED"].map((s) => (
                  <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} className="h-7 px-2.5 text-[11px]" onClick={() => setStatusFilter(s)}>
                    {s === "all" ? "Semua" : s.replace(/_/g, " ")}
                  </Button>
                ))}
              </div>
            }
            emptyMessage="Belum ada shipment. Klik “Buat Shipment” untuk membuat booking baru."
            columns={[
              {
                key: "code",
                header: "Resi",
                primary: true,
                render: (s) => (
                  <a href={`#/shipments/${s.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                    {s.masterCode}
                  </a>
                ),
              },
              {
                key: "customer",
                header: "Customer & Rute",
                render: (s) => (
                  <div>
                    <p className="text-sm font-medium text-foreground">{s.customer?.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.origin} → {s.destination}
                    </p>
                  </div>
                ),
              },
              { key: "details", header: "Detail", render: (s) => s._count?.details ?? s.details?.length ?? 0 },
              {
                key: "price",
                header: "Harga",
                render: (s) => (
                  <div>
                    <p className="text-sm font-semibold">{formatRupiah(s.priceAmount)}</p>
                    {s.chargeableWeightKg != null && <p className="text-[11px] text-muted-foreground">{formatNumber(s.chargeableWeightKg)} kg</p>}
                  </div>
                ),
              },
              { key: "created", header: "Dibuat", hideOnMobile: true, render: (s) => formatDate(s.createdAt) },
              { key: "status", header: "Status", render: (s) => <StatusBadge status={s.status} /> },
              {
                key: "actions",
                header: "Aksi",
                render: (s) => (
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="outline" size="sm" className="h-7" onClick={() => (window.location.hash = `#/shipments/${s.id}`)}>
                      Detail
                    </Button>
                    {can.delete && s.status === "CREATED" && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(s)} aria-label="Hapus shipment">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["shipment", "shipment_detail"]} />
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Shipment</DialogTitle>
            <DialogDescription>Resi (MKT-xxxxxx) dibuat otomatis. Detail barang ditambahkan setelah shipment dibuat.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer" htmlFor="s-customer" className="sm:col-span-2">
                <FormSelect
                  value={form.customerId}
                  onValueChange={(v) => setForm({ ...form, customerId: v })}
                  placeholder="Pilih customer…"
                  options={(options?.customers ?? []).map((c) => ({ value: String(c.id), label: `${c.name} (${c.type.toUpperCase()} · ${c.code})` }))}
                  disabled={busy}
                />
              </Field>
              <Field label="Kota Asal" htmlFor="s-origin">
                <Input id="s-origin" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} placeholder="Jakarta Pusat" required disabled={busy} />
              </Field>
              <Field label="Kota Tujuan" htmlFor="s-destination">
                <Input id="s-destination" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="Bandung" required disabled={busy} />
              </Field>
              <Field label="Gudang Asal" htmlFor="s-warehouse-from" hint="Opsional">
                <FormSelect
                  value={form.originWarehouseId}
                  onValueChange={(v) => setForm({ ...form, originWarehouseId: v })}
                  placeholder="—"
                  options={(options?.warehouses ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
                  disabled={busy}
                />
              </Field>
              <Field label="Gudang Tujuan" htmlFor="s-warehouse-to" hint="Opsional">
                <FormSelect
                  value={form.destinationWarehouseId}
                  onValueChange={(v) => setForm({ ...form, destinationWarehouseId: v })}
                  placeholder="—"
                  options={(options?.warehouses ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
                  disabled={busy}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>Buat Shipment</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus shipment {confirmDelete?.masterCode}?</AlertDialogTitle>
            <AlertDialogDescription>Hanya shipment CREATED yang bisa dihapus. Shipment yang sudah berjalan dibatalkan lewat tombol Cancel di halaman detail.</AlertDialogDescription>
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

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function ShipmentDetail({ id }: { id: number }) {
  const { user } = useAuth();
  const can = {
    update: hasPermission(user, "shipment.update"),
    cancel: hasPermission(user, "shipment.cancel"),
    detailCreate: hasPermission(user, "shipment_detail.create"),
    detailUpdate: hasPermission(user, "shipment_detail.update"),
    detailDelete: hasPermission(user, "shipment_detail.delete"),
    track: hasPermission(user, "shipment.view_tracking"),
    paymentView: hasPermission(user, "payment.view"),
    paymentRecord: hasPermission(user, "payment.record"),
    paymentVerify: hasPermission(user, "payment.verify"),
  };

  const [shipment, setShipment] = useState<(Shipment & { details: DetailShipment[]; trackingEvents: TrackingEvent[]; payments: Payment[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<Shipment & { details: DetailShipment[]; trackingEvents: TrackingEvent[]; payments: Payment[] }>(`/shipments/${id}`);
      setShipment(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat shipment.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [editingDetail, setEditingDetail] = useState<DetailShipment | null>(null);
  const [detailForm, setDetailForm] = useState<DetailForm>(EMPTY_DETAIL);
  const [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ method: "CASH", amount: "", reference: "" });
  const [confirmDeleteDetail, setConfirmDeleteDetail] = useState<DetailShipment | null>(null);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (error || !shipment) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => (window.location.hash = "#/shipments")} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Kembali
        </Button>
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive">
          {error ?? "Shipment tidak ditemukan."}
        </p>
      </div>
    );
  }

  const isEditable = ["CREATED", "READY_FOR_PICKUP"].includes(shipment.status);

  async function refresh() {
    await load();
  }

  async function submitForPickup() {
    const ok = await runAction(() => apiPost(`/shipments/${shipment!.id}/ready`), {
      success: "Shipment siap dijemput — buat task pickup di menu Pickups.",
    });
    if (ok) refresh();
  }

  async function cancelShipment() {
    const ok = await runAction(() => apiPost(`/shipments/${shipment!.id}/cancel`), { success: "Shipment dibatalkan." });
    if (ok) refresh();
  }

  async function computePrice() {
    const ok = await runAction(() => apiPost(`/shipments/${shipment!.id}/price`), { success: "Harga dihitung dari tarif aktif." });
    if (ok) refresh();
  }

  function openDetailCreate() {
    setEditingDetail(null);
    setDetailForm(EMPTY_DETAIL);
    setDetailOpen(true);
  }

  function openDetailEdit(d: DetailShipment) {
    setEditingDetail(d);
    setDetailForm({
      description: d.description,
      quantity: String(d.quantity),
      lengthCm: d.lengthCm != null ? String(d.lengthCm) : "",
      widthCm: d.widthCm != null ? String(d.widthCm) : "",
      heightCm: d.heightCm != null ? String(d.heightCm) : "",
      actualWeightKg: String(d.actualWeightKg),
    });
    setDetailOpen(true);
  }

  async function onDetailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = {
      description: detailForm.description,
      quantity: Number(detailForm.quantity) || 1,
      lengthCm: detailForm.lengthCm === "" ? null : Number(detailForm.lengthCm),
      widthCm: detailForm.widthCm === "" ? null : Number(detailForm.widthCm),
      heightCm: detailForm.heightCm === "" ? null : Number(detailForm.heightCm),
      actualWeightKg: Number(detailForm.actualWeightKg) || 0,
    };
    const ok = await runAction(
      () =>
        editingDetail
          ? apiPut(`/shipment-details/${editingDetail.id}`, payload)
          : apiPost(`/shipments/${shipment!.id}/details`, payload),
      { success: editingDetail ? "Detail diperbarui." : "Detail ditambahkan." },
    );
    setBusy(false);
    if (ok) {
      setDetailOpen(false);
      refresh();
    }
  }

  async function onDetailDelete() {
    if (!confirmDeleteDetail) return;
    const target = confirmDeleteDetail;
    setConfirmDeleteDetail(null);
    const ok = await runAction(() => apiDelete(`/shipment-details/${target.id}`), { success: "Detail dihapus." });
    if (ok) refresh();
  }

  async function onPayment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await runAction(
      () =>
        apiPost(`/shipments/${shipment!.id}/payments`, {
          method: paymentForm.method,
          amount: Number(paymentForm.amount),
          reference: paymentForm.reference || null,
        }),
      { success: "Pembayaran dicatat." },
    );
    setBusy(false);
    if (ok) {
      setPaymentOpen(false);
      setPaymentForm({ method: "CASH", amount: "", reference: "" });
      refresh();
    }
  }

  async function verifyPayment(p: Payment) {
    const ok = await runAction(() => apiPost(`/payments/${p.id}/verify`), { success: "Pembayaran diverifikasi." });
    if (ok) refresh();
  }

  const volumetric = shipment.details.reduce((sum, d) => sum + (d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0) * d.quantity, 0) / 6000;
  const actualWeight = shipment.details.reduce((sum, d) => sum + d.actualWeightKg * d.quantity, 0);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => (window.location.hash = "#/shipments")} className="-ml-2">
        <ArrowLeft className="h-4 w-4" /> Semua shipment
      </Button>

      <PageHeader
        title={shipment.masterCode}
        subtitle={`${shipment.customer?.name ?? "—"} · ${shipment.origin} → ${shipment.destination} · dibuat ${formatDate(shipment.createdAt)}`}
        actions={
          <>
            <StatusBadge status={shipment.status} />
            {shipment.status === "CREATED" && can.update && (
              <Button onClick={submitForPickup} disabled={shipment.details.length === 0}>
                <Send className="h-4 w-4" /> Submit for Pickup
              </Button>
            )}
            {can.update && !shipment.priceAmount && shipment.details.length > 0 && ["CREATED", "READY_FOR_PICKUP", "PICKED_UP"].includes(shipment.status) && (
              <Button variant="secondary" onClick={computePrice}>
                <Calculator className="h-4 w-4" /> Hitung Harga
              </Button>
            )}
            {can.cancel && shipment.status !== "CANCELLED" && shipment.status !== "DELIVERED" && (
              <Button variant="outline" className="text-destructive" onClick={cancelShipment}>
                <Ban className="h-4 w-4" /> Cancel
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Pricing summary */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4 text-primary" /> Ringkasan Harga
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Row label="Total detail" value={`${shipment.details.length} item`} />
            <Row label="Berat aktual" value={`${formatNumber(actualWeight)} kg`} />
            <Row label="Berat volumetrik (÷6000)" value={`${formatNumber(volumetric)} kg`} />
            <Row label="Chargeable weight" value={shipment.chargeableWeightKg != null ? `${formatNumber(shipment.chargeableWeightKg)} kg` : "—"} />
            <Row label="Tarif" value={shipment.ratePerKg != null ? `${formatRupiah(shipment.ratePerKg)}/kg` : "—"} />
            <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2.5">
              <span className="text-xs font-semibold text-primary">TOTAL HARGA</span>
              <span className="text-base font-bold text-primary">{formatRupiah(shipment.priceAmount)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Tracking timeline */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-4 w-4 text-primary" /> Riwayat Tracking
            </CardTitle>
          </CardHeader>
          <CardContent>
            {shipment.trackingEvents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Belum ada event tracking.</p>
            ) : (
              <ol className="relative ml-2 space-y-0 border-l pl-5">
                {shipment.trackingEvents.map((ev) => (
                  <li key={ev.id} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-[23px] top-1 flex h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-foreground">{ev.event}</span>
                      <span className="text-[11px] text-muted-foreground">{formatDate(ev.occurredAt, true)}</span>
                    </div>
                    {ev.description && <p className="mt-0.5 text-sm text-muted-foreground">{ev.description}</p>}
                    {ev.actor?.name && <p className="text-[11px] text-muted-foreground/70">oleh {ev.actor.name}</p>}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Details table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Detail Barang ({shipment.details.length})</CardTitle>
            {isEditable && can.detailCreate && (
              <Button size="sm" onClick={openDetailCreate}>
                <Plus className="h-4 w-4" /> Tambah Detail
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {shipment.details.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Belum ada detail barang. {isEditable ? "Klik “Tambah Detail” untuk menambah." : "Detail hanya bisa ditambah saat status CREATED / READY_FOR_PICKUP."}
            </p>
          ) : (
            <DataTable
              rows={shipment.details}
              emptyMessage="—"
              columns={[
                {
                  key: "code",
                  header: "Kode",
                  primary: true,
                  render: (d) => <span className="font-mono text-xs">{d.detailCode}</span>,
                },
                { key: "desc", header: "Deskripsi", render: (d) => <span className="font-medium">{d.description}</span> },
                { key: "qty", header: "Qty", render: (d) => d.quantity },
                {
                  key: "dims",
                  header: "Dimensi (cm)",
                  hideOnMobile: true,
                  render: (d) => (d.lengthCm ? `${formatNumber(d.lengthCm, 0)}×${formatNumber(d.widthCm, 0)}×${formatNumber(d.heightCm, 0)}` : "—"),
                },
                { key: "weight", header: "Berat", render: (d) => `${formatNumber(d.actualWeightKg)} kg` },
                ...(isEditable && (can.detailUpdate || can.detailDelete)
                  ? [
                      {
                        key: "actions",
                        header: "Aksi",
                        render: (d: DetailShipment) => (
                          <div className="flex gap-1.5">
                            {can.detailUpdate && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDetailEdit(d)} aria-label="Edit detail">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {can.detailDelete && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDeleteDetail(d)} aria-label="Hapus detail">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* Payments */}
      {can.paymentView && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-primary" /> Pembayaran
              </CardTitle>
              {can.paymentRecord && shipment.priceAmount != null && shipment.status !== "CANCELLED" && (
                <Button size="sm" onClick={() => setPaymentOpen(true)}>
                  <Plus className="h-4 w-4" /> Catat Pembayaran
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {shipment.payments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {shipment.priceAmount == null ? "Hitung harga shipment terlebih dahulu." : "Belum ada pembayaran."}
              </p>
            ) : (
              <DataTable
                rows={shipment.payments}
                emptyMessage="—"
                columns={[
                  { key: "method", header: "Metode", primary: true, render: (p) => p.method },
                  { key: "amount", header: "Jumlah", render: (p) => <span className="font-semibold">{formatRupiah(p.amount)}</span> },
                  { key: "ref", header: "Referensi", hideOnMobile: true, render: (p) => p.reference ?? "—" },
                  { key: "recorded", header: "Dicatat", hideOnMobile: true, render: (p) => `${formatDate(p.createdAt, true)}${p.recordedBy ? ` · ${p.recordedBy.name}` : ""}` },
                  {
                    key: "status",
                    header: "Status",
                    render: (p) => <StatusBadge status={p.status} />,
                  },
                  {
                    key: "actions",
                    header: "Aksi",
                    render: (p) =>
                      p.status === "RECORDED" && can.paymentVerify ? (
                        <Button size="sm" variant="secondary" className="h-7" onClick={() => verifyPayment(p)}>
                          Verifikasi
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{p.verifiedBy ? `oleh ${p.verifiedBy.name}` : "—"}</span>
                      ),
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
      )}

      <ActivityLogPanel entityTypes={["shipment", "shipment_detail", "payment", "pickup", "delivery", "transport"]} title="Log Aktivitas Shipment Ini" limit={20} />

      {/* Detail create/edit dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingDetail ? `Edit Detail — ${editingDetail.detailCode}` : "Tambah Detail Barang"}</DialogTitle>
            <DialogDescription>Isi dimensi untuk perhitungan berat volumetrik (÷6000).</DialogDescription>
          </DialogHeader>
          <form onSubmit={onDetailSubmit} className="space-y-4">
            <Field label="Deskripsi" htmlFor="d-desc">
              <Input id="d-desc" value={detailForm.description} onChange={(e) => setDetailForm({ ...detailForm, description: e.target.value })} placeholder="mis. Karton alat tulis" required disabled={busy} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Jumlah" htmlFor="d-qty">
                <NumberInput id="d-qty" value={detailForm.quantity} onChange={(e) => setDetailForm({ ...detailForm, quantity: e.target.value })} required disabled={busy} />
              </Field>
              <Field label="Berat aktual (kg)" htmlFor="d-weight">
                <NumberInput id="d-weight" value={detailForm.actualWeightKg} onChange={(e) => setDetailForm({ ...detailForm, actualWeightKg: e.target.value })} placeholder="0" required disabled={busy} />
              </Field>
              <div className="col-span-2 grid grid-cols-3 gap-3">
                <Field label="Panjang (cm)" htmlFor="d-l">
                  <NumberInput id="d-l" value={detailForm.lengthCm} onChange={(e) => setDetailForm({ ...detailForm, lengthCm: e.target.value })} placeholder="30" disabled={busy} />
                </Field>
                <Field label="Lebar (cm)" htmlFor="d-w">
                  <NumberInput id="d-w" value={detailForm.widthCm} onChange={(e) => setDetailForm({ ...detailForm, widthCm: e.target.value })} placeholder="20" disabled={busy} />
                </Field>
                <Field label="Tinggi (cm)" htmlFor="d-h">
                  <NumberInput id="d-h" value={detailForm.heightCm} onChange={(e) => setDetailForm({ ...detailForm, heightCm: e.target.value })} placeholder="15" disabled={busy} />
                </Field>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDetailOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editingDetail ? "Simpan Perubahan" : "Tambah Detail"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Catat Pembayaran</DialogTitle>
            <DialogDescription>Harga shipment: {formatRupiah(shipment.priceAmount)}. Pembayaran akan diverifikasi Admin Kantor.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onPayment} className="space-y-4">
            <Field label="Metode" htmlFor="pay-method">
              <select
                id="pay-method"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                value={paymentForm.method}
                onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                disabled={busy}
              >
                <option value="CASH">Cash (diterima kurir)</option>
                <option value="TRANSFER">Transfer bank</option>
              </select>
            </Field>
            <Field label="Jumlah (Rp)" htmlFor="pay-amount">
              <NumberInput id="pay-amount" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} required disabled={busy} />
            </Field>
            <Field label="Referensi" htmlFor="pay-ref" hint="Opsional — no. transfer / kuitansi">
              <Input id="pay-ref" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} disabled={busy} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>
                <Receipt className="h-4 w-4" /> Catat Pembayaran
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDeleteDetail} onOpenChange={(open) => !open && setConfirmDeleteDetail(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus detail {confirmDeleteDetail?.detailCode}?</AlertDialogTitle>
            <AlertDialogDescription>Hanya bisa dihapus saat shipment masih CREATED / READY_FOR_PICKUP.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDetailDelete}>
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}
