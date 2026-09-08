"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, PackageCheck, Pencil, Plus, QrCode, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type DeliveryTask, type Options, type Shipment } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, FormSelect, SubmitButton, Textarea, formatDate, formatRupiah } from "@/components/app/form-parts";
import { QrScanDialog, type ScanTaskInfo } from "@/components/app/qr-scan-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface DeliveryForm {
  masterId: string;
  kurirId: string;
  notes: string;
}

const EMPTY: DeliveryForm = { masterId: "", kurirId: "", notes: "" };

export function DeliveriesPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "delivery.view"),
    assign: hasPermission(user, "delivery.assign_kurir"),
    scan: hasPermission(user, "delivery.scan"),
    confirm: hasPermission(user, "delivery.confirm"),
  };
  // Kurir executor view: without assign capability, only show my own tasks.
  const isExecutor = !can.assign && !user?.isOwner;

  const { data, loading, reload } = useApiData<DeliveryTask[]>(() => apiGet<DeliveryTask[]>(`/deliveries${isExecutor ? "?mine=true" : ""}`), [isExecutor]);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [readyShipments, setReadyShipments] = useState<Shipment[]>([]);

  useEffect(() => {
    if (!can.assign) return;
    Promise.all([
      apiGet<Shipment[]>("/shipments?status=ARRIVED_AT_GUDANG"),
      apiGet<Shipment[]>("/shipments?status=RECEIVED_AT_GUDANG"),
    ])
      .then(([a, r]) => setReadyShipments([...a, ...r]))
      .catch(() => undefined);
  }, [can.assign, data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DeliveryTask | null>(null);
  const [detailTarget, setDetailTarget] = useState<DeliveryTask | null>(null);
  const [scanTask, setScanTask] = useState<ScanTaskInfo | null>(null);
  const [form, setForm] = useState<DeliveryForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DeliveryTask | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (d) =>
        (statusFilter === "all" || d.status === statusFilter) &&
        (!q || d.deliveryCode.toLowerCase().includes(q) || d.masterCode.toLowerCase().includes(q) || d.customerName.toLowerCase().includes(q)),
    );
  }, [data, search, statusFilter]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await runAction(
      () =>
        editTarget
          ? apiPut(`/deliveries/${editTarget.id}`, { kurirId: form.kurirId ? Number(form.kurirId) : undefined, notes: form.notes || null })
          : apiPost("/deliveries", { masterId: Number(form.masterId), kurirId: Number(form.kurirId), notes: form.notes || null }),
      { success: editTarget ? "Delivery diperbarui." : "Delivery dibuat & kurir ditugaskan." },
    );
    setBusy(false);
    if (ok) {
      setCreateOpen(false);
      setEditTarget(null);
      setForm(EMPTY);
      reload();
    }
  }

  function openScan(d: DeliveryTask) {
    setScanTask({
      id: d.id,
      code: d.deliveryCode,
      masterCode: d.masterCode,
      customerName: d.customerName,
      route: d.address ?? d.destination,
      status: d.status,
      completedAt: d.completedAt,
    });
  }

  async function onDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    const ok = await runAction(() => apiDelete(`/deliveries/${target.id}`), { success: "Delivery dihapus." });
    if (ok) reload();
  }

  if (!can.view) {
    return <PageHeader title="Deliveries" subtitle="Anda tidak memiliki izin melihat delivery." />;
  }

  const kurirOptions = (options?.employees ?? []).map((emp) => ({ value: String(emp.id), label: `${emp.name}${emp.position ? ` — ${emp.position}` : ""}` }));
  const shipmentOptions = readyShipments.map((s) => ({
    value: String(s.id),
    label: `${s.masterCode} · ${s.customer?.name ?? ""} → ${s.destination}`,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Deliveries"
        subtitle="Pengiriman akhir ke penerima — kurir scan QR semua paket customer sebelum konfirmasi."
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          can.assign && (
            <Button
              onClick={() => {
                setEditTarget(null);
                setForm(EMPTY);
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Buat Delivery
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
            searchPlaceholder="Cari kode delivery / resi / customer…"
            toolbar={
              <div className="flex items-center gap-1.5">
                {["all", "ASSIGNED", "COMPLETED", "FAILED"].map((s) => (
                  <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setStatusFilter(s)}>
                    {s === "all" ? "Semua" : s}
                  </Button>
                ))}
              </div>
            }
            emptyMessage="Belum ada task delivery."
            columns={[
              {
                key: "code",
                header: "Kode",
                primary: true,
                render: (d) => (
                  <div>
                    <p className="font-mono text-xs font-semibold text-foreground">{d.deliveryCode}</p>
                    <p className="text-xs text-muted-foreground">{d.masterCode}</p>
                  </div>
                ),
              },
              {
                key: "customer",
                header: "Penerima",
                render: (d) => (
                  <div>
                    <p className="text-sm font-medium text-foreground">{d.customerName}</p>
                    <p className="text-xs text-muted-foreground">{d.address ?? d.destination}</p>
                  </div>
                ),
              },
              {
                key: "kurir",
                header: "Kurir",
                render: (d) => {
                  const kurir = options?.employees?.find((emp) => emp.id === d.kurirId);
                  return <span className="text-sm text-muted-foreground">{kurir?.name ?? "—"}</span>;
                },
              },
              {
                key: "packages",
                header: "Paket (Detail Barang)",
                render: (d) => (
                  <button
                    type="button"
                    className="group flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left hover:bg-accent"
                    onClick={() => setDetailTarget(d)}
                    aria-label={`Lihat detail barang ${d.deliveryCode}`}
                  >
                    <span className={cn("font-mono text-xs", d.detailsCount > 0 && d.scannedCount >= d.detailsCount ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                      {d.scannedCount ?? 0}/{d.detailsCount ?? 0}
                    </span>
                    <span className="text-[10px] text-muted-foreground group-hover:text-foreground">lihat detail</span>
                  </button>
                ),
              },
              { key: "price", header: "Nilai", hideOnMobile: true, render: (d) => <span className="text-sm">{formatRupiah(d.priceAmount)}</span> },
              { key: "completedAt", header: "Selesai", hideOnMobile: true, render: (d) => formatDate(d.completedAt, true) },
              { key: "status", header: "Status", render: (d) => <StatusBadge status={d.status} /> },
              {
                key: "actions",
                header: "Aksi",
                render: (d) => (
                  <div className="flex flex-wrap gap-1.5">
                    {d.status !== "COMPLETED" && d.status !== "FAILED" && (can.confirm || can.scan) && (
                      <Button size="sm" className="h-7" onClick={() => openScan(d)}>
                        <QrCode className="h-3.5 w-3.5" /> {isExecutor ? "Antar / Scan QR" : "Selesaikan (Scan QR)"}
                      </Button>
                    )}
                    {d.status === "COMPLETED" && (can.confirm || can.scan) && (
                      <Button variant="outline" size="sm" className="h-7" onClick={() => openScan(d)}>
                        <QrCode className="h-3.5 w-3.5" /> Riwayat Scan
                      </Button>
                    )}
                    {d.status !== "COMPLETED" && d.status !== "FAILED" && can.assign && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditTarget(d);
                            setForm({ masterId: "", kurirId: d.kurirId ? String(d.kurirId) : "", notes: d.notes ?? "" });
                            setCreateOpen(true);
                          }}
                          aria-label={`Edit ${d.deliveryCode}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(d)} aria-label={`Hapus ${d.deliveryCode}`}>
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
          <ActivityLogPanel entityTypes={["delivery"]} />
        </TabsContent>
      </Tabs>

      {/* Create / edit dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit Delivery — ${editTarget.deliveryCode}` : "Buat Delivery"}</DialogTitle>
            <DialogDescription>
              {editTarget ? "Ganti kurir atau catatan." : "Pilih shipment yang sudah tiba di gudang tujuan dan kurir pengantar."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            {!editTarget && (
              <Field label="Shipment" htmlFor="d-master">
                <FormSelect
                  value={form.masterId}
                  onValueChange={(v) => setForm({ ...form, masterId: v })}
                  placeholder={shipmentOptions.length ? "Pilih shipment…" : "Tidak ada shipment siap kirim"}
                  options={shipmentOptions}
                  disabled={busy || shipmentOptions.length === 0}
                />
              </Field>
            )}
            <Field label="Kurir" htmlFor="d-kurir">
              <FormSelect value={form.kurirId} onValueChange={(v) => setForm({ ...form, kurirId: v })} placeholder="Pilih kurir" options={kurirOptions} disabled={busy} />
            </Field>
            <Field label="Catatan" htmlFor="d-notes">
              <Textarea id="d-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Opsional" disabled={busy} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editTarget ? "Simpan Perubahan" : "Tugaskan Kurir"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail barang dialog — packages of this delivery + handover state */}
      <Dialog open={!!detailTarget} onOpenChange={(open) => !open && setDetailTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" />
              Detail Barang — {detailTarget?.deliveryCode}
            </DialogTitle>
            <DialogDescription>
              Shipment {detailTarget?.masterCode} · {detailTarget?.customerName}. Paket bertanda hijau sudah ter-scan saat serah terima.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border p-2">
            {detailTarget?.details.map((x) => (
              <div key={x.id} className={cn("flex items-center gap-3 rounded-md px-2 py-1.5", x.scanned ? "bg-emerald-50/60 dark:bg-emerald-950/40" : "bg-card")}>
                {x.scanned ? (
                  <PackageCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <div className="h-4 w-4 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/40" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs font-semibold text-foreground">{x.detailCode}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {x.description}
                  </p>
                </div>
              </div>
            ))}
            {detailTarget && detailTarget.details.length === 0 && (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">Shipment ini belum punya detail barang.</p>
            )}
          </div>
          {detailTarget?.status === "COMPLETED" && (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Delivery selesai {detailTarget.completedAt ? formatDate(detailTarget.completedAt) : ""} — PoD: {detailTarget.proofOfDelivery ?? "—"}
            </p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus delivery {confirmDelete?.deliveryCode}?</AlertDialogTitle>
            <AlertDialogDescription>Hanya delivery yang belum selesai yang bisa dihapus.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QrScanDialog
        open={!!scanTask}
        onOpenChange={(open) => !open && setScanTask(null)}
        mode="delivery"
        task={scanTask}
        onDone={reload}
      />
    </div>
  );
}
