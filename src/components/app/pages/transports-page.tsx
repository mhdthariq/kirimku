"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Boxes,
  Calendar,
  Coins,
  PackageSearch,
  Pencil,
  Plus,
  Route,
  Scale,
  Truck,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Transport, type Options, type Shipment } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ItemAuditDialog } from "@/components/app/item-audit-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, FormSelect, SubmitButton, Textarea, formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GudangScopeBadge, GudangTabBanner, GudangTabsTriggers, gudangTabValue, parseGudangTabValue } from "@/components/app/gudang-tabs";

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
  notes: string;
}

const EMPTY: TransportForm = {
  routeId: "", vehicleId: "", driverId: "", kenekId: "",
  origin: "", destination: "", plannedDepartureAt: "", plannedArrivalAt: "",
  shipmentIds: [], notes: "",
};

/** datetime-local value (local timezone) for a Date. */
function toLocalInput(d: Date | null | undefined): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Transports list (Revision Parts I/J/M/N):
 * - Road-style Route icon instead of the old chart/transport glyph (Part I)
 * - planning fields on create/edit: origin, destination, planned departure &
 *   arrival (Part J)
 * - aggregate columns: shipment count, Total Berat, Total Volume, Total Price
 *   computed by backend database aggregation (Part M/L)
 * - NO manual "Arrived" button (Part N) — arrival is auto-detected when the
 *   crew checks in inside the final checkpoint radius (see detail page).
 */
export function TransportsPage({ historyMode = false }: { historyMode?: boolean }) {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "transport.view"),
    create: hasPermission(user, "transport.create"),
    depart: hasPermission(user, "transport.depart"),
    // Revise.md §14 — finalize partner transport settlements
    settle: hasPermission(user, "transport.settle"),
  };

  const { data, loading, reload } = useApiData<Transport[]>(
    () => apiGet<Transport[]>(`/transports${historyMode ? "?history=true&mine=true" : ""}`),
    [historyMode],
  );
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [readyShipments, setReadyShipments] = useState<Shipment[]>([]);

  useEffect(() => {
    if (!can.create || historyMode) return;
    apiGet<Shipment[]>("/shipments?status=RECEIVED_AT_GUDANG")
      .then(setReadyShipments)
      .catch(() => undefined);
  }, [can.create, data, historyMode]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(historyMode ? "all" : "all");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transport | null>(null);
  const [form, setForm] = useState<TransportForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Transport | null>(null);

  // Owner per-gudang tabs: filter the fetched rows to the selected gudang.
  const isOwner = !!user?.isOwner;
  const gudangOptions = options?.warehouses ?? [];
  const activeGudangId = parseGudangTabValue(tab);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (t) =>
        (statusFilter === "all" || t.status === statusFilter) &&
        (activeGudangId == null || (t.gudangIds ?? []).includes(activeGudangId)) &&
        (!q ||
          t.transportCode.toLowerCase().includes(q) ||
          (t.routeName ?? "").toLowerCase().includes(q) ||
          t.vehicleNumber.toLowerCase().includes(q) ||
          (t.origin ?? "").toLowerCase().includes(q) ||
          (t.destination ?? "").toLowerCase().includes(q)),
    );
  }, [data, search, statusFilter, activeGudangId]);

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
      origin: t.origin ?? "",
      destination: t.destination ?? "",
      plannedDepartureAt: toLocalInput(t.plannedDepartureAt ? new Date(t.plannedDepartureAt) : null),
      plannedArrivalAt: toLocalInput(t.plannedArrivalAt ? new Date(t.plannedArrivalAt) : null),
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
      setDialogOpen(false);
      reload();
    }
  }

  async function onDepart(t: Transport) {
    const ok = await runAction(() => apiPost(`/transports/${t.id}/depart`), { success: `${t.transportCode} berangkat.` });
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
    return <PageHeader title="Transport" subtitle="Anda tidak memiliki izin melihat transport." />;
  }

  const employeeOptions = (options?.employees ?? []).map((e) => ({ value: String(e.id), label: `${e.name}${e.position ? ` — ${e.position}` : ""}` }));
  const routeOptions = (options?.routes ?? []).map((r) => ({ value: String(r.id), label: r.name }));

  // auto-fill origin/destination from the selected route (still editable)
  const selectedRouteMeta = options?.routes?.find((r) => String(r.id) === form.routeId);

  const listTable = (
    <DataTable
      rows={rows}
      loading={loading}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Cari kode / rute / nopol…"
      toolbar={
        <div className="flex max-w-full flex-wrap items-center gap-1.5">
          {["all", ...(historyMode ? ["ARRIVED", "CANCELLED"] : ["PLANNED", "DEPARTED", "ARRIVED"])].map((s) => (
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
      emptyMessage={historyMode ? "Belum ada riwayat transport selesai." : "Belum ada transport. Klik “Rencanakan Transport” untuk menjadwalkan linehaul."}
      columns={[
        {
          key: "code",
          header: "Kode / Kendaraan",
          primary: true,
          render: (t) => (
            <a href={`#/transports/${t.id}`} className="group block">
              <p className="font-mono text-xs font-semibold text-primary group-hover:underline">{t.transportCode}</p>
              <p className="text-xs text-muted-foreground">{t.vehicleNumber}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-foreground/80 group-hover:text-primary">
                Detail <ArrowRight className="h-3 w-3" />
              </p>
            </a>
          ),
        },
        {
          key: "route",
          header: "Koridor / Rute",
          render: (t) => (
            <div>
              <p className="text-sm font-medium text-foreground">
                {t.origin ?? "?"} → {t.destination ?? "?"}
              </p>
              <p className="text-[11px] text-muted-foreground">{t.routeName ?? "—"}</p>
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
        {
          key: "schedule",
          header: "Jadwal",
          hideOnMobile: true,
          render: (t) => (
            <div>
              <p className="flex items-center gap-1 text-xs text-foreground">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                {t.plannedDepartureAt ? formatDate(t.plannedDepartureAt, true) : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {t.plannedArrivalAt ? `→ tiba ${formatDate(t.plannedArrivalAt, true)}` : t.departedAt ? `berangkat ${formatDate(t.departedAt, true)}` : ""}
              </p>
            </div>
          ),
        },
        {
          key: "totals",
          header: "Muatan (Berat · Volume · Harga)",
          render: (t) => (
            <div className="space-y-0.5">
              <p className="flex items-center gap-1.5 text-xs text-foreground">
                <Boxes className="h-3 w-3 text-muted-foreground" />
                <strong>{formatNumber(t.shipmentCount, 0)}</strong> shipment · {formatNumber(t.shipments.reduce((s, x) => s + x.packages, 0), 0)} paket
              </p>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Scale className="h-3 w-3" /> {formatNumber(t.totalWeightKg, 1)} KG · <PackageSearch className="h-3 w-3" /> {formatNumber(t.totalVolumeM3, 2)} M³
              </p>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <Coins className="h-3 w-3 text-primary" /> {t.totalPrice != null ? formatRupiah(t.totalPrice) : "—"}
              </p>
            </div>
          ),
        },
        { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status} /> },
        {
          key: "settlement",
          header: "Settlement",
          hideOnMobile: true,
          render: (t) =>
            t.settlement ? (
              <div>
                <p className="font-mono text-[11px] font-semibold">{t.settlement.settlementCode}</p>
                <p className="text-[11px] text-primary">+{formatRupiah(t.settlement.ownerAmount)} ({t.settlement.ownerPercent}%)</p>
              </div>
            ) : t.vehicleOwnerId != null && t.status === "ARRIVED" ? (
              <span className="text-[11px] font-medium text-chart-4">siap di-settle</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">—</span>
            ),
        },
        {
          key: "actions",
          header: "Aksi",
          render: (t) => (
            <div className="flex flex-wrap gap-1.5">
                <ItemAuditDialog entityType="transport" entityId={t.id} itemLabel={t.transportCode} />
              <Button asChild variant="outline" size="sm" className="h-7">
                <a href={`#/transports/${t.id}`}>
                  <Route className="h-3.5 w-3.5" /> Detail
                </a>
              </Button>
              {t.status === "PLANNED" && can.depart && (
                <Button size="sm" className="h-7" onClick={() => onDepart(t)}>
                  <Truck className="h-3.5 w-3.5" /> Depart
                </Button>
              )}
              {/* Revise.md §14/§15 — settle ARRIVED partner transports (credits
                  the Vehicle Owner wallet atomically) */}
              {t.status === "ARRIVED" && t.vehicleOwnerId != null && !t.settlement && can.settle && (
                <Button size="sm" variant="secondary" className="h-7" onClick={() => window.location.assign("#/settlements")}>
                  <Coins className="h-3.5 w-3.5" /> Settle
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
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={historyMode ? "Riwayat Transport" : "Transport"}
        subtitle={
          historyMode
            ? "Transport selesai yang pernah Anda jalani sebagai driver/kenek."
            : "Perjalanan linehaul antar gudang mengikuti rute checkpoint — tiba terdeteksi otomatis lewat check-in checkpoint akhir."
        }
        icon={<Route className="h-5 w-5" />}
        actions={
          <>
            {!isOwner && !historyMode && <GudangScopeBadge gudangName={user?.warehouseName ?? null} />}
            {can.create && !historyMode && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> Rencanakan Transport
              </Button>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">{historyMode ? "Riwayat" : "Daftar"}</TabsTrigger>
          {isOwner && !historyMode && <GudangTabsTriggers warehouses={gudangOptions} />}
          {!historyMode && <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>}
        </TabsList>
        {["list", ...(isOwner && !historyMode ? gudangOptions.map((g) => gudangTabValue(g.id)) : [])].map((v) => {
          const activeW = gudangOptions.find((g) => gudangTabValue(g.id) === v) ?? null;
          return (
            <TabsContent key={v} value={v} className="mt-3 space-y-3">
              {activeW && <GudangTabBanner gudangName={activeW.name} count={rows.length} />}
              {listTable}
            </TabsContent>
          );
        })}
        {!historyMode && (
          <TabsContent value="activity" className="mt-3">
            <ActivityLogPanel entityTypes={["transport"]} />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Transport — ${editing.transportCode}` : "Rencanakan Transport"}</DialogTitle>
            <DialogDescription>
              {editing ? "Hanya transport PLANNED yang bisa diubah." : "Pilih rute (wajib ≥ 3 checkpoint), kendaraan, kru, jadwal, dan shipment yang dimuat."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rute" htmlFor="t-route">
                <FormSelect
                  value={form.routeId}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      routeId: v,
                      origin: f.origin || options?.routes?.find((r) => String(r.id) === v)?.origin || "",
                      destination: f.destination || options?.routes?.find((r) => String(r.id) === v)?.destination || "",
                    }))
                  }
                  placeholder="Pilih rute"
                  options={routeOptions}
                  disabled={busy}
                />
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
              <Field label="Kenek (opsional)" htmlFor="t-kenek">
                <FormSelect value={form.kenekId} onValueChange={(v) => setForm({ ...form, kenekId: v })} placeholder="Pilih kenek" options={employeeOptions} disabled={busy} />
              </Field>
              <Field label="Asal (Origin)" htmlFor="t-origin">
                <input
                  id="t-origin"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                  value={form.origin}
                  onChange={(e) => setForm({ ...form, origin: e.target.value })}
                  placeholder={selectedRouteMeta?.origin ?? "mis. Medan"}
                  disabled={busy}
                />
              </Field>
              <Field label="Tujuan (Destination)" htmlFor="t-destination">
                <input
                  id="t-destination"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                  value={form.destination}
                  onChange={(e) => setForm({ ...form, destination: e.target.value })}
                  placeholder={selectedRouteMeta?.destination ?? "mis. Banda Aceh"}
                  disabled={busy}
                />
              </Field>
              <Field label="Rencana Berangkat" htmlFor="t-planned-dep">
                <input
                  id="t-planned-dep"
                  type="datetime-local"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                  value={form.plannedDepartureAt}
                  onChange={(e) => setForm({ ...form, plannedDepartureAt: e.target.value })}
                  disabled={busy}
                />
              </Field>
              <Field label="Rencana Tiba" htmlFor="t-planned-arr">
                <input
                  id="t-planned-arr"
                  type="datetime-local"
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
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Rencanakan Transport"}</SubmitButton>
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
