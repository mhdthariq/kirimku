"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Boxes,
  Calendar,
  CheckCircle2,
  Coins,
  Download,
  PackageSearch,
  Pencil,
  Plus,
  Route,
  Search,
  SlidersHorizontal,
  Users,
  Scale,
  Truck,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  apiDelete,
  apiGet,
  apiPost,
  hasPermission,
  type Transport,
  type Options,
} from "@/infrastructure/http/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ItemAuditDialog } from "@/components/app/item-audit-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import {
  formatDate,
  formatNumber,
  formatRupiah,
} from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransportFormDialog } from "@/components/app/transport-form-dialog";
import { CapacitySummaryInline } from "@/components/app/capacity-status-card";
import {
  GudangScopeBadge,
  GudangTabBanner,
  GudangTabsTriggers,
  gudangTabValue,
  parseGudangTabValue,
} from "@/components/app/gudang-tabs";

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
export function TransportsPage({
  historyMode = false,
}: {
  historyMode?: boolean;
}) {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "transport.view"),
    create: hasPermission(user, "transport.create"),
    depart: hasPermission(user, "transport.depart"),
    arrive: hasPermission(user, "transport.arrive"),
    complete: hasPermission(user, "transport.complete"),
    // Revise.md §14 — finalize partner transport settlements
    settle: hasPermission(user, "transport.settle"),
  };

  const { data, loading, reload } = useApiData<Transport[]>(
    () =>
      apiGet<Transport[]>(
        `/transports${historyMode ? "?history=true&mine=true" : ""}`,
      ),
    [historyMode],
  );
  const { data: options } = useApiData<Options>(
    () => apiGet<Options>("/options"),
    [],
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transport | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Transport | null>(null);
  const [confirmComplete, setConfirmComplete] = useState<Transport | null>(
    null,
  );

  // Owner per-gudang tabs: filter the fetched rows to the selected gudang.
  const isOwner = !!user?.isOwner;
  const gudangOptions = options?.warehouses ?? [];
  const activeGudangId = parseGudangTabValue(tab);

  const scopedTransports = useMemo(
    () =>
      (data ?? []).filter(
        (t) =>
          activeGudangId == null ||
          (t.gudangIds ?? []).includes(activeGudangId),
      ),
    [data, activeGudangId],
  );
  const statusOptions = historyMode
    ? ["all", "ARRIVED", "COMPLETED", "CANCELLED"]
    : ["all", "PLANNED", "DEPARTED", "ARRIVED", "COMPLETED"];
  const statusLabels: Record<string, string> = {
    all: "Semua",
    PLANNED: "Direncanakan",
    DEPARTED: "Dalam perjalanan",
    ARRIVED: "Tiba",
    COMPLETED: "Selesai",
    CANCELLED: "Dibatalkan",
  };
  const overview = [
    {
      label: "Total transport",
      count: scopedTransports.length,
      icon: Route,
      tone: "bg-primary/10 text-primary",
    },
    {
      label: "Direncanakan",
      count: scopedTransports.filter((t) => t.status === "PLANNED")
        .length,
      icon: Calendar,
      tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    },
    {
      label: "Dalam perjalanan",
      count: scopedTransports.filter((t) => t.status === "DEPARTED")
        .length,
      icon: Truck,
      tone: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    },
    {
      label: "Menunggu konfirmasi",
      count: scopedTransports.filter((t) => t.status === "ARRIVED")
        .length,
      icon: CheckCircle2,
      tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
  ];

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter(
      (t) =>
        (statusFilter === "all" || t.status === statusFilter) &&
        (activeGudangId == null ||
          (t.gudangIds ?? []).includes(activeGudangId)) &&
        (!q ||
          t.transportCode.toLowerCase().includes(q) ||
          (t.routeName ?? "").toLowerCase().includes(q) ||
          t.vehicleNumber.toLowerCase().includes(q) ||
          (t.origin ?? "").toLowerCase().includes(q) ||
          (t.destination ?? "").toLowerCase().includes(q) ||
          (t.driverName ?? "").toLowerCase().includes(q) ||
          (t.kenekName ?? "").toLowerCase().includes(q)),
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

  async function onComplete() {
    if (!confirmComplete) return;
    const target = confirmComplete;
    setConfirmComplete(null);
    const completing = target.status === "ARRIVED";
    const ok = await runAction(() => apiPost(`/transports/${target.id}/${completing ? "complete" : "arrive"}`), { success: `${target.transportCode} ${completing ? "diselesaikan" : "ditandai tiba"}.` });
    if (ok) reload();
  }

  async function onDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    const ok = await runAction(() => apiDelete(`/transports/${target.id}`), { success: "Transport dihapus." });
    if (ok) reload();
  }

  /** Export the filtered transport list to CSV, including capacity status
   *  (overall + per-dimension) — for reporting / offline analysis. */
  function exportCsv() {
    const header = [
      "kode", "status", "kendaraan", "rute", "koridor", "driver", "kenek",
      "shipment_count", "total_koli", "total_berat_kg", "total_volume_m3", "total_harga",
      "kapasitas_overall", "kapasitas_berat", "kapasitas_volume", "kapasitas_koli",
      "rencana_berangkat", "rencana_tiba",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((t) => [
      t.transportCode, t.status, t.vehicleNumber, t.routeName ?? "",
      `${t.origin ?? ""} → ${t.destination ?? ""}`,
      t.driverName ?? "", t.kenekName ?? "",
      t.shipmentCount, t.totalKoli ?? "", t.totalWeightKg, t.totalVolumeM3,
      t.totalPrice ?? "",
      t.capacity?.overallStatus ?? "",
      t.capacity?.weight.status ?? "", t.capacity?.volume.status ?? "", t.capacity?.koli.status ?? "",
      t.plannedDepartureAt ?? "", t.plannedArrivalAt ?? "",
    ].map(esc).join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transports-capacity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderActions(t: Transport) {
    return (
      <div className="flex flex-wrap items-center gap-2 [&_button]:min-h-10 [&_a]:min-h-10">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="mr-auto xl:mr-0"
        >
          <a href={`#/transports/${t.id}`}>
            Detail perjalanan <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </Button>
        <ItemAuditDialog
          entityType="transport"
          entityId={t.id}
          itemLabel={t.transportCode}
        />
        {t.status === "PLANNED" && can.depart && (
          <Button size="sm" onClick={() => onDepart(t)}>
            <Truck className="h-3.5 w-3.5" /> Depart
          </Button>
        )}
        {(t.status === "PLANNED" || t.status === "DEPARTED") &&
          can.arrive && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmComplete(t)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Tandai Tiba
            </Button>
          )}
        {t.status === "ARRIVED" && can.complete && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setConfirmComplete(t)}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Konfirmasi
            Completed
          </Button>
        )}
        {["ARRIVED", "COMPLETED"].includes(t.status) &&
          t.vehicleOwnerId != null &&
          !t.settlement &&
          can.settle && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                window.location.assign(
                  new URL(
                    "#/settlements",
                    window.location.href,
                  ).href,
                )
              }
            >
              <Coins className="h-3.5 w-3.5" /> Settle
            </Button>
          )}
        {t.status === "PLANNED" && can.create && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={() => openEdit(t)}
              aria-label={`Edit ${t.transportCode}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(t)}
              aria-label={`Hapus ${t.transportCode}`}
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    );
  }

  function renderTransportCard(t: Transport) {
    return (
      <article
        aria-label={`Transport ${t.transportCode}`}
        className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/20 p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background text-primary">
              <Truck className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <a
                href={`#/transports/${t.id}`}
                className="break-all font-mono text-sm font-semibold text-primary hover:underline"
              >
                {t.transportCode}
              </a>
              <p className="break-words text-xs text-muted-foreground">
                {t.vehicleNumber}
              </p>
            </div>
          </div>
          <StatusBadge status={t.status} />
        </div>
        <div className="flex-1 space-y-4 p-4 sm:p-5">
          <div className="relative space-y-4 pl-5 before:absolute before:bottom-2 before:left-[3px] before:top-2 before:border-l before:border-dashed before:border-primary/40">
            <div className="relative before:absolute before:-left-5 before:top-1.5 before:size-2 before:rounded-full before:border-2 before:border-primary before:bg-card">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Asal
              </p>
              <p className="break-words text-sm font-semibold">
                {t.origin ?? "Belum ditentukan"}
              </p>
            </div>
            <div className="relative before:absolute before:-left-5 before:top-1.5 before:size-2 before:rounded-full before:bg-primary">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tujuan
              </p>
              <p className="break-words text-sm font-semibold">
                {t.destination ?? "Belum ditentukan"}
              </p>
            </div>
          </div>
          {t.routeName && (
            <p className="break-words text-xs text-muted-foreground">
              Rute: {t.routeName}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-3">
            <div className="min-w-0">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="size-3.5 shrink-0" />{" "}
                Berangkat
              </dt>
              <dd className="mt-1 break-words text-xs font-medium">
                {t.plannedDepartureAt
                  ? formatDate(t.plannedDepartureAt, true)
                  : "Belum dijadwalkan"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                Estimasi tiba
              </dt>
              <dd className="mt-1 break-words text-xs font-medium">
                {t.plannedArrivalAt
                  ? formatDate(t.plannedArrivalAt, true)
                  : "Belum dijadwalkan"}
              </dd>
            </div>
            <div className="col-span-2 min-w-0 border-t pt-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" /> Kru perjalanan
              </dt>
              <dd className="mt-1 break-words text-xs font-medium">
                {t.driverName ?? "Driver belum ditentukan"}
                {t.kenekName ? ` · ${t.kenekName}` : ""}
              </dd>
            </div>
          </dl>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="min-w-0">
              <p className="text-muted-foreground">Shipment</p>
              <p className="mt-1 break-words font-semibold">
                {formatNumber(t.shipmentCount, 0)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground">Berat</p>
              <p className="mt-1 break-words font-semibold">
                {formatNumber(t.totalWeightKg, 1)} kg
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground">Volume</p>
              <p className="mt-1 break-words font-semibold">
                {formatNumber(t.totalVolumeM3, 2)} m³
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div>
              <p className="text-xs text-muted-foreground">
                Total harga muatan
              </p>
              <p className="mt-1 break-all text-sm font-semibold">
                {t.totalPrice != null
                  ? formatRupiah(t.totalPrice)
                  : "-"}
              </p>
            </div>
            {t.capacity && (
              <CapacitySummaryInline
                capacity={t.capacity}
                showRing
              />
            )}
          </div>
          {t.settlement && (
            <p className="break-words rounded-lg bg-primary/5 p-2.5 text-xs text-primary">
              {t.settlement.settlementCode} · +
              {formatRupiah(t.settlement.ownerAmount)} (
              {t.settlement.ownerPercent}%)
            </p>
          )}
        </div>
        <div className="border-t p-4">{renderActions(t)}</div>
      </article>
    );
  }

  if (!can.view) {
    return (
      <PageHeader
        title="Transport"
        subtitle="Anda tidak memiliki izin melihat transport."
      />
    );
  }

  const listTable = (
    <DataTable
      rows={rows}
      loading={loading}
      renderCard={renderTransportCard}
      desktopBreakpoint="xl"
      toolbar={
        <div className="w-full min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">
                {historyMode
                  ? "Riwayat perjalanan"
                  : "Daftar perjalanan"}
              </h2>
              <p
                role="status"
                className="mt-1 text-xs text-muted-foreground"
              >
                {loading
                  ? "Memuat transport…"
                  : `${rows.length} transport ditampilkan`}
              </p>
            </div>
            <div className="relative w-full sm:max-w-sm">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
              />
              <Input
                aria-label="Cari transport"
                placeholder="Cari kode, rute, nopol, atau kru…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 pl-9 text-base sm:text-sm"
              />
            </div>
          </div>
          <div className="flex items-start gap-3 border-t pt-4">
            <SlidersHorizontal
              aria-hidden="true"
              className="mt-3 hidden size-4 shrink-0 text-muted-foreground sm:block"
            />
            <div
              role="group"
              aria-label="Filter status transport"
              className="flex min-w-0 flex-wrap gap-2"
            >
              {statusOptions.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={
                    statusFilter === s
                      ? "default"
                      : "outline"
                  }
                  className="min-h-10 gap-2 rounded-lg px-3 text-xs"
                  aria-pressed={statusFilter === s}
                  onClick={() => setStatusFilter(s)}
                >
                  {statusLabels[s]}
                  <span className="rounded-md bg-background/20 px-1.5 py-0.5 text-[10px] tabular-nums">
                    {loading
                      ? "–"
                      : s === "all"
                       ? scopedTransports.length
                       : scopedTransports.filter(
                          (t) => t.status === s,
                        ).length}
                  </span>
                </Button>
              ))}
            </div>
          </div>
          {(search || statusFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
              }}
            >
              Reset filter
            </Button>
          )}
        </div>
      }
      emptyMessage={
        search || statusFilter !== "all"
          ? "Tidak ada transport yang cocok. Coba kata kunci atau status lain."
          : historyMode
           ? "Belum ada riwayat transport selesai."
           : "Belum ada transport. Rencanakan perjalanan pertama Anda."
      }
      emptyAction={
        search || statusFilter !== "all" ? (
          <Button
            variant="outline"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
          >
            Reset filter
          </Button>
        ) : can.create && !historyMode ? (
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Rencanakan Transport
          </Button>
        ) : undefined
      }
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
              <p className="text-[11px] text-muted-foreground">{t.routeName ?? "-"}</p>
            </div>
          ),
        },
        {
          key: "crew",
          header: "Kru",
          hideOnMobile: true,
          render: (t) => (
            <span className="text-sm text-muted-foreground">
              {t.driverName ?? "-"}{t.kenekName ? ` · ${t.kenekName}` : ""}
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
                {t.plannedDepartureAt ? formatDate(t.plannedDepartureAt, true) : "-"}
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
                <Coins className="h-3 w-3 text-primary" /> {t.totalPrice != null ? formatRupiah(t.totalPrice) : "-"}
              </p>
            </div>
          ),
        },
        {
          key: "capacity",
          header: "Kapasitas",
          hideOnMobile: true,
          render: (t) =>
            t.capacity ? (
              <CapacitySummaryInline capacity={t.capacity} showRing />
            ) : (
              <span className="text-[11px] text-muted-foreground">-</span>
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
            ) : t.vehicleOwnerId != null && ["ARRIVED", "COMPLETED"].includes(t.status) ? (
              <span className="text-[11px] font-medium text-chart-4">siap di-settle</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">-</span>
            ),
        },
        {
          key: "actions",
          header: "Aksi",
          render: renderActions,
        },
      ]}
    />
  );

  return (
    <div className="min-w-0 space-y-6">
      <section className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-primary/10 via-card to-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
          <Route className="size-4" /> Operasional linehaul
        </div>
        <div className="[&>div]:flex-col [&>div]:gap-5 [&>div]:2xl:flex-row [&>div>div:last-child]:w-full [&>div>div:last-child]:2xl:w-auto [&_button]:min-h-11">
          <PageHeader
            title={historyMode ? "Riwayat Transport" : "Transport"}
            subtitle={
              historyMode
                ? "Transport selesai yang pernah Anda jalani sebagai driver/kenek."
                : "Rencanakan keberangkatan, pantau perjalanan, dan kelola muatan antar gudang dalam satu tempat."
            }
            icon={<Route className="h-5 w-5" />}
            actions={
              <>
                {!isOwner && !historyMode && (
                  <GudangScopeBadge
                    gudangName={user?.warehouseName ?? null}
                  />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCsv}
                  disabled={rows.length === 0}
                >
                  <Download className="h-4 w-4" /> Export CSV
                </Button>
                {can.create && !historyMode && (
                  <Button
                    onClick={openCreate}
                    className="w-full sm:w-auto"
                  >
                    <Plus className="h-4 w-4" /> Rencanakan
                    Transport
                  </Button>
                )}
              </>
            }
          />
        </div>
        <p className="mt-5 border-t border-primary/10 pt-4 text-xs leading-relaxed text-muted-foreground">
          Kedatangan terdeteksi otomatis saat kru check-in di
          checkpoint akhir.
        </p>
      </section>

      <section
        aria-label="Ringkasan transport"
        className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {overview.map(({ label, count, icon: Icon, tone }) => (
          <div
            key={label}
            className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5"
          >
            <span
              className={`mb-3 inline-flex size-9 items-center justify-center rounded-xl ${tone}`}
            >
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <p className="text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">
              {loading ? "–" : formatNumber(count, 0)}
            </p>
            <p className="mt-1 break-words text-xs text-muted-foreground sm:text-sm">
              {label}
            </p>
          </div>
        ))}
      </section>

      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <div className="min-w-0 max-w-full overflow-x-auto pb-1">
          <TabsList className="h-11 w-max min-w-full justify-start gap-1 rounded-xl p-1 sm:min-w-0 [&_button]:min-h-9 [&_button]:shrink-0">
            <TabsTrigger value="list">
              {historyMode ? "Riwayat" : "Daftar"}
            </TabsTrigger>
            {isOwner && !historyMode && (
              <GudangTabsTriggers warehouses={gudangOptions} />
            )}
            {!historyMode && (
              <TabsTrigger value="activity">
                Log Aktivitas
              </TabsTrigger>
            )}
          </TabsList>
        </div>
        {[
          "list",
          ...(isOwner && !historyMode
            ? gudangOptions.map((g) => gudangTabValue(g.id))
            : []),
        ].map((v) => {
          const activeW =
            gudangOptions.find((g) => gudangTabValue(g.id) === v) ??
            null;
          return (
            <TabsContent
              key={v}
              value={v}
              className="mt-4 min-w-0 space-y-4"
            >
              {activeW && (
                <GudangTabBanner
                  gudangName={activeW.name}
                  count={rows.length}
                />
              )}
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

      <AlertDialog open={!!confirmComplete} onOpenChange={(open) => !open && setConfirmComplete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmComplete?.status === "ARRIVED" ? "Konfirmasi Completed" : "Tandai tiba"} transport {confirmComplete?.transportCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmComplete?.status === "ARRIVED"
                ? "Auditor terpisah mengonfirmasi transport ARRIVED menjadi COMPLETED setelah memeriksa perjalanan."
                : "Tindakan ini menandai transport ARRIVED, bukan COMPLETED. Transport tetap menunggu konfirmasi auditor terpisah. Untuk transport PLANNED, tindakan ini melewati aturan keberangkatan; lanjutkan hanya jika diperlukan."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onComplete}>
              {confirmComplete?.status === "ARRIVED" ? "Ya, Konfirmasi Completed" : "Ya, Tandai Tiba"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
