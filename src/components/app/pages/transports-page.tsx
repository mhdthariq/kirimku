"use client";

import { useMemo, useState } from "react";
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
import { apiDelete, apiGet, apiPost, hasPermission, type Transport, type Options } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ItemAuditDialog } from "@/components/app/item-audit-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransportFormDialog } from "@/components/app/transport-form-dialog";
import { GudangScopeBadge, GudangTabBanner, GudangTabsTriggers, gudangTabValue, parseGudangTabValue } from "@/components/app/gudang-tabs";

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

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(historyMode ? "all" : "all");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transport | null>(null);
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
    setDialogOpen(true);
  }

  function openEdit(t: Transport) {
    setEditing(t);
    setDialogOpen(true);
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

      <TransportFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={reload}
      />

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
