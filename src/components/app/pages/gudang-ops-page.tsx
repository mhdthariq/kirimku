"use client";

import { useState } from "react";
import {
  Bell,
  ChevronDown,
  Package,
  QrCode,
  ScanLine,
  Store,
  Truck,
  UserCheck,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  apiGet,
  apiPost,
  hasPermission,
  type GudangArrivalQueueItem,
  type GudangWalkInItem,
  type GudangWorkspace,
  type Options,
} from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { ArrivalScanDialog } from "@/components/app/arrival-scan-dialog";
import { Field, FormSelect, SubmitButton, Textarea, formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Feedback = { kind: "ok" | "warn" | "info"; text: string } | null;

/**
 * Gudang operations workspace (menu between Pickups and Shipments).
 *
 * Kedatangan (arrival queue): shipments with status PICKED_UP that a kurir is
 * bringing back to the gudang. Admin Gudang scans every package (camera /
 * reader / manual — codes hidden), or uses "Scan Semua Paket" (reader batch),
 * then confirms "Tiba di Gudang" (permission shipment.confirm_arrival).
 *
 * Pelanggan Langsung (walk-in): customer hands the package to Admin Gudang
 * directly — confirmed as Arrive at Gudang WITHOUT scanning. Admin Gudang can
 * also request a kurir pickup for a customer they know.
 *
 * Isi Gudang: per-gudang contents — packages currently held at each gudang
 * with counts (Admin Gudang sees all gudang; staff below Admin Gudang only
 * see their own gudang).
 */
export function GudangOpsPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "shipment.view"),
    confirmArrival: hasPermission(user, "shipment.confirm_arrival"),
    notifyMarketing: hasPermission(user, "shipment.notify_marketing"),
    requestPickup: hasPermission(user, "pickup.create"),
  };

  const { data, loading, reload } = useApiData<GudangWorkspace>(() => apiGet<GudangWorkspace>("/gudang"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [arrivalTask, setArrivalTask] = useState<GudangArrivalQueueItem | null>(null);
  const [walkInTask, setWalkInTask] = useState<GudangWalkInItem | null>(null);
  const [pickupTask, setPickupTask] = useState<GudangWalkInItem | null>(null);
  const [expandedWarehouse, setExpandedWarehouse] = useState<number | null>(null);
  const [notifyTask, setNotifyTask] = useState<{ id: number; masterCode: string; remaining: number } | null>(null);

  const scope = data?.scope;

  if (!can.view) {
    return <PageHeader title="Gudang" subtitle="Anda tidak memiliki izin melihat operasional gudang." />;
  }

  const kurirOptions = (options?.employees ?? [])
    .filter((e) => (e.position ?? "").toLowerCase().includes("kurir") || (e.position ?? "").toLowerCase().includes("courier"))
    .map((e) => ({ value: String(e.id), label: e.name }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gudang"
        subtitle={
          scope?.scoped
            ? `Operasional gudang — akses terbatas ke ${scope.warehouseName ?? "gudang Anda"}.`
            : "Kedatangan paket dari kurir, pelanggan langsung, dan isi tiap gudang."
        }
        icon={<WarehouseIcon className="h-5 w-5" />}
      />

      <Tabs defaultValue="arrivals">
        <TabsList className="w-full max-w-full overflow-x-auto sm:w-auto">
          <TabsTrigger value="arrivals" className="gap-1.5">
            <QrCode className="h-3.5 w-3.5" /> Kedatangan
            {data && data.arrivals.length > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{data.arrivals.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="walkin" className="gap-1.5">
            <Store className="h-3.5 w-3.5" /> Pelanggan Langsung
            {data && data.walkIns.length > 0 && (
              <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] font-bold text-foreground">{data.walkIns.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="contents" className="gap-1.5">
            <Package className="h-3.5 w-3.5" /> Isi Gudang
          </TabsTrigger>
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>

        {/* ---------------- Arrival queue ---------------- */}
        <TabsContent value="arrivals" className="mt-3 space-y-3">
          <p className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
            Paket-paket ini sudah <b>PICKED UP</b> oleh kurir dan sedang dibawa ke gudang. Scan setiap paket (kamera HP / reader tool / ketik
            manual — kode tidak ditampilkan), atau gunakan <b>Scan Semua Paket</b> untuk mode reader massal, lalu konfirmasi tiba di gudang.
          </p>
          <DataTable
            rows={data?.arrivals ?? []}
            loading={loading}
            emptyMessage="Tidak ada paket menunggu kedatangan — semua shipment PICKED_UP sudah diterima gudang."
            columns={[
              {
                key: "code",
                header: "Resi",
                primary: true,
                render: (a) => (
                  <div>
                    <a href={`#/shipments/${a.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                      {a.masterCode}
                    </a>
                    {a.pickupCode && <p className="text-[11px] text-muted-foreground">{a.pickupCode}</p>}
                  </div>
                ),
              },
              {
                key: "customer",
                header: "Customer & Rute",
                render: (a) => (
                  <div>
                    <p className="text-sm font-medium text-foreground">{a.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.origin} → {a.destination}
                    </p>
                    {a.kurirName && <p className="text-[11px] text-muted-foreground">kurir: {a.kurirName}</p>}
                  </div>
                ),
              },
              {
                key: "packages",
                header: "Paket Ter-scan",
                render: (a) => (
                  <div className="min-w-[92px]">
                    <p className="font-mono text-xs font-semibold">
                      {a.scannedCount}/{a.detailsCount}
                    </p>
                    <Progress value={a.detailsCount ? (a.scannedCount / a.detailsCount) * 100 : 0} className="mt-1 h-1.5" />
                  </div>
                ),
              },
              {
                key: "phys",
                header: "Berat & Volume",
                hideOnMobile: true,
                render: (a) => (
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(a.totalWeightKg)} kg · {a.totalVolumeM3.toFixed(3)} m³
                  </p>
                ),
              },
              {
                key: "payment",
                header: "Sisa Bayar",
                render: (a) =>
                  a.remainingAmount != null && a.remainingAmount > 0 ? (
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">{formatRupiah(a.remainingAmount)}</span>
                  ) : (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">Lunas</span>
                  ),
              },
              {
                key: "actions",
                header: "Aksi",
                render: (a) =>
                  can.confirmArrival ? (
                    <Button size="sm" className="h-7" onClick={() => setArrivalTask(a)}>
                      <ScanLine className="h-3.5 w-3.5" /> Terima / Scan
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  ),
              },
            ]}
          />
        </TabsContent>

        {/* ---------------- Walk-in ---------------- */}
        <TabsContent value="walkin" className="mt-3 space-y-3">
          <p className="rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2 text-xs text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
            Pelanggan datang langsung ke gudang dan menyerahkan paket — konfirmasi <b>Tiba di Gudang</b> tanpa scan. Admin Gudang juga bisa
            <b> meminta kurir pickup</b> untuk customer yang dikenal (shipment harus sudah dihitung harganya).
          </p>
          <DataTable
            rows={data?.walkIns ?? []}
            loading={loading}
            emptyMessage="Tidak ada shipment CREATED / READY_FOR_PICKUP di area gudang Anda."
            columns={[
              {
                key: "code",
                header: "Resi",
                primary: true,
                render: (w) => (
                  <a href={`#/shipments/${w.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                    {w.masterCode}
                  </a>
                ),
              },
              {
                key: "customer",
                header: "Customer & Rute",
                render: (w) => (
                  <div>
                    <p className="text-sm font-medium text-foreground">{w.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {w.origin} → {w.destination}
                    </p>
                  </div>
                ),
              },
              { key: "status", header: "Status", render: (w) => <StatusBadge status={w.status} /> },
              {
                key: "packages",
                header: "Paket",
                render: (w) => (
                  <span className="text-xs">
                    {w.detailsCount} paket · {formatNumber(w.totalWeightKg)} kg
                  </span>
                ),
              },
              {
                key: "price",
                header: "Harga",
                hideOnMobile: true,
                render: (w) =>
                  w.priceAmount != null ? <span className="text-xs font-semibold">{formatRupiah(w.priceAmount)}</span> : <span className="text-xs text-amber-600 dark:text-amber-400">belum dihitung</span>,
              },
              {
                key: "actions",
                header: "Aksi",
                render: (w) => (
                  <div className="flex flex-wrap gap-1.5">
                    {can.confirmArrival && (
                      <Button size="sm" variant="secondary" className="h-7" onClick={() => setWalkInTask(w)}>
                        <UserCheck className="h-3.5 w-3.5" /> Tiba di Gudang
                      </Button>
                    )}
                    {can.requestPickup && w.status === "READY_FOR_PICKUP" && (
                      <Button size="sm" className="h-7" onClick={() => setPickupTask(w)}>
                        <Truck className="h-3.5 w-3.5" /> Minta Pickup
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </TabsContent>

        {/* ---------------- Contents per gudang ---------------- */}
        <TabsContent value="contents" className="mt-3 space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(data?.warehouses ?? []).map((w) => (
              <Card key={w.id} className="gap-3">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span className="flex items-center gap-2">
                      <WarehouseIcon className="h-4 w-4 text-primary" /> {w.name}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{w.city ?? "—"}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/60 px-2 py-2">
                      <p className="text-lg font-bold text-foreground">{w.heldPackages}</p>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Paket</p>
                    </div>
                    <div className="rounded-lg bg-muted/60 px-2 py-2">
                      <p className="text-lg font-bold text-foreground">{w.heldShipments}</p>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Shipment</p>
                    </div>
                    <div className="rounded-lg bg-muted/60 px-2 py-2">
                      <p className="text-lg font-bold text-foreground">{formatNumber(w.heldWeightKg, 1)}</p>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">kg</p>
                    </div>
                  </div>
                  {w.customerSupportContact && (
                    <p className="text-[11px] text-muted-foreground">CS Gudang: {w.customerSupportContact}</p>
                  )}
                  {w.unpaidCount > 0 && (
                    <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      {w.unpaidCount} shipment masih ada sisa pembayaran
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setExpandedWarehouse(expandedWarehouse === w.id ? null : w.id)}
                  >
                    <ChevronDown className={cn("h-4 w-4 transition-transform", expandedWarehouse === w.id && "rotate-180")} />
                    {expandedWarehouse === w.id ? "Sembunyikan detail" : "Lihat detail kiriman"}
                  </Button>
                  {expandedWarehouse === w.id && (
                    <div className="space-y-1.5">
                      {w.shipments.length === 0 && <p className="text-center text-xs text-muted-foreground">Gudang kosong.</p>}
                      {w.shipments.map((s) => (
                        <div key={s.id} className="rounded-lg border bg-card px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <a href={`#/shipments/${s.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                              {s.masterCode}
                            </a>
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {s.stage === "origin" ? "gudang asal" : "gudang tujuan"}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {s.customerName} · {s.packages} paket · {formatNumber(s.weightKg)} kg · {s.volumeM3.toFixed(3)} m³
                          </p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            {s.remainingAmount != null && s.remainingAmount > 0 ? (
                              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">sisa {formatRupiah(s.remainingAmount)}</span>
                            ) : (
                              <span className="text-[11px] text-emerald-600 dark:text-emerald-400">lunas</span>
                            )}
                            {can.notifyMarketing && s.remainingAmount != null && s.remainingAmount > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => setNotifyTask({ id: s.id, masterCode: s.masterCode, remaining: s.remainingAmount ?? 0 })}
                              >
                                <Bell className="h-3 w-3" /> Notify Marketing
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          {(data?.warehouses ?? []).length === 0 && !loading && (
            <p className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
              Tidak ada gudang aktif — buat gudang di menu Master Gudang.
            </p>
          )}
        </TabsContent>

        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["shipment", "pickup", "delivery", "warehouse"]} />
        </TabsContent>
      </Tabs>

      {/* ---------------- Arrival scan dialog (remounts per task via key) ---------------- */}
      <ArrivalScanDialog
        key={arrivalTask ? `arr-${arrivalTask.id}` : "arr-none"}
        task={arrivalTask}
        warehouses={(options?.warehouses ?? []).map((w) => ({ id: w.id, name: w.name }))}
        scopedWarehouseId={scope?.scoped ? scope.warehouseId : null}
        onClose={() => setArrivalTask(null)}
        onDone={reload}
      />

      {/* ---------------- Walk-in confirm dialog ---------------- */}
      <WalkInDialog key={walkInTask ? `walk-${walkInTask.id}` : "walk-none"} task={walkInTask} warehouses={(options?.warehouses ?? []).map((w) => ({ id: w.id, name: w.name }))} scopedWarehouseId={scope?.scoped ? scope.warehouseId : null} onClose={() => setWalkInTask(null)} onDone={reload} />

      {/* ---------------- Request pickup dialog (remounts per task via key) ---------------- */}
      <RequestPickupDialog key={pickupTask ? `req-${pickupTask.id}` : "req-none"} task={pickupTask} kurirOptions={kurirOptions} onClose={() => setPickupTask(null)} onDone={reload} />

      {/* ---------------- Notify marketing dialog ---------------- */}
      <NotifyMarketingDialog key={notifyTask ? `notify-${notifyTask.id}` : "notify-none"} task={notifyTask} onClose={() => setNotifyTask(null)} onDone={reload} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Walk-in confirm dialog (no scanning)
// ---------------------------------------------------------------------------

function WalkInDialog({
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
            <Store className="h-5 w-5 text-primary" /> Pelanggan Langsung — {task?.masterCode ?? ""}
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

// ---------------------------------------------------------------------------
// Request pickup dialog (Admin Gudang, for a customer they know)
// ---------------------------------------------------------------------------

function RequestPickupDialog({
  task,
  kurirOptions,
  onClose,
  onDone,
}: {
  task: GudangWalkInItem | null;
  kurirOptions: { value: string; label: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [kurirId, setKurirId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !kurirId) return;
    setBusy(true);
    const ok = await runAction(
      () => apiPost("/pickups", { masterId: task.id, kurirId: Number(kurirId), notes: notes || null }),
      { success: `Pickup untuk ${task.masterCode} dibuat & kurir ditugaskan.` },
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
            <Truck className="h-5 w-5 text-primary" /> Minta Pickup — {task?.masterCode ?? ""}
          </DialogTitle>
          <DialogDescription>Admin Gudang meminta kurir menjemput paket customer yang sudah READY_FOR_PICKUP.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Kurir" htmlFor="g-req-kurir">
            <FormSelect value={kurirId} onValueChange={(v) => setKurirId(v)} placeholder="Pilih kurir…" options={kurirOptions} disabled={busy} />
          </Field>
          <Field label="Catatan (opsional)" htmlFor="g-req-notes">
            <Textarea id="g-req-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Instruksi untuk kurir…" disabled={busy} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <SubmitButton busy={busy}>Tugaskan Kurir</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Notify marketing dialog (unpaid shipment at gudang)
// ---------------------------------------------------------------------------

function NotifyMarketingDialog({
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
            <Bell className="h-5 w-5 text-primary" /> Notify Marketing — {task?.masterCode ?? ""}
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
