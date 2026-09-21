"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, MapPin, Pencil, Phone, Plus, QrCode, Truck, User, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, employeesByPosition, type PickupTask, type Options, type Shipment } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ItemAuditDialog } from "@/components/app/item-audit-dialog";
import { PhotoDetailDialog } from "@/components/app/photo-detail-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, FormSelect, SubmitButton, Textarea, formatDate } from "@/components/app/form-parts";
import { QrScanDialog, type ScanTaskInfo } from "@/components/app/qr-scan-dialog";
import { GudangScopeBadge, GudangTabBanner, GudangTabsTriggers, gudangTabValue, parseGudangTabValue } from "@/components/app/gudang-tabs";
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
    scan: hasPermission(user, "pickup.scan"),
    confirm: hasPermission(user, "pickup.confirm"),
    // Revise round 8 — proof photo viewing. Only Admin Gudang + Owner see
    // the pickup photo (when present).
    viewProofPhoto: hasPermission(user, "proof_photo.view"),
  };
  // Kurir executor view: without assign capability, only show my own tasks.
  const isExecutor = !can.assign && !user?.isOwner;

  const { data, loading, reload } = useApiData<PickupTask[]>(() => apiGet<PickupTask[]>(`/pickups${isExecutor ? "?mine=true" : ""}`), [isExecutor]);
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
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PickupTask | null>(null);
  const [form, setForm] = useState<PickupForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PickupTask | null>(null);
  const [scanTask, setScanTask] = useState<ScanTaskInfo | null>(null);
  // Revise round 9 — Photo detail dialog state. Opens when the user clicks
  // "Detail Foto" on a pickup row. Shows the pickup photo at full size,
  // gated by proof_photo.view (Admin Gudang + Owner).
  const [photoPickup, setPhotoPickup] = useState<PickupTask | null>(null);

  // Owner per-gudang tabs (Daftar | Gudang A | Gudang B | … | Log Aktivitas):
  // filter the already-fetched rows to the selected gudang. Non-owner users
  // only ever receive their own gudang's data from the API.
  const isOwner = !!user?.isOwner;
  const gudangOptions = options?.warehouses ?? [];
  const activeGudangId = parseGudangTabValue(tab);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (p) =>
        (statusFilter === "all" || p.status === statusFilter) &&
        (activeGudangId == null || (p.gudangIds ?? []).includes(activeGudangId)) &&
        (!q ||
          p.pickupCode.toLowerCase().includes(q) ||
          p.masterCode.toLowerCase().includes(q) ||
          p.customerName.toLowerCase().includes(q)),
    );
  }, [data, search, statusFilter, activeGudangId]);

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

  function openScan(p: PickupTask) {
    setScanTask({
      id: p.id,
      code: p.pickupCode,
      masterCode: p.masterCode,
      customerName: p.customerName,
      route: `${p.origin} → ${p.destination}`,
      status: p.status,
      completedAt: p.completedAt,
      // Revise round 7 — pass the pickup address + sender contact so the
      // QR scan dialog can show the kurir where to go.
      pickupAddress: p.pickupAddress ?? null,
      pickupContact: p.pickupContact ?? null,
      pickupSenderName: p.pickupSenderName ?? null,
    });
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

  // Kurir dropdown — only employees with the Kurir position (never marketing,
  // drivers, admin kantor, …). Falls back to the full list only when no
  // employee has a position set (legacy data).
  const kurirOptions = employeesByPosition(options?.employees ?? [], "Kurir").map((e) => ({ value: String(e.id), label: e.name }));
  // B2B shipments wajib sudah masuk ke invoice perusahaan customer-nya sebelum
  // bisa di-pickup. B2C biaya ditanggung Marketing, jadi selalu eligible.
  const shipmentOptions = readyShipments
    .filter((s) => {
      if (s.customer?.type !== "b2b") return true;
      const hasInvoice = (s.invoiceLines?.length ?? 0) > 0;
      return hasInvoice;
    })
    .map((s) => ({
      value: String(s.id),
      label: `${s.masterCode} · ${s.customer?.name ?? ""} (${s.details?.length ?? s._count?.details ?? 0} detail)`,
    }));
  const blockedB2BCount = readyShipments.filter(
    (s) => s.customer?.type === "b2b" && (s.invoiceLines?.length ?? 0) === 0,
  ).length;

  const tableView = (
    <DataTable
      rows={rows}
      loading={loading}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Cari kode pickup / resi / customer…"
      toolbar={
        <div className="flex max-w-full flex-wrap items-center gap-1.5">
          {["all", "ASSIGNED", "PICKED_UP", "COMPLETED", "CANCELLED"].map((s) => (
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
          header: "Customer & Alamat Pickup",
          render: (p) => (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {p.customerName}
                {p.customerType === "b2b" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" title="B2B — cukup scan Master Resi sekali">
                    B2B · Master Resi
                  </span>
                )}
                {/* Step 2 — DIRECT fulfillment badge (mirrors the shipments-page
                    row badge). Violet color matches the shipments page so users
                    can recognize DIRECT shipments at a glance across pages. */}
                {(p.fulfillmentMode ?? "STANDARD") === "DIRECT" && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                    title="DIRECT — driver ambil langsung di lokasi customer, kirim langsung ke penerima"
                  >
                    DIRECT
                  </span>
                )}
                {/* Step 2 — "Already picked up from checkpoint 1" badge for
                    DIRECT shipments. Only shown for DIRECT (STANDARD pickups
                    happen at the customer address, never at a checkpoint). */}
                {(p.fulfillmentMode ?? "STANDARD") === "DIRECT" && p.pickedUpFromCheckpoint1 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    title="Driver sudah check-in di checkpoint 1 — paket sudah diambil dari titik penjemputan"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Sudah Diambil CP1
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.origin} → {p.destination}
              </p>
              {/* Revise round 7 — Pickup address so the kurir knows where to go.
                  Source: MasterShipment.pengirimAddress (the per-shipment
                  sender address the staff typed). Shows the contact phone
                  and sender name too so the kurir can ask for the right
                  person on arrival. */}
              {p.pickupAddress ? (
                <div className="mt-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-[11px]">
                  <p className="flex items-start gap-1.5 text-primary">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">{p.pickupAddress}</span>
                  </p>
                  {(p.pickupSenderName || p.pickupContact) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-foreground/80">
                      {p.pickupSenderName && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" /> {p.pickupSenderName}
                        </span>
                      )}
                      {p.pickupContact && (
                        <a
                          href={`tel:${p.pickupContact.replace(/[^+\d]/g, "")}`}
                          className="flex items-center gap-1 text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Phone className="h-3 w-3" /> {p.pickupContact}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                  Alamat pickup belum diisi pada shipment — isi di halaman Shipments (Pengirim → Alamat Pengirim).
                </p>
              )}
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
        {
          // Revise round 8 — pickup photo (proof of pickup).
          // Display gated by proof_photo.view (Admin Gudang + Owner).
          key: "photo",
          header: "Foto Bukti",
          hideOnMobile: true,
          render: (p) =>
            p.photoUrl ? (
              can.viewProofPhoto ? (
                <a href={p.photoUrl} target="_blank" rel="noreferrer" title="Lihat foto bukti pickup">
                  <img
                    src={p.photoUrl}
                    alt={`Bukti ${p.pickupCode}`}
                    className="h-12 w-16 rounded-md border object-cover"
                  />
                </a>
              ) : (
                <div
                  className="flex h-12 w-16 items-center justify-center rounded-md border bg-muted/60 text-muted-foreground"
                  title="Foto bukti hanya dapat dilihat oleh Admin Gudang / Owner (proof_photo.view)"
                >
                  <Camera className="h-4 w-4" />
                </div>
              )
            ) : (
              <span className="text-[10px] text-muted-foreground">—</span>
            ),
        },
        { key: "createdAt", header: "Dibuat", hideOnMobile: true, render: (p) => formatDate(p.createdAt, true) },
        {
          key: "scan",
          header: "Paket Ter-scan",
          hideOnMobile: true,
          render: (p) => (
            <span className="font-mono text-xs text-muted-foreground">
              {p.scannedCount ?? 0}/{p.detailsCount}
            </span>
          ),
        },
        {
          key: "status",
          header: "Status",
          render: (p) => (
            <div className="space-y-1">
              <StatusBadge status={p.status} />
              {/* Revision Part A — distinguish pickup task state vs package location */}
              {p.status === "PICKED_UP" && (
                <p className="text-[10px] leading-tight text-muted-foreground">
                  {p.masterStatus === "RECEIVED_AT_GUDANG" || p.masterStatus === "ARRIVED_AT_GUDANG"
                    ? "Sudah tiba di gudang"
                    : "Paket dibawa kurir ke gudang"}
                </p>
              )}
            </div>
          ),
        },
        {
          key: "actions",
          header: "Aksi",
          render: (p) => (
            <div className="flex flex-wrap gap-1.5">
              <ItemAuditDialog entityType="pickup" entityId={p.id} itemLabel={p.pickupCode} />
              {/* Revise round 9 — Detail Foto button. Opens a dialog showing the
                  pickup photo (proof of pickup) at full size. Display is gated
                  by proof_photo.view (Admin Gudang + Owner). The button is
                  always visible to admins/owner; if no photo is set, the dialog
                  shows a "belum ada foto" placeholder. */}
              {(can.viewProofPhoto || !isExecutor) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => setPhotoPickup(p)}
                  title={p.photoUrl ? "Lihat foto bukti pickup" : "Detail foto (belum ada foto)"}
                >
                  <Camera className="h-3.5 w-3.5" /> Detail Foto
                </Button>
              )}
              {p.status !== "COMPLETED" && p.status !== "CANCELLED" && (can.confirm || can.scan) && (
                <Button size="sm" className="h-7" onClick={() => openScan(p)}>
                  <QrCode className="h-3.5 w-3.5" /> {isExecutor ? "Proses / Scan QR" : "Selesaikan (Scan QR)"}
                </Button>
              )}
              {p.status === "COMPLETED" && (can.confirm || can.scan) && (
                <Button variant="outline" size="sm" className="h-7" onClick={() => openScan(p)}>
                  <QrCode className="h-3.5 w-3.5" /> Riwayat Scan
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
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pickups"
        subtitle="Penjemputan kiriman oleh kurir dari alamat customer."
        icon={<Truck className="h-5 w-5" />}
        actions={
          <>
            {!isOwner && <GudangScopeBadge gudangName={user?.warehouseName ?? null} />}
            {can.create && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> Buat Pickup
              </Button>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Daftar</TabsTrigger>
          {isOwner && <GudangTabsTriggers warehouses={gudangOptions} />}
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-3">
          {tableView}
        </TabsContent>
        {isOwner &&
          gudangOptions.map((w) => (
            <TabsContent key={w.id} value={gudangTabValue(w.id)} className="mt-3 space-y-3">
              <GudangTabBanner gudangName={w.name} count={rows.length} />
              {tableView}
            </TabsContent>
          ))}
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
                {blockedB2BCount > 0 && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    {blockedB2BCount} shipment B2B disembunyikan karena belum ditagirkan ke invoice perusahaan customer. Tambahkan shipment tersebut ke invoice terlebih dahulu di halaman Invoices.
                  </p>
                )}
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

      <QrScanDialog
        open={!!scanTask}
        onOpenChange={(open) => !open && setScanTask(null)}
        mode="pickup"
        task={scanTask}
        onDone={reload}
      />

      {/* Revise round 9 — Photo Detail Dialog for pickups. Shows the pickup
          photo (proof of pickup) at full size, gated by proof_photo.view. */}
      <PhotoDetailDialog
        open={!!photoPickup}
        onOpenChange={(open) => !open && setPhotoPickup(null)}
        title={`Foto Bukti Pickup — ${photoPickup?.pickupCode ?? ""}`}
        description="Foto bukti penjemputan paket oleh kurir di lokasi customer."
        photos={
          photoPickup?.photoUrl
            ? [{
                url: photoPickup.photoUrl,
                label: `Pickup ${photoPickup.pickupCode}`,
                recordedAt: photoPickup.completedAt,
              }]
            : []
        }
      />
    </div>
  );
}
