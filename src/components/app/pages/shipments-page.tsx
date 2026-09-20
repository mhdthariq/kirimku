"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Calculator,
  Package,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Route as RouteIcon,
  ScanLine,
  Send,
  Trash2,
  Truck,
  UserCheck,
  UserRound,
  Warehouse,
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
  type GudangArrivalQueueItem,
  type GudangTransportArrivalItem,
  type GudangWalkInItem,
  type GudangWorkspace,
  type Options,
  type Shipment,
  type TrackingEvent,
} from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ItemAuditDialog } from "@/components/app/item-audit-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { ResiPrint } from "@/components/app/resi-print";
import { ArrivalScanDialog } from "@/components/app/arrival-scan-dialog";
import { WalkInDialog } from "@/components/app/walk-in-dialog";
import { GudangScopeBadge, GudangTabBanner, GudangTabsTriggers, gudangTabValue, parseGudangTabValue } from "@/components/app/gudang-tabs";
import { Field, FormSelect, Input, NumberInput, SubmitButton, Textarea, formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface ShipmentForm {
  customerId: string;
  tariffId: string;
  originWarehouseId: string;
  destinationWarehouseId: string;
  // Revise round 8 — Fulfillment Mode. "STANDARD" = the existing
  // kurir → company warehouse → transport → destination warehouse →
  // kurir delivery flow. "DIRECT" = driver picks up directly at the
  // origin warehouse and delivers directly to the destination warehouse.
  fulfillmentMode: "STANDARD" | "DIRECT";
  penerimaName: string;
  penerimaAddress: string;
  penerimaContact: string;
  // Pengirim (sender) — auto-filled from Customer but fully editable
  pengirimName: string;
  pengirimPhone: string;
  pengirimEmail: string;
  pengirimAddress: string;
  discountAmount: string;
  insuranceAmount: string;
}

interface DetailForm {
  description: string;
  quantity: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  // Revise round 11 — optional direct volume entry (m³). When set, used
  // directly instead of computing L×W×H/1.000.000. Lets the user skip
  // dimensions for irregularly-shaped packages.
  volumeM3: string;
  actualWeightKg: string;
}

const EMPTY_SHIPMENT: ShipmentForm = {
  customerId: "",
  tariffId: "",
  originWarehouseId: "",
  destinationWarehouseId: "",
  // Revise round 8 — default to STANDARD (existing flow).
  fulfillmentMode: "STANDARD",
  penerimaName: "",
  penerimaAddress: "",
  penerimaContact: "",
  pengirimName: "",
  pengirimPhone: "",
  pengirimEmail: "",
  pengirimAddress: "",
  discountAmount: "",
  insuranceAmount: "",
};
const EMPTY_DETAIL: DetailForm = { description: "", quantity: "1", lengthCm: "", widthCm: "", heightCm: "", volumeM3: "", actualWeightKg: "" };

/** Row type for the "Ringkas" (grouped) detail view — pure UI aggregation. */
interface DetailGroupRow {
  id: string;
  description: string;
  dims: string;
  // Revise round 11 — per-group volume (m³). Computed from L×W×H OR the
  // explicit volumeM3 field if dimensions are absent.
  volumeM3: number;
  quantity: number;
  weightKg: number;
  totalKg: number;
}

export function ShipmentsPage({ shipmentId, autoPrint }: { shipmentId: number | null; autoPrint?: boolean }) {
  return shipmentId != null ? <ShipmentDetail id={shipmentId} autoPrint={autoPrint} /> : <ShipmentList />;
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
    confirmArrival: hasPermission(user, "shipment.confirm_arrival"),
    // Cetak Resi is permission-gated: only Admin Gudang & the Owner for now —
    // users without it never see the print buttons.
    printResi: hasPermission(user, "shipment.print_resi"),
    // The Log Aktivitas tab reads the audit trail — hidden entirely for users
    // without audit_log.view (e.g. Marketing) so they never see an empty log.
    viewLog: hasPermission(user, "audit_log.view"),
  };

  const { data, loading, reload } = useApiData<Shipment[]>(() => apiGet<Shipment[]>("/shipments"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  // Gudang workspace (scope + live scan progress) — only loaded for users who
  // can confirm arrivals, so the "Picked Up" rows can be scanned directly.
  const { data: gudang, reload: reloadGudang } = useApiData<GudangWorkspace>(
    () => (can.confirmArrival ? apiGet<GudangWorkspace>("/gudang") : Promise.resolve(null as unknown as GudangWorkspace)),
    [can.confirmArrival],
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("regular");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ShipmentForm>(EMPTY_SHIPMENT);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Shipment | null>(null);
  const [scanPickerOpen, setScanPickerOpen] = useState(false);
  const [rowScanTask, setRowScanTask] = useState<GudangArrivalQueueItem | null>(null);
  const [rowTransportTask, setRowTransportTask] = useState<GudangTransportArrivalItem | null>(null);

  // Owner per-gudang tabs (Regular | Direct | Gudang A | Gudang B | … | Log Aktivitas):
  // - "regular" = all STANDARD shipments (the existing flow).
  // - "direct"  = all DIRECT shipments (the new driver-direct flow).
  // - "wh-{id}" = STANDARD shipments belonging to that specific gudang.
  //   Owner's per-gudang tabs do NOT include DIRECT shipments — DIRECT
  //   shipments live only in the Direct tab so they aren't merged into
  //   the regular per-gudang view.
  // Non-owner users see Regular | Direct only — their data is already
  // scoped server-side to their own gudang.
  const isOwner = !!user?.isOwner;
  const gudangOptions = options?.warehouses ?? [];
  const activeGudangId = parseGudangTabValue(tab);
  const isRegularTab = tab === "regular";
  const isDirectTab = tab === "direct";

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (s) =>
        (statusFilter === "all" || s.status === statusFilter) &&
        // Revise round 8 — Fulfillment Mode filter:
        //  - "regular" tab → only STANDARD
        //  - "direct"  tab → only DIRECT
        //  - per-gudang tab (owner) → only STANDARD + that gudang
        //    (DIRECT shipments are NOT merged into per-gudang tabs)
        (isRegularTab ? (s.fulfillmentMode ?? "STANDARD") === "STANDARD" : true) &&
        (isDirectTab ? (s.fulfillmentMode ?? "STANDARD") === "DIRECT" : true) &&
        (activeGudangId == null
          ? true
          : (s.gudangIds ?? []).includes(activeGudangId) &&
            // per-gudang tab never includes DIRECT
            (s.fulfillmentMode ?? "STANDARD") === "STANDARD") &&
        (!q ||
          s.masterCode.toLowerCase().includes(q) ||
          (s.customer?.name ?? "").toLowerCase().includes(q) ||
          s.origin.toLowerCase().includes(q) ||
          s.destination.toLowerCase().includes(q) ||
          (s.penerimaName ?? "").toLowerCase().includes(q)),
    );
  }, [data, search, statusFilter, activeGudangId, isRegularTab, isDirectTab]);

  /** Auto-pick Gudang Asal & Gudang Tujuan from the selected rute (tariff):
   *  the warehouse whose city matches the tariff's origin/destination is
   *  preselected — still changeable by the user. */
  function onTariffChange(v: string) {
    const tariff = (options?.tariffs ?? []).find((t) => String(t.id) === v) ?? null;
    const cityMatch = (city: string | null | undefined) => {
      const key = (city ?? "").trim().toLowerCase();
      if (!key) return "";
      const wh = (options?.warehouses ?? []).find((w) => (w.city ?? "").trim().toLowerCase() === key);
      return wh ? String(wh.id) : "";
    };
    setForm((f) => ({
      ...f,
      tariffId: v,
      // auto-filled from the route (cleared when the route's city has no
      // gudang yet) — the user can still change either gudang afterwards
      originWarehouseId: tariff ? cityMatch(tariff.origin) : f.originWarehouseId,
      destinationWarehouseId: tariff ? cityMatch(tariff.destination) : f.destinationWarehouseId,
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerId) {
      toast.error("Pilih customer terlebih dahulu.");
      return;
    }
    if (!form.tariffId) {
      toast.error("Pilih rute (tarif) untuk shipment ini.");
      return;
    }
    // --- Verification: pengirim & penerima tidak boleh identik ----------
    // Bandingkan nama + kontak + alamat (case-insensitive, trim whitespace).
    // Jika semua field yang dimiliki keduanya sama persis, blok submission
    // dan minta user memperbaiki — pengiriman ke diri sendiri tidak masuk akal.
    const norm = (v: string) => (v ?? "").trim().toLowerCase();
    const senderName = norm(form.pengirimName);
    const receiverName = norm(form.penerimaName);
    const senderContact = norm(form.pengirimPhone);
    const receiverContact = norm(form.penerimaContact);
    const senderAddress = norm(form.pengirimAddress);
    const receiverAddress = norm(form.penerimaAddress);

    const nameSame = senderName && receiverName && senderName === receiverName;
    const contactSame = senderContact && receiverContact && senderContact === receiverContact;
    const addressSame = senderAddress && receiverAddress && senderAddress === receiverAddress;

    if (nameSame && contactSame && addressSame) {
      toast.error("Data Pengirim dan Penerima identik. Pengiriman ke diri sendiri tidak diperbolehkan — ubah minimal nama, kontak, atau alamat penerima.");
      return;
    }
    if (nameSame && contactSame) {
      const proceed = window.confirm(
        "Nama dan kontak Pengirim & Penerima terlihat sama. Pastikan penerima benar-benar pihak yang berbeda (contoh: bagian gudang, keluarga, dsb.). Lanjutkan?",
      );
      if (!proceed) return;
    }
    setBusy(true);
    const payload = {
      customerId: Number(form.customerId),
      tariffId: Number(form.tariffId),
      originWarehouseId: form.originWarehouseId ? Number(form.originWarehouseId) : null,
      destinationWarehouseId: form.destinationWarehouseId ? Number(form.destinationWarehouseId) : null,
      // Revise round 8 — Fulfillment Mode (STANDARD / DIRECT).
      fulfillmentMode: form.fulfillmentMode,
      penerimaName: form.penerimaName || null,
      // Revise.md §6 — discount entered as AMOUNT; % derived by the backend
      discountAmount: form.discountAmount ? Number(form.discountAmount) : 0,
      insuranceAmount: form.insuranceAmount ? Number(form.insuranceAmount) : 0,
      penerimaAddress: form.penerimaAddress || null,
      penerimaContact: form.penerimaContact || null,
      // Pengirim (sender) — auto-filled from Customer on the client but
      // still editable, so send the (possibly edited) values verbatim.
      pengirimName: form.pengirimName || null,
      pengirimPhone: form.pengirimPhone || null,
      pengirimEmail: form.pengirimEmail || null,
      pengirimAddress: form.pengirimAddress || null,
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

  /** Open the arrival-scan dialog straight from a PICKED_UP row (kurir drop-off). */
  function openRowScan(s: Shipment) {
    const live = gudang?.arrivals.find((a) => a.id === s.id);
    setRowScanTask(
      live ?? {
        id: s.id,
        masterCode: s.masterCode,
        customerName: s.customer?.name ?? "—",
        customerPhone: s.customer?.phone ?? null,
        origin: s.origin,
        destination: s.destination,
        originWarehouseId: s.originWarehouseId ?? null,
        destinationWarehouseId: s.destinationWarehouseId ?? null,
        priceAmount: s.priceAmount,
        paidAmount: s.paymentSummary?.paidAmount ?? 0,
        remainingAmount: s.paymentSummary?.remainingAmount ?? null,
        dpOk: s.paymentSummary?.dpOk ?? false,
        penerimaName: s.penerimaName ?? null,
        detailsCount: s.totals?.totalPackages ?? s._count?.details ?? 0,
        totalWeightKg: s.totals?.totalActualKg ?? 0,
        totalVolumeM3: s.totals?.totalVolumeM3 ?? 0,
        scannedCount: 0,
        scannedByMethod: { SCANNED: 0, TYPED: 0 },
        pickupCode: null,
        kurirName: null,
        updatedAt: s.createdAt,
      },
    );
  }

  /** Open the transport-arrival scan dialog straight from an ARRIVED_AT_GUDANG
   *  row (driver drop-off from another gudang — awaiting Admin Gudang scan). */
  function openRowTransportScan(s: Shipment) {
    const live = gudang?.transportArrivals.find((a) => a.id === s.id);
    setRowTransportTask(
      live ?? {
        id: s.id,
        masterCode: s.masterCode,
        customerName: s.customer?.name ?? "—",
        customerPhone: s.customer?.phone ?? null,
        origin: s.origin,
        destination: s.destination,
        originWarehouseId: s.originWarehouseId ?? null,
        destinationWarehouseId: s.destinationWarehouseId ?? null,
        arrivedWarehouseId: s.arrivedWarehouseId ?? null,
        originWarehouseName: s.originWarehouseName ?? null,
        transportCode: null,
        driverName: null,
        kenekName: null,
        penerimaName: s.penerimaName ?? null,
        detailsCount: s.totals?.totalPackages ?? s._count?.details ?? 0,
        totalWeightKg: s.totals?.totalActualKg ?? 0,
        totalVolumeM3: s.totals?.totalVolumeM3 ?? 0,
        scannedCount: 0,
        updatedAt: s.createdAt,
      },
    );
  }

  if (!can.view) {
    return <PageHeader title="Shipments" subtitle="Anda tidak memiliki izin melihat shipment." />;
  }

  // Route dropdown — only tariffs matching the selected customer's B2B/B2C label
  const selectedCustomer = (options?.customers ?? []).find((c) => String(c.id) === form.customerId) ?? null;
  const routeOptions = (options?.tariffs ?? [])
    .filter((t) => {
      const now = Date.now();
      const startsAt = new Date(t.effectiveFrom).getTime();
      const endsAt = t.effectiveTo ? new Date(t.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      return (
        startsAt <= now &&
        endsAt >= now &&
        (!selectedCustomer || !t.customerType || t.customerType === selectedCustomer.type)
      );
    })
    .map((t) => ({
      value: String(t.id),
      label: `${t.origin} → ${t.destination} · ${t.customerType ? t.customerType.toUpperCase() : "SEMUA"} · Rp${formatNumber(t.ratePerKg, 0)}/kg`,
    }));
  const selectedTariff = (options?.tariffs ?? []).find((t) => String(t.id) === form.tariffId) ?? null;
  const canAddDiscount = user?.partnerType === "MARKETING" || can.confirmArrival;
  const discountIsMarketingFunded = user?.partnerType === "MARKETING";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shipments"
        subtitle="Master shipment beserta lifecycle CREATED → DELIVERED."
        icon={<Package className="h-5 w-5" />}
        actions={
          <>
            {!isOwner && <GudangScopeBadge gudangName={user?.warehouseName ?? null} />}
            {can.confirmArrival && (
              <Button variant="outline" onClick={() => setScanPickerOpen(true)}>
                <ScanLine className="h-4 w-4" /> Scan Kedatangan
              </Button>
            )}
            {can.create && (
              <Button onClick={() => { setForm(EMPTY_SHIPMENT); setDialogOpen(true); }}>
                <Plus className="h-4 w-4" /> Buat Shipment
              </Button>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {/* Revise round 8 — Regular / Direct top-level tabs.
              "Regular" = STANDARD fulfillment (kurir → gudang → transport → gudang → kurir).
              "Direct"  = DIRECT fulfillment (driver picks up at origin warehouse → delivers to destination).
              These two tabs are visible to every role with shipment.view.
              The owner additionally gets per-gudang tabs AFTER these two —
              per-gudang tabs show only STANDARD shipments (DIRECT stays in the Direct tab
              so the per-gudang view doesn't accidentally mix in DIRECT shipments). */}
          <TabsTrigger value="regular">Regular</TabsTrigger>
          <TabsTrigger value="direct">Direct</TabsTrigger>
          {isOwner && <GudangTabsTriggers warehouses={gudangOptions} />}
          {/* Log Aktivitas reads the audit trail — hidden for users without
              audit_log.view (e.g. Marketing) so they never see an empty log. */}
          {can.viewLog && <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>}
        </TabsList>
        {["regular", "direct", ...(isOwner ? gudangOptions.map((g) => gudangTabValue(g.id)) : [])].map((v) => {
          const activeW = gudangOptions.find((g) => gudangTabValue(g.id) === v) ?? null;
          return (
            <TabsContent key={v} value={v} className="mt-3 space-y-3">
              {/* Revise round 9 — trimmed the over-explained banners.
                  Each banner is now a single short line. */}
              {activeW && (
                <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-foreground/80">
                  Gudang <b>{activeW.name}</b> — Regular only.
                </p>
              )}
              {statusFilter === "PICKED_UP" && can.confirmArrival && (
                <p className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-1.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
                  Shipment <b>PICKED UP</b> — klik <b>Terima / Scan</b> untuk konfirmasi kedatangan paket di gudang.
                </p>
              )}
              {(statusFilter === "AT_DEST_GUDANG" || statusFilter === "ARRIVED_AT_GUDANG") && can.confirmArrival && (
                <p className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-1.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
                  <b>TIBA DI GUDANG TUJUAN</b> — klik <b>Terima / Scan</b> untuk menerima paket.
                </p>
              )}
              <DataTable
            rows={rows}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Cari resi / customer / kota…"
            toolbar={
              <div className="flex max-w-full flex-wrap items-center gap-1.5">
                {[
                  { key: "all", label: "All" },
                  { key: "CREATED", label: "Created" },
                  { key: "READY_FOR_PICKUP", label: "Ready for Pickup" },
                  { key: "PICKED_UP", label: "Picked Up" },
                  { key: "RECEIVED_AT_GUDANG", label: "At Origin Gudang" },
                  { key: "IN_TRANSPORT", label: "In Transport" },
                  { key: "AT_DEST_GUDANG", label: "At Dest. Gudang" },
                  { key: "ARRIVED_AT_GUDANG", label: "Arrived at Gudang" },
                  { key: "DELIVERED", label: "Delivered" },
                  { key: "CANCELLED", label: "Cancelled" },
                ].map((t) => (
                  <Button
                    key={t.key}
                    size="sm"
                    variant={statusFilter === t.key ? "default" : "outline"}
                    className="h-7 shrink-0 whitespace-nowrap px-2.5 text-[11px]"
                    onClick={() => setStatusFilter(t.key)}
                  >
                    {t.label}
                    {t.key !== "all" && (
                      <span className="ml-1 opacity-70">{data?.filter((s) => s.status === t.key).length ?? 0}</span>
                    )}
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
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      {s.customer?.name ?? "—"}
                      {s.customer?.type === "b2b" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" title="B2B — cukup scan Master Resi sekali">
                          B2B · Master Resi
                        </span>
                      )}
                      {/* Revise round 8 — Fulfillment Mode badge so users can
                          tell at a glance whether this shipment is Regular
                          (STANDARD) or Direct (DIRECT). */}
                      {(s.fulfillmentMode ?? "STANDARD") === "DIRECT" && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                          title="DIRECT — driver ambil langsung di gudang asal, kirim langsung ke gudang tujuan"
                        >
                          DIRECT
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.origin} → {s.destination}
                    </p>
                    {/* "This shipment is from Gudang X" — shown once the package
                        reached the destination side (another gudang) */}
                    {["AT_DEST_GUDANG", "ARRIVED_AT_GUDANG", "DELIVERED"].includes(s.status) && (s.originWarehouseName ?? s.originWarehouseId) && (
                      <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-sky-100/70 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                        <Warehouse className="h-3 w-3" /> dari {s.originWarehouseName ?? `Gudang #${s.originWarehouseId}`}
                      </p>
                    )}
                    {(s.status === "AT_DEST_GUDANG" || (s.status === "ARRIVED_AT_GUDANG" && s.destReceivedAt == null)) && (
                      <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-100/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                        <ScanLine className="h-3 w-3" /> menunggu scan Admin Gudang
                      </p>
                    )}
                    {s.customer?.type === "b2b" && s.invoiceLines?.[0] && (
                      <a href={`#/invoices/${s.invoiceLines[0].invoice.id}`} className="mt-1 inline-flex text-[10px] font-semibold text-amber-700 hover:underline dark:text-amber-300">
                        Included in invoice {s.invoiceLines[0].invoice.invoiceNumber}
                      </a>
                    )}
                    {s.penerimaName && <p className="text-[11px] text-muted-foreground">penerima: {s.penerimaName}</p>}
                  </div>
                ),
              },
              { key: "details", header: "Detail", render: (s) => <span className="text-sm">{s.totals?.totalPackages ?? s._count?.details ?? 0} paket</span> },
              {
                key: "price",
                header: "Harga",
                render: (s) => (
                  <div>
                    {/* Price is hidden until "Hitung Harga" has been run —
                        unpriced shipments show a hint instead of a number. */}
                    {s.priceAmount != null ? (
                      <p className="text-sm font-semibold">{formatRupiah(s.priceAmount)}</p>
                    ) : (
                      <p className="text-sm font-medium text-muted-foreground">— belum dihitung</p>
                    )}
                    {s.chargeableWeightKg != null && <p className="text-[11px] text-muted-foreground">{formatNumber(s.chargeableWeightKg)} kg cw</p>}
                  </div>
                ),
              },
              {
                key: "volume",
                header: "Volume",
                render: (s) => <span className="text-sm tabular-nums">{(s.totals?.totalVolumeM3 ?? 0).toFixed(3)} m³</span>,
              },
              {
                key: "berat",
                header: "Berat",
                render: (s) => (
                  <div>
                    <p className="text-sm font-semibold tabular-nums">{formatNumber(s.chargeableWeightKg ?? s.totals?.totalActualKg ?? 0)} kg</p>
                    {s.chargeableWeightKg != null && s.totals?.totalActualKg != null && Math.abs(s.chargeableWeightKg - s.totals.totalActualKg) > 0.01 && (
                      <p className="text-[11px] text-muted-foreground">aktual {formatNumber(s.totals.totalActualKg)} kg</p>
                    )}
                  </div>
                ),
              },
              { key: "created", header: "Dibuat", hideOnMobile: true, render: (s) => formatDate(s.createdAt) },
              {
                key: "status",
                header: "Status",
                render: (s) => (
                  <StatusBadge
                    status={s.status}
                    label={
                      s.status === "ARRIVED_AT_GUDANG"
                        ? `Arrived at ${s.arrivedWarehouseName ?? s.destinationWarehouseName ?? s.destination}`
                        : undefined
                    }
                  />
                ),
              },
              {
                key: "actions",
                header: "Aksi",
                render: (s) => (
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="outline" size="sm" className="h-7" onClick={() => (window.location.hash = `#/shipments/${s.id}`)}>
                      Detail
                    </Button>
                    <ItemAuditDialog entityType="shipment" entityId={s.id} itemLabel={s.masterCode} />
                    {can.confirmArrival && s.status === "PICKED_UP" && (
                      <Button size="sm" className="h-7" onClick={() => openRowScan(s)} title="Scan paket & konfirmasi tiba di gudang">
                        <ScanLine className="h-3.5 w-3.5" /> Terima / Scan
                      </Button>
                    )}
                    {can.confirmArrival && (s.status === "AT_DEST_GUDANG" || (s.status === "ARRIVED_AT_GUDANG" && s.destReceivedAt == null)) && (
                      <Button size="sm" className="h-7" onClick={() => openRowTransportScan(s)} title="Scan paket dari transport & konfirmasi penerimaan">
                        <ScanLine className="h-3.5 w-3.5" /> Terima / Scan
                      </Button>
                    )}
                    {can.printResi && s.status !== "CANCELLED" && (s.totals?.totalPackages ?? s._count?.details ?? 0) > 0 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => (window.location.hash = `#/shipments/${s.id}?print=1`)} aria-label="Cetak resi" title="Cetak Resi">
                        <Printer className="h-4 w-4" />
                      </Button>
                    )}
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
          );
        })}
        {can.viewLog && (
          <TabsContent value="activity" className="mt-3">
            <ActivityLogPanel entityTypes={["shipment", "shipment_detail"]} />
          </TabsContent>
        )}
      </Tabs>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Shipment</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer" htmlFor="s-customer" className="sm:col-span-2">
                <FormSelect
                  value={form.customerId}
                  onValueChange={(v) => {
                    const cust = (options?.customers ?? []).find((c) => String(c.id) === v) ?? null;
                    const stillValid = (options?.tariffs ?? []).some(
                      (t) => String(t.id) === form.tariffId && (!cust || !t.customerType || t.customerType === cust.type),
                    );
                    // Auto-fill Pengirim (sender) from the Customer master — the
                    // values are placed into editable inputs below so the user can
                    // tweak them per-shipment (e.g. drop-off person differs).
                    setForm({
                      ...form,
                      customerId: v,
                      ...(stillValid ? {} : { tariffId: "" }),
                      pengirimName: cust?.name ?? "",
                      pengirimPhone: cust?.phone ?? "",
                      pengirimEmail: cust?.email ?? "",
                      pengirimAddress: cust?.address ?? "",
                    });
                  }}
                  placeholder="Pilih customer…"
                  options={(options?.customers ?? []).map((c) => ({ value: String(c.id), label: `${c.name} (${c.type.toUpperCase()} · ${c.code})` }))}
                  disabled={busy}
                />
              </Field>
              {/* Revise round 7 — Customer marker.
                  When a customer is selected we show a small panel listing
                  the customer's DB-record data so the user can quickly see
                  the difference between what's in the database and what
                  they've typed into the Pengirim fields below. This is a
                  UI-only marker — nothing here is added to the resi or
                  stored on the shipment. The "per-shipment override" hint
                  shows next to each Pengirim field when it diverges. */}
              {selectedCustomer && (
                <div className="sm:col-span-2">
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
                    <p className="flex items-center gap-1.5 font-semibold text-primary">
                      <UserRound className="h-3.5 w-3.5" />
                      Customer terpilih (dari database)
                    </p>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-foreground/80">
                      <p><span className="font-medium">Kode:</span> <span className="font-mono">{selectedCustomer.code}</span></p>
                      <p><span className="font-medium">Tipe:</span> {selectedCustomer.type.toUpperCase()}</p>
                      <p><span className="font-medium">Nama DB:</span> {selectedCustomer.name || "—"}</p>
                      <p><span className="font-medium">Telp DB:</span> {selectedCustomer.phone || "—"}</p>
                      <p className="col-span-2"><span className="font-medium">Email DB:</span> {selectedCustomer.email || "—"}</p>
                      <p className="col-span-2"><span className="font-medium">Alamat DB:</span> {selectedCustomer.address || "—"}</p>
                    </div>
                    <p className="mt-1.5 text-[10px] text-foreground/55">
                      Bidang Pengirim di bawah otomatis terisi dari data customer — bidang yang <span className="rounded bg-amber-100 px-1 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">diubah</span> menandakan override per-shipment. Tidak dicetak pada resi.
                    </p>
                  </div>
                </div>
              )}
              <Field
                label="Rute (dari daftar tarif)"
                htmlFor="s-tariff"
                className="sm:col-span-2"
                hint={selectedCustomer ? `Khusus customer ${selectedCustomer.type.toUpperCase()}` : "Pilih customer dulu"}
              >
                <FormSelect
                  value={form.tariffId}
                  onValueChange={onTariffChange}
                  placeholder={selectedCustomer ? `Pilih rute ${selectedCustomer.type.toUpperCase()}…` : "Pilih customer untuk melihat rute…"}
                  options={routeOptions}
                  disabled={busy || !selectedCustomer}
                />
              </Field>
              {/*{selectedTariff && (
                <div className="sm:col-span-2 space-y-1 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Kota Asal:</span> {selectedTariff.origin} ·{" "}
                    <span className="font-medium text-foreground">Kota Tujuan:</span> {selectedTariff.destination}
                  </p>
                  <p>
                    Tarif Rp{formatNumber(selectedTariff.ratePerKg, 0)}/kg · min {formatNumber(selectedTariff.minChargeableKg)} kg · volumetrik = L×W×H/1.000.000 ×{" "}
                    {formatNumber(selectedTariff.volumetricMultiplier, 0)} (kg/m³) · pembulatan{" "}
                    {selectedTariff.roundingMode === "NEAREST" ? "terdekat" : "ke atas"} {selectedTariff.roundingUnitKg} kg
                  </p>
                </div>
              )}*/}
              {/* Revise round 9 — Mode Fulfillment moved BEFORE Gudang Asal/Tujuan.
                  Reason: when DIRECT is selected, the Gudang Asal/Tujuan fields
                  are hidden (DIRECT doesn't use company warehouses — the driver
                  picks up at the customer's location directly), so the user
                  needs to pick the mode FIRST to know which fields appear. */}
              <Field
                label="Mode Fulfillment"
                htmlFor="s-fulfillment-mode"
                className="sm:col-span-2"
                hint={
                  form.fulfillmentMode === "DIRECT"
                    ? "DIRECT — driver ambil langsung di lokasi customer, kirim langsung ke penerima. Tidak lewat gudang."
                    : "STANDARD — kurir pickup → gudang → transport → gudang tujuan → kurir delivery."
                }
              >
                <FormSelect
                  value={form.fulfillmentMode}
                  onValueChange={(v) => setForm({ ...form, fulfillmentMode: v as "STANDARD" | "DIRECT" })}
                  options={[
                    { value: "STANDARD", label: "STANDARD — Lewat gudang" },
                    { value: "DIRECT", label: "DIRECT — Driver langsung (tanpa gudang)" },
                  ]}
                  disabled={busy}
                />
              </Field>
              {/* Gudang Asal / Gudang Tujuan — only shown for STANDARD fulfillment.
                  DIRECT shipments skip the company warehouse flow entirely, so
                  these fields are irrelevant and hidden to keep the form clean. */}
              {form.fulfillmentMode === "STANDARD" && (
                <>
                  <Field
                    label="Gudang Asal"
                    htmlFor="s-warehouse-from"
                    hint={selectedTariff ? "Otomatis dari rute — dapat diubah" : "Otomatis terisi saat rute dipilih"}
                  >
                    <FormSelect
                      value={form.originWarehouseId}
                      onValueChange={(v) => setForm({ ...form, originWarehouseId: v })}
                      placeholder="—"
                      options={(options?.warehouses ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
                      disabled={busy}
                    />
                  </Field>
                  <Field
                    label="Gudang Tujuan"
                    htmlFor="s-warehouse-to"
                    hint={selectedTariff ? "Otomatis dari rute — dapat diubah" : "Otomatis terisi saat rute dipilih"}
                  >
                    <FormSelect
                      value={form.destinationWarehouseId}
                      onValueChange={(v) => setForm({ ...form, destinationWarehouseId: v })}
                      placeholder="—"
                      options={(options?.warehouses ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
                      disabled={busy}
                    />
                  </Field>
                </>
              )}
              {form.fulfillmentMode === "DIRECT" && (
                <div className="sm:col-span-2 rounded-lg border border-violet-300 bg-violet-50/60 px-3 py-2 text-xs text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
                  <b>Mode DIRECT</b> — shipment tidak melalui gudang. Driver akan pickup langsung di lokasi pengirim dan mengantar langsung ke penerima. Pastikan alamat Pengirim & Penerima diisi dengan lengkap.
                </div>
              )}
              {/* Discount is entered in Rupiah; the backend derives its percentage. */}
              {canAddDiscount && (
                <Field
                  label={discountIsMarketingFunded ? "Discount Marketing (Rupiah)" : "Discount Perusahaan (Rupiah)"}
                  htmlFor="s-discount"
                  className="sm:col-span-2"
                  hint={
                    discountIsMarketingFunded
                      ? "Dipotong dari profit sharing Marketing; maksimal sebesar bagian Marketing. Persentase dihitung otomatis dari harga."
                      : "Dipotong dari profit perusahaan; persentase dihitung otomatis dari harga."
                  }
                >
                  <NumberInput
                    id="s-discount"
                    value={form.discountAmount}
                    onChange={(e) => setForm({ ...form, discountAmount: e.target.value })}
                    placeholder="mis. 5000 (opsional)"
                    min={0}
                    disabled={busy}
                  />
                </Field>
              )}
              <Field
                label="Asuransi (Rupiah)"
                htmlFor="s-insurance"
                className="sm:col-span-2"
                hint="Opsional — masukkan nominal asuransi secara manual."
              >
                <NumberInput
                  id="s-insurance"
                  value={form.insuranceAmount}
                  onChange={(e) => setForm({ ...form, insuranceAmount: e.target.value })}
                  placeholder="mis. 10000"
                  min={0}
                  disabled={busy}
                />
              </Field>
              {/* Pengirim (sender) — auto-filled from Customer when the customer
                  is picked, but every field is editable so the user can override
                  the contact person / phone / email / address per-shipment.
                  Revise round 7: each field shows a "diubah" (overridden) badge
                  when it diverges from the customer's DB record, so the user
                  can see at a glance which values are overrides and which are
                  still the customer's master data. */}
              <div className="sm:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pengirim (dicetak pada resi)</p>
                  <span className="text-[10px] text-muted-foreground">
                    {form.customerId ? "Data customer otomatis terisi — dapat diubah." : "Pilih customer untuk mengisi otomatis."}
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Nama Pengirim"
                    htmlFor="s-pengirim-name"
                    className="sm:col-span-2"
                    hint={
                      selectedCustomer && form.pengirimName !== (selectedCustomer.name ?? "")
                        ? "Diubah dari data customer — override per-shipment."
                        : undefined
                    }
                  >
                    <Input
                      id="s-pengirim-name"
                      value={form.pengirimName}
                      onChange={(e) => setForm({ ...form, pengirimName: e.target.value })}
                      placeholder="mis. Andi Wijaya"
                      disabled={busy}
                      className={
                        selectedCustomer && form.pengirimName !== (selectedCustomer.name ?? "")
                          ? "border-amber-400/60 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30"
                          : undefined
                      }
                    />
                  </Field>
                  <Field
                    label="Telepon Pengirim"
                    htmlFor="s-pengirim-phone"
                    hint={
                      selectedCustomer && form.pengirimPhone !== (selectedCustomer.phone ?? "")
                        ? "Diubah dari data customer — override per-shipment."
                        : undefined
                    }
                  >
                    <Input
                      id="s-pengirim-phone"
                      value={form.pengirimPhone}
                      onChange={(e) => setForm({ ...form, pengirimPhone: e.target.value })}
                      placeholder="0812-xxxx-xxxx"
                      disabled={busy}
                      className={
                        selectedCustomer && form.pengirimPhone !== (selectedCustomer.phone ?? "")
                          ? "border-amber-400/60 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30"
                          : undefined
                      }
                    />
                  </Field>
                  <Field
                    label="Email Pengirim"
                    htmlFor="s-pengirim-email"
                    hint={
                      selectedCustomer && form.pengirimEmail !== (selectedCustomer.email ?? "")
                        ? "Diubah dari data customer — override per-shipment."
                        : "Kosongkan bila tidak ada."
                    }
                  >
                    <Input
                      id="s-pengirim-email"
                      type="email"
                      value={form.pengirimEmail}
                      onChange={(e) => setForm({ ...form, pengirimEmail: e.target.value })}
                      placeholder="pengirim@example.com"
                      disabled={busy}
                      className={
                        selectedCustomer && form.pengirimEmail !== (selectedCustomer.email ?? "")
                          ? "border-amber-400/60 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30"
                          : undefined
                      }
                    />
                  </Field>
                  <Field
                    label="Alamat Pengirim"
                    htmlFor="s-pengirim-address"
                    className="sm:col-span-2"
                    hint={
                      selectedCustomer && form.pengirimAddress !== (selectedCustomer.address ?? "")
                        ? "Diubah dari data customer — override per-shipment."
                        : undefined
                    }
                  >
                    <Textarea
                      id="s-pengirim-address"
                      value={form.pengirimAddress}
                      onChange={(e) => setForm({ ...form, pengirimAddress: e.target.value })}
                      placeholder="mis. Jl. Asia Afrika No. 8, Bandung"
                      rows={2}
                      disabled={busy}
                      className={
                        selectedCustomer && form.pengirimAddress !== (selectedCustomer.address ?? "")
                          ? "border-amber-400/60 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30"
                          : undefined
                      }
                    />
                  </Field>
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Penerima (dicetak pada resi)</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nama Penerima" htmlFor="s-penerima-name" className="sm:col-span-2">
                    <Input
                      id="s-penerima-name"
                      value={form.penerimaName}
                      onChange={(e) => setForm({ ...form, penerimaName: e.target.value })}
                      placeholder="mis. Hendra Gunawan"
                      disabled={busy}
                    />
                  </Field>
                  <Field label="Alamat Penerima" htmlFor="s-penerima-address" className="sm:col-span-2">
                    <Input
                      id="s-penerima-address"
                      value={form.penerimaAddress}
                      onChange={(e) => setForm({ ...form, penerimaAddress: e.target.value })}
                      placeholder="mis. Jl. Merdeka No. 88, Bandung"
                      disabled={busy}
                    />
                  </Field>
                  <Field label="Kontak Penerima" htmlFor="s-penerima-contact" className="sm:col-span-2">
                    <Input
                      id="s-penerima-contact"
                      value={form.penerimaContact}
                      onChange={(e) => setForm({ ...form, penerimaContact: e.target.value })}
                      placeholder="0812-xxxx-xxxx"
                      disabled={busy}
                    />
                  </Field>
                </div>
              </div>
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

      {can.confirmArrival && (
        <ScanArrivalPickerDialog open={scanPickerOpen} onOpenChange={setScanPickerOpen} onDone={reload} />
      )}

      {/* Per-row arrival scan — opens straight from a PICKED_UP row ("Picked Up" tab) */}
      {can.confirmArrival && (
        <ArrivalScanDialog
          key={rowScanTask ? `row-arr-${rowScanTask.id}` : "row-arr-none"}
          task={rowScanTask}
          mode="kurir"
          warehouses={(options?.warehouses ?? []).map((w) => ({ id: w.id, name: w.name }))}
          scopedWarehouseId={gudang?.scope?.scoped ? gudang.scope.warehouseId : null}
          onClose={() => setRowScanTask(null)}
          onDone={() => {
            reload();
            reloadGudang();
          }}
        />
      )}

      {/* Per-row transport arrival scan — opens straight from a row that
          reached the destination gudang (AT_DEST_GUDANG / awaiting scan) */}
      {can.confirmArrival && (
        <ArrivalScanDialog
          key={rowTransportTask ? `row-tarr-${rowTransportTask.id}` : "row-tarr-none"}
          task={rowTransportTask}
          mode="transport"
          warehouses={(options?.warehouses ?? []).map((w) => ({ id: w.id, name: w.name }))}
          scopedWarehouseId={gudang?.scope?.scoped ? gudang.scope.warehouseId : null}
          onClose={() => setRowTransportTask(null)}
          onDone={() => {
            reload();
            reloadGudang();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scan Kedatangan — quick-access picker beside "Buat Shipment": lists every
// shipment waiting to be received by Admin Gudang:
//  - PICKED_UP — kurir bringing it back to the origin gudang
//  - ARRIVED_AT_GUDANG — transport driver unloaded it from ANOTHER gudang
// Opens the same camera/reader/manual scan flow used in the Gudang menu.
// Only shows for users with shipment.confirm_arrival (Admin Gudang & co).
// ---------------------------------------------------------------------------

function ScanArrivalPickerDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { data, loading, reload } = useApiData<GudangWorkspace>(() => apiGet<GudangWorkspace>("/gudang"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [search, setSearch] = useState("");
  const [task, setTask] = useState<GudangArrivalQueueItem | null>(null);
  const [transportTask, setTransportTask] = useState<GudangTransportArrivalItem | null>(null);

  // Refresh the queue every time the picker is (re)opened.
  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const matches = (q: string, ...fields: (string | null | undefined)[]) =>
    !q || fields.some((f) => (f ?? "").toLowerCase().includes(q));

  const arrivals = useMemo(() => {
    const list = data?.arrivals ?? [];
    const q = search.trim().toLowerCase();
    return list.filter(
      (a) => matches(q, a.masterCode, a.customerName, a.kurirName),
    );
     
  }, [data, search]);

  const transportArrivals = useMemo(() => {
    const list = data?.transportArrivals ?? [];
    const q = search.trim().toLowerCase();
    return list.filter(
      (a) => matches(q, a.masterCode, a.customerName, a.originWarehouseName, a.origin, a.driverName, a.transportCode),
    );
     
  }, [data, search]);

  const warehouses = (options?.warehouses ?? []).map((w) => ({ id: w.id, name: w.name }));
  const scopedWarehouseId = data?.scope?.scoped ? data.scope.warehouseId : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" /> Scan Kedatangan
            </DialogTitle>
            <DialogDescription>
              Shipment yang menunggu diterima gudang: <b>PICKED UP</b> (dibawa kurir kembali ke gudang) dan <b>TIBA DI GUDANG TUJUAN</b>{" "}
              (driver transport sudah check-in di checkpoint akhir — paket dari gudang lain menunggu diterima). Pilih satu untuk scan tiap paketnya (kamera HP / reader tool / ketik
              manual), lalu konfirmasi penerimaannya setelah semua paket lengkap.
            </DialogDescription>
          </DialogHeader>

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari resi / customer / kurir / gudang asal…"
            className="w-full"
          />

          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-0.5">
            {loading && <p className="px-2 py-6 text-center text-sm text-muted-foreground">Memuat…</p>}
            {!loading && arrivals.length === 0 && transportArrivals.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                Tidak ada shipment menunggu diterima gudang saat ini.
              </p>
            )}

            {/* --- Kurir drop-off queue (PICKED_UP) --- */}
            {arrivals.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <Truck className="h-3.5 w-3.5" /> Kurir Drop-off · PICKED UP ({arrivals.length})
                </p>
                {arrivals.map((a) => {
                  const pct = a.detailsCount ? Math.round((a.scannedCount / a.detailsCount) * 100) : 0;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setTask(a)}
                      className="flex w-full flex-col gap-2 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold text-primary">{a.masterCode}</p>
                          <p className="truncate text-sm font-medium text-foreground">{a.customerName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {a.origin} → {a.destination}
                            {a.kurirName ? ` · kurir: ${a.kurirName}` : ""}
                          </p>
                        </div>
                        <Button size="sm" className="h-7 shrink-0">
                          <ScanLine className="h-3.5 w-3.5" /> Scan
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-1.5 flex-1" />
                        <span className={cn("shrink-0 font-mono text-[11px] font-semibold", a.scannedCount === a.detailsCount ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                          {a.scannedCount}/{a.detailsCount}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* --- Transport drop-off queue (AT_DEST_GUDANG, from another gudang) --- */}
            {transportArrivals.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <RouteIcon className="h-3.5 w-3.5" /> Transport Drop-off · Di Gudang Tujuan, menunggu scan ({transportArrivals.length})
                </p>
                {transportArrivals.map((a) => {
                  const pct = a.detailsCount ? Math.round((a.scannedCount / a.detailsCount) * 100) : 0;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setTransportTask(a)}
                      className="flex w-full flex-col gap-2 rounded-xl border border-sky-200/70 bg-sky-50/40 p-3 text-left transition-colors hover:bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/20 dark:hover:bg-sky-950/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold text-primary">{a.masterCode}</p>
                          <p className="truncate text-sm font-medium text-foreground">{a.customerName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="font-semibold text-sky-700 dark:text-sky-300">dari {a.originWarehouseName ?? a.origin}</span> → {a.destination}
                            {a.transportCode ? ` · ${a.transportCode}` : ""}
                            {a.driverName ? ` · driver: ${a.driverName}` : ""}
                          </p>
                        </div>
                        <Button size="sm" className="h-7 shrink-0">
                          <ScanLine className="h-3.5 w-3.5" /> Scan
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-1.5 flex-1" />
                        <span className={cn("shrink-0 font-mono text-[11px] font-semibold", a.scannedCount === a.detailsCount ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                          {a.scannedCount}/{a.detailsCount}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ArrivalScanDialog
        key={task ? `arr-${task.id}` : "arr-none"}
        task={task}
        mode="kurir"
        warehouses={warehouses}
        scopedWarehouseId={scopedWarehouseId}
        onClose={() => setTask(null)}
        onDone={() => {
          reload();
          onDone();
        }}
      />

      <ArrivalScanDialog
        key={transportTask ? `tarr-${transportTask.id}` : "tarr-none"}
        task={transportTask}
        mode="transport"
        warehouses={warehouses}
        scopedWarehouseId={scopedWarehouseId}
        onClose={() => setTransportTask(null)}
        onDone={() => {
          reload();
          onDone();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function ShipmentDetail({ id, autoPrint }: { id: number; autoPrint?: boolean }) {
  const { user } = useAuth();
  const can = {
    update: hasPermission(user, "shipment.update"),
    cancel: hasPermission(user, "shipment.cancel"),
    submitPickup: hasPermission(user, "shipment.update") || hasPermission(user, "pickup.create"),
    detailCreate: hasPermission(user, "shipment_detail.create"),
    detailUpdate: hasPermission(user, "shipment_detail.update"),
    detailDelete: hasPermission(user, "shipment_detail.delete"),
    track: hasPermission(user, "shipment.view_tracking"),
    // Walk-in arrival (customer hands the package over at the gudang counter) —
    // only visible/usable for users granted this permission (e.g. Admin Gudang).
    confirmArrival: hasPermission(user, "shipment.confirm_arrival"),
    // Cetak Resi — permission-gated (Admin Gudang & Owner for now).
    printResi: hasPermission(user, "shipment.print_resi"),
    // Bottom "Log Aktivitas Shipment Ini" panel — only for audit_log.view holders.
    viewLog: hasPermission(user, "audit_log.view"),
  };

  const [shipment, setShipment] = useState<(Shipment & { details: DetailShipment[]; trackingEvents: TrackingEvent[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Walk-in support data: warehouse list + gudang scope (only for permitted users)
  const { data: options } = useApiData<Options>(
    () => (can.confirmArrival ? apiGet<Options>("/options") : Promise.resolve(null as unknown as Options)),
    [can.confirmArrival],
  );
  const { data: gudangScope } = useApiData<GudangWorkspace>(
    () => (can.confirmArrival ? apiGet<GudangWorkspace>("/gudang") : Promise.resolve(null as unknown as GudangWorkspace)),
    [can.confirmArrival],
  );
  const [walkInTask, setWalkInTask] = useState<GudangWalkInItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<Shipment & { details: DetailShipment[]; trackingEvents: TrackingEvent[] }>(`/shipments/${id}`);
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
  const [confirmDeleteDetail, setConfirmDeleteDetail] = useState<DetailShipment | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const autoPrintHandled = useRef(false);
  const [penerimaOpen, setPenerimaOpen] = useState(false);
  const [penerimaForm, setPenerimaForm] = useState({ name: "", address: "", contact: "" });
  const [pengirimOpen, setPengirimOpen] = useState(false);
  const [pengirimForm, setPengirimForm] = useState({ name: "", phone: "", email: "", address: "" });

  // deep link #/shipments/{id}?print=1 — open the resi print preview
  // (only for users holding the print-resi permission)
  useEffect(() => {
    if (autoPrint && can.printResi && !autoPrintHandled.current && shipment && shipment.details.length > 0) {
      autoPrintHandled.current = true;
      setPrintOpen(true);
      window.history.replaceState(null, "", `#/shipments/${id}`); // avoid re-trigger
    }
  }, [autoPrint, can.printResi, shipment, id]);

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
      success: "Shipment siap dijemput. Buat task pickup di menu Pickups / Gudang.",
    });
    if (ok) {
      await refresh();
      // Auto-open the resi print preview when the user may print it
      // (shipment.print_resi — Admin Gudang & Owner for now).
      if (can.printResi) setPrintOpen(true);
    }
  }

  async function cancelShipment() {
    setConfirmCancel(false);
    const ok = await runAction(() => apiPost(`/shipments/${shipment!.id}/cancel`), { success: "Shipment dibatalkan." });
    if (ok) refresh();
  }

  function openPenerimaEdit() {
    setPenerimaForm({
      name: shipment?.penerimaName ?? "",
      address: shipment?.penerimaAddress ?? "",
      contact: shipment?.penerimaContact ?? "",
    });
    setPenerimaOpen(true);
  }

  function openPengirimEdit() {
    setPengirimForm({
      name: shipment?.pengirimName ?? shipment?.customer?.name ?? "",
      phone: shipment?.pengirimPhone ?? shipment?.customer?.phone ?? "",
      email: shipment?.pengirimEmail ?? shipment?.customer?.email ?? "",
      address: shipment?.pengirimAddress ?? shipment?.customer?.address ?? "",
    });
    setPengirimOpen(true);
  }

  async function onPengirimSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shipment) return;
    setBusy(true);
    const ok = await runAction(
      () =>
        apiPut(`/shipments/${shipment.id}`, {
          pengirimName: pengirimForm.name || null,
          pengirimPhone: pengirimForm.phone || null,
          pengirimEmail: pengirimForm.email || null,
          pengirimAddress: pengirimForm.address || null,
        }),
      { success: "Data Pengirim disimpan — akan dicetak pada resi." },
    );
    setBusy(false);
    if (ok) {
      setPengirimOpen(false);
      refresh();
    }
  }

  async function onPenerimaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shipment) return;
    setBusy(true);
    const ok = await runAction(
      () =>
        apiPut(`/shipments/${shipment.id}`, {
          penerimaName: penerimaForm.name || null,
          penerimaAddress: penerimaForm.address || null,
          penerimaContact: penerimaForm.contact || null,
        }),
      { success: "Data Penerima disimpan — akan dicetak pada resi." },
    );
    setBusy(false);
    if (ok) {
      setPenerimaOpen(false);
      refresh();
    }
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
      quantity: "1",
      lengthCm: d.lengthCm != null ? String(d.lengthCm) : "",
      widthCm: d.widthCm != null ? String(d.widthCm) : "",
      heightCm: d.heightCm != null ? String(d.heightCm) : "",
      // Revise round 11 — pre-fill the direct volume entry (m³).
      volumeM3: d.volumeM3 != null ? String(d.volumeM3) : "",
      actualWeightKg: String(d.actualWeightKg),
    });
    setDetailOpen(true);
  }

  async function onDetailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDetail) {
      const qty = Math.round(Number(detailForm.quantity) || 0);
      if (qty < 1 || qty > 500) {
        toast.error("Jumlah paket harus antara 1–500.");
        return;
      }
    }
    setBusy(true);
    const base = {
      description: detailForm.description,
      lengthCm: detailForm.lengthCm === "" ? null : Number(detailForm.lengthCm),
      widthCm: detailForm.widthCm === "" ? null : Number(detailForm.widthCm),
      heightCm: detailForm.heightCm === "" ? null : Number(detailForm.heightCm),
      // Revise round 11 — optional direct volume entry (m³). When set,
      // the server uses it directly instead of computing L×W×H/1.000.000.
      volumeM3: detailForm.volumeM3 === "" ? null : Number(detailForm.volumeM3),
      actualWeightKg: Number(detailForm.actualWeightKg) || 0,
    };
    const payload = editingDetail ? base : { ...base, quantity: Math.round(Number(detailForm.quantity) || 1) };
    const ok = await runAction(
      () =>
        editingDetail
          ? apiPut(`/shipment-details/${editingDetail.id}`, payload)
          : apiPost(`/shipments/${shipment!.id}/details`, payload),
      {
        success: editingDetail
          ? "Detail diperbarui."
          : `${Math.round(Number(detailForm.quantity) || 1)} paket dibuat — setiap paket punya kode unik.`,
      },
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

  // Server-computed pricing preview — the client never hardcodes the volumetric formula anymore.
  const pricing = shipment.pricingPreview ?? null;
  const actualWeight = pricing?.actualKg ?? shipment.details.reduce((sum, d) => sum + d.actualWeightKg, 0);
  const volumetric = pricing?.volumetricKg ?? 0;

  // "Ringkas" grouping: packages sharing description + dimensions + weight collapse into one row.
  // Presentation only — the database keeps 1 row per package (exactly like the "Semua" tab).
  const groupedDetails: DetailGroupRow[] = Object.values(
    shipment.details.reduce<Record<string, DetailGroupRow>>((acc, d) => {
      const l = d.lengthCm ?? 0;
      const w = d.widthCm ?? 0;
      const h = d.heightCm ?? 0;
      const vol = d.volumeM3 ?? 0;
      const key = `${d.description}|${l}|${w}|${h}|${vol}|${d.actualWeightKg}`;
      // Revise round 11 — per-package volume: use volumeM3 when set, otherwise L×W×H/1e6.
      const pkgVolume = vol > 0 ? vol : (l * w * h) / 1_000_000;
      if (!acc[key]) {
        acc[key] = {
          id: key,
          description: d.description,
          dims: l || w || h ? `${formatNumber(l, 0)}×${formatNumber(w, 0)}×${formatNumber(h, 0)}` : "—",
          volumeM3: 0,
          quantity: 0,
          weightKg: d.actualWeightKg,
          totalKg: 0,
        };
      }
      acc[key].quantity += 1;
      acc[key].totalKg += d.actualWeightKg;
      acc[key].volumeM3 += pkgVolume;
      return acc;
    }, {}),
  );

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
            <StatusBadge
              status={shipment.status}
              label={
                shipment.status === "ARRIVED_AT_GUDANG"
                  ? `Arrived at ${shipment.arrivedWarehouseName ?? shipment.destinationWarehouseName ?? options?.warehouses?.find((w) => w.id === shipment.destinationWarehouseId)?.name ?? shipment.destination}`
                  : undefined
              }
            />
            <ItemAuditDialog entityType="shipment" entityId={shipment.id} itemLabel={shipment.masterCode} />
            {shipment.customer?.type === "b2b" && shipment.invoiceLines?.[0] && (
              <a href={`#/invoices/${shipment.invoiceLines[0].invoice.id}`} className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Included in {shipment.invoiceLines[0].invoice.invoiceNumber}
              </a>
            )}
            {shipment.status === "CREATED" && can.submitPickup && (
              <Button onClick={submitForPickup} disabled={shipment.details.length === 0}>
                <Send className="h-4 w-4" /> Submit for Pickup
              </Button>
            )}
            {/* Walk-in: customer came straight to the gudang — confirm arrival
                directly instead of requesting a kurir pickup. Permission-gated. */}
            {can.confirmArrival && ["CREATED", "READY_FOR_PICKUP"].includes(shipment.status) && (
              <Button variant="secondary" onClick={() => setWalkInTask(toWalkInItem(shipment))}>
                <UserCheck className="h-4 w-4" /> Tiba di Gudang
              </Button>
            )}
            {can.submitPickup && shipment.details.length > 0 && ["CREATED", "READY_FOR_PICKUP", "PICKED_UP"].includes(shipment.status) && (
              <Button variant="secondary" onClick={computePrice}>
                <Calculator className="h-4 w-4" /> {shipment.priceAmount != null ? "Hitung Ulang Harga" : "Hitung Harga"}
              </Button>
            )}
            {can.printResi && shipment.status !== "CANCELLED" && shipment.details.length > 0 && (
              <Button variant="secondary" onClick={() => setPrintOpen(true)}>
                <Printer className="h-4 w-4" /> Cetak Resi
              </Button>
            )}
            {can.cancel && shipment.status !== "CANCELLED" && shipment.status !== "DELIVERED" && (
              <Button variant="outline" className="text-destructive" onClick={() => setConfirmCancel(true)}>
                <Ban className="h-4 w-4" /> Cancel
              </Button>
            )}
          </>
        }
      />

      {/* Where is this shipment from? — origin gudang banner for shipments that
          reached the destination gudang. Admin Gudang of the destination branch
          sees at a glance where the package came from. */}
      {["AT_DEST_GUDANG", "ARRIVED_AT_GUDANG", "DELIVERED"].includes(shipment.status) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
          <Warehouse className="h-4 w-4 shrink-0" />
          <p>
            Shipment ini <b>dari {shipment.originWarehouseName ?? options?.warehouses?.find((w) => w.id === shipment.originWarehouseId)?.name ?? shipment.origin}</b> —{" "}
            {shipment.status === "AT_DEST_GUDANG"
              ? <>driver transport sudah check-in di gudang tujuan (<b>{shipment.arrivedWarehouseName ?? options?.warehouses?.find((w) => w.id === shipment.arrivedWarehouseId)?.name ?? shipment.destination}</b>) — menunggu scan penerimaan Admin Gudang sebelum berstatus <b>Arrived at (gudang)</b>.</>
              : shipment.status === "ARRIVED_AT_GUDANG"
                ? shipment.destReceivedAt != null
                  ? <>sudah diterima & diverifikasi scan Admin Gudang di <b>{shipment.arrivedWarehouseName ?? options?.warehouses?.find((w) => w.id === shipment.arrivedWarehouseId)?.name ?? shipment.destination}</b> pada {formatDate(shipment.destReceivedAt, true)}.</>
                  : <>menunggu scan penerimaan Admin Gudang di <b>{shipment.arrivedWarehouseName ?? options?.warehouses?.find((w) => w.id === shipment.arrivedWarehouseId)?.name ?? shipment.destination}</b> — scan semua paket sebelum menugaskan kurir delivery.</>
                : <>sudah selesai dikirim ke penerima.</>}
          </p>
        </div>
      )}

      {/* Pickup submission checklist — price must be counted + penerima filled */}
      {shipment.status === "CREATED" && can.submitPickup && (shipment.priceAmount == null || !shipment.penerimaName) && (
        <p className="rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Sebelum submit untuk pickup: {shipment.priceAmount == null ? "hitung harga shipment (wajib — pickup tidak bisa diajukan tanpa harga)" : ""}
          {shipment.priceAmount == null && !shipment.penerimaName ? " dan " : ""}
          {!shipment.penerimaName ? "isi data Penerima (dicetak pada Resi Shipment & Resi Detail)" : ""}.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Pricing summary */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4 text-primary" /> Ringkasan Harga
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Row label="Total paket" value={`${shipment.details.length} paket`} />
            <Row label="Total volume" value={`${(shipment.totals?.totalVolumeM3 ?? 0).toFixed(3)} m³`} />
            <Row label="Berat aktual" value={`${formatNumber(actualWeight)} kg`} />
            <Row
              label={`Berat volumetrik (${pricing ? formatNumber(pricing.volumetricMultiplier, 0) : "?"})`}
              value={`${formatNumber(volumetric)} kg`}
            />
            <Row
              label="Chargeable weight"
              value={
                shipment.chargeableWeightKg != null
                  ? `${formatNumber(shipment.chargeableWeightKg)} kg`
                  : pricing
                    ? `${formatNumber(pricing.chargeableKg)} kg (estimasi)`
                    : "—"
              }
            />
            <Row
              label="Tarif"
              value={
                shipment.ratePerKg != null || pricing?.ratePerKg != null
                  ? `${formatRupiah(shipment.ratePerKg ?? pricing?.ratePerKg ?? 0)}/kg`
                  : "—"
              }
            />
            <Row label="Asuransi" value={formatRupiah(shipment.insuranceAmount)} />
            {/* The price stays hidden until "Hitung Harga" is clicked — the
                estimation is deliberately NOT shown either. */}
            {shipment.priceAmount != null ? (
              <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2.5">
                <span className="text-xs font-semibold text-primary">TOTAL HARGA</span>
                <span className="text-base font-bold text-primary">{formatRupiah(shipment.priceAmount)}</span>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2.5 text-center">
                <p className="text-xs font-semibold text-primary">Harga belum dihitung</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Klik tombol <b>Hitung Harga</b> untuk menghitung & menampilkan harga shipment ini.
                </p>
              </div>
            )}
            {/* Discount breakdown: funding source is snapshotted at creation. */}
            {shipment.discountAmount > 0 && (
              <div className={cn(
                "space-y-1.5 rounded-lg border px-3 py-2.5 text-xs",
                (shipment.discountFundedBy === "MARKETING" || shipment.createdByPartnerId != null)
                  ? "border-chart-4/40 bg-chart-4/5"
                  : "border-sky-400/40 bg-sky-500/5",
              )}>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {shipment.discountFundedBy === "MARKETING" || shipment.createdByPartnerId != null ? "Discount Marketing" : "Discount Perusahaan"}
                  </span>
                  <span className={cn("font-semibold", shipment.discountFundedBy === "MARKETING" || shipment.createdByPartnerId != null ? "text-chart-4" : "text-sky-600 dark:text-sky-400")}>
                    − {formatRupiah(shipment.discountAmount)}
                  </span>
                </div>
                {shipment.discountPercentage != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Persentase discount</span>
                    <span className="font-medium">{shipment.discountPercentage}% (otomatis)</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1.5">
                  <span className="font-semibold">Harga untuk customer</span>
                  <span className="font-bold">{formatRupiah(shipment.finalPriceAmount ?? shipment.paymentSummary?.finalPriceAmount ?? null)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {shipment.discountFundedBy === "MARKETING" || shipment.createdByPartnerId != null
                    ? "Discount ditanggung bagian Marketing; bagian perusahaan tetap dihitung dari harga asli."
                    : "Discount ditanggung perusahaan dan mengurangi profit perusahaan."}
                </p>
              </div>
            )}
            {!pricing && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                Tidak ada tarif aktif untuk rute {shipment.origin} → {shipment.destination} — buat tarif di menu Tariffs agar harga bisa dihitung.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Penerima & Pengirim */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <UserRound className="h-4 w-4 text-primary" /> Penerima
              </CardTitle>
              {shipment.status === "CREATED" && can.update && (
                <Button size="sm" variant="ghost" className="h-7" onClick={openPenerimaEdit}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Nama" value={shipment.penerimaName ?? "—"} />
            <Row label="Kontak" value={shipment.penerimaContact ?? "—"} />
            <p className="text-xs leading-relaxed text-muted-foreground">{shipment.penerimaAddress ?? "Alamat penerima belum diisi"}</p>
            <div className="border-t pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
              <Row label="Nama" value={shipment.customer?.name ?? "—"} />
              <Row label="Telp." value={shipment.customer?.phone ?? "—"} />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Data Penerima &amp; CS Gudang dicetak pada Resi Shipment (customer) dan setiap Resi Detail (stiker paket).
            </p>
          </CardContent>
        </Card>

        {/* Pengirim (sender) — was a tiny footer row in the Penerima card;
            now its own card so the four editable fields have room to breathe
            and the user can override them per-shipment. */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <UserRound className="h-4 w-4 text-primary" /> Pengirim
              </CardTitle>
              {shipment.status === "CREATED" && can.update && (
                <Button size="sm" variant="ghost" className="h-7" onClick={openPengirimEdit}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Nama" value={shipment.pengirimName ?? shipment.customer?.name ?? "—"} />
            <Row label="Telepon" value={shipment.pengirimPhone ?? shipment.customer?.phone ?? "—"} />
            <Row label="Email" value={shipment.pengirimEmail ?? shipment.customer?.email ?? "—"} />
            <p className="text-xs leading-relaxed text-muted-foreground">{shipment.pengirimAddress ?? shipment.customer?.address ?? "Alamat pengirim belum diisi"}</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Diisi otomatis dari data customer saat shipment dibuat — dapat diubah per-shipment.
            </p>
          </CardContent>
        </Card>

        {/* Tracking timeline */}
        <Card className="lg:col-span-2 lg:col-start-1">
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

      {/* Detail Barang — tabs: Semua (1 baris per paket) / Ringkas (digabung) */}
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
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">Semua ({shipment.details.length})</TabsTrigger>
                <TabsTrigger value="grouped">Ringkas ({groupedDetails.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="mt-3">
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
                    {
                      key: "dims",
                      header: "Dimensi (cm)",
                      hideOnMobile: true,
                      render: (d) => (d.lengthCm ? `${formatNumber(d.lengthCm, 0)}×${formatNumber(d.widthCm, 0)}×${formatNumber(d.heightCm, 0)}` : "—"),
                    },
                    // Revise round 11 — Volume (m³) column. Uses volumeM3 when
                    // set, otherwise computed from L×W×H/1.000.000. Shows "—"
                    // when neither path yields a positive volume.
                    {
                      key: "volume",
                      header: "Volume (m³)",
                      hideOnMobile: true,
                      render: (d) => {
                        const vol = (d.volumeM3 ?? 0) > 0
                          ? d.volumeM3!
                          : ((d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0)) / 1_000_000;
                        return <span className="text-sm tabular-nums">{vol > 0 ? vol.toFixed(3) : "—"}</span>;
                      },
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
              </TabsContent>
              <TabsContent value="grouped" className="mt-3">
                <DataTable
                  rows={groupedDetails}
                  emptyMessage="—"
                  columns={[
                    { key: "desc", header: "Deskripsi", primary: true, render: (g) => <span className="font-medium">{g.description}</span> },
                    { key: "dims", header: "Dimensi (cm)", render: (g) => g.dims },
                    // Revise round 11 — Volume (m³) column for grouped view.
                    {
                      key: "volume",
                      header: "Volume (m³)",
                      render: (g) => (
                        <span className="tabular-nums">
                          {g.volumeM3 > 0 ? `${(g.volumeM3 * g.quantity).toFixed(3)} m³` : "—"}
                          {g.volumeM3 > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({g.volumeM3.toFixed(3)}/paket)</span>}
                        </span>
                      ),
                    },
                    { key: "qty", header: "Jumlah", render: (g) => <span className="font-semibold">{g.quantity} paket</span> },
                    {
                      key: "weight",
                      header: "Berat",
                      render: (g) => (
                        <span>
                          {formatNumber(g.weightKg)} kg <span className="text-muted-foreground">/paket</span>
                        </span>
                      ),
                    },
                    { key: "total", header: "Total Berat", render: (g) => <span className="font-semibold">{formatNumber(g.totalKg)} kg</span> },
                  ]}
                />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* Log Aktivitas — only rendered for audit_log.view holders (hidden for
           Marketing & other roles that cannot read the audit trail). */}
      {can.viewLog && (
        <ActivityLogPanel entityTypes={["shipment", "shipment_detail", "pickup", "delivery", "transport"]} title="Log Aktivitas Shipment Ini" limit={20} />
      )}

      {/* Detail create/edit dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingDetail ? `Edit Detail — ${editingDetail.detailCode}` : "Tambah Detail Barang"}</DialogTitle>
            <DialogDescription>
              {editingDetail
                ? "1 baris = 1 paket. Volumetrik: L×W×H cm / 1.000.000 × multiplier tarif."
                : "Isi jumlah paket — sistem membuat N baris, masing-masing dengan kode unik (mis. 10 → DTL-…-01 s/d DTL-…-10)."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onDetailSubmit} className="space-y-4">
            <Field label="Deskripsi" htmlFor="d-desc">
              <Input id="d-desc" value={detailForm.description} onChange={(e) => setDetailForm({ ...detailForm, description: e.target.value })} placeholder="mis. Karton Tulis" required disabled={busy} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {!editingDetail && (
                <Field label="Jumlah paket" htmlFor="d-qty" hint="dibuat 1 kode unik per paket">
                  <NumberInput id="d-qty" value={detailForm.quantity} onChange={(e) => setDetailForm({ ...detailForm, quantity: e.target.value })} required disabled={busy} min={1} max={500} />
                </Field>
              )}
              <Field label="Berat aktual (kg)" htmlFor="d-weight" hint={editingDetail ? undefined : "per paket"}>
                <NumberInput id="d-weight" value={detailForm.actualWeightKg} onChange={(e) => setDetailForm({ ...detailForm, actualWeightKg: e.target.value })} placeholder="0" required disabled={busy} />
              </Field>
              <div className="grid grid-cols-3 gap-2 sm:col-span-2 sm:gap-3">
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
              {/* Revise round 11 — optional direct volume entry (m³).
                  Use case: irregularly-shaped packages where entering dimensions
                  is impractical. When set, volume is used directly instead of
                  L×W×H/1.000.000. Leave empty to compute from dimensions. */}
              <Field
                label="Volume langsung (m³) — opsional"
                htmlFor="d-volume"
                className="sm:col-span-2"
                hint="Isi jika paket berbentuk tidak beraturan (skip dimensi). Kosongkan untuk hitung otomatis dari P×L×T."
              >
                <NumberInput
                  id="d-volume"
                  value={detailForm.volumeM3}
                  onChange={(e) => setDetailForm({ ...detailForm, volumeM3: e.target.value })}
                  placeholder="mis. 0.009 (opsional)"
                  step="0.001"
                  min="0"
                  disabled={busy}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDetailOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editingDetail ? "Simpan Perubahan" : "Buat Paket"}</SubmitButton>
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

      {/* Cancel shipment — confirmation dialog (not a direct cancel) */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan shipment {shipment.masterCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Shipment akan diubah menjadi CANCELLED dan tidak bisa dilanjutkan lagi. Pastikan customer sudah dikonfirmasi sebelum melanjutkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tidak, lanjutkan shipment</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={cancelShipment}>
              <Ban className="h-4 w-4" /> Ya, batalkan shipment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Penerima edit dialog */}
      <Dialog open={penerimaOpen} onOpenChange={setPenerimaOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-primary" /> Edit Penerima
            </DialogTitle>
            <DialogDescription>Data penerima dicetak pada Resi Shipment &amp; setiap Resi Detail (stiker paket).</DialogDescription>
          </DialogHeader>
          <form onSubmit={onPenerimaSubmit} className="space-y-4">
            <Field label="Nama Penerima" htmlFor="pe-name">
              <Input id="pe-name" value={penerimaForm.name} onChange={(e) => setPenerimaForm({ ...penerimaForm, name: e.target.value })} required disabled={busy} />
            </Field>
            <Field label="Alamat Penerima" htmlFor="pe-address">
              <Textarea id="pe-address" value={penerimaForm.address} onChange={(e) => setPenerimaForm({ ...penerimaForm, address: e.target.value })} rows={2} disabled={busy} />
            </Field>
            <Field label="Kontak Penerima" htmlFor="pe-contact">
              <Input id="pe-contact" value={penerimaForm.contact} onChange={(e) => setPenerimaForm({ ...penerimaForm, contact: e.target.value })} placeholder="0812-xxxx-xxxx" disabled={busy} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPenerimaOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>Simpan Penerima</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Pengirim edit dialog */}
      <Dialog open={pengirimOpen} onOpenChange={setPengirimOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-primary" /> Edit Pengirim
            </DialogTitle>
            <DialogDescription>
              Diisi otomatis dari data customer — dapat diubah di sini untuk shipment ini saja (tanpa mengubah data customer).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onPengirimSubmit} className="space-y-4">
            <Field label="Nama Pengirim" htmlFor="pg-name">
              <Input id="pg-name" value={pengirimForm.name} onChange={(e) => setPengirimForm({ ...pengirimForm, name: e.target.value })} required disabled={busy} />
            </Field>
            <Field label="Telepon Pengirim" htmlFor="pg-phone">
              <Input id="pg-phone" value={pengirimForm.phone} onChange={(e) => setPengirimForm({ ...pengirimForm, phone: e.target.value })} placeholder="0812-xxxx-xxxx" disabled={busy} />
            </Field>
            <Field label="Email Pengirim" htmlFor="pg-email" hint="Kosongkan bila tidak ada.">
              <Input id="pg-email" type="email" value={pengirimForm.email} onChange={(e) => setPengirimForm({ ...pengirimForm, email: e.target.value })} placeholder="pengirim@example.com" disabled={busy} />
            </Field>
            <Field label="Alamat Pengirim" htmlFor="pg-address">
              <Textarea id="pg-address" value={pengirimForm.address} onChange={(e) => setPengirimForm({ ...pengirimForm, address: e.target.value })} rows={2} disabled={busy} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPengirimOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>Simpan Pengirim</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Resi print overlay — 1 Resi Shipment + N Resi Detail stickers */}
      {printOpen && (
        <ResiPrint
          shipment={shipment}
          onClose={() => setPrintOpen(false)}
        />
      )}

      {/* Walk-in arrival dialog — customer hands the package over at the gudang counter */}
      {can.confirmArrival && (
        <WalkInDialog
          key={walkInTask ? `walk-${walkInTask.id}-${walkInTask.status}` : "walk-none"}
          task={walkInTask}
          warehouses={(options?.warehouses ?? []).map((w) => ({ id: w.id, name: w.name }))}
          scopedWarehouseId={gudangScope?.scope?.scoped ? gudangScope.scope.warehouseId : null}
          onClose={() => setWalkInTask(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-semibold text-foreground">{value}</span>
    </div>
  );
}

/** Map a loaded Shipment to the walk-in dialog task shape. */
function toWalkInItem(s: Shipment & { details: DetailShipment[] }): GudangWalkInItem {
  return {
    id: s.id,
    masterCode: s.masterCode,
    customerName: s.customer?.name ?? "—",
    origin: s.origin,
    destination: s.destination,
    originWarehouseId: s.originWarehouseId ?? null,
    destinationWarehouseId: s.destinationWarehouseId ?? null,
    status: s.status,
    priceAmount: s.priceAmount,
    penerimaName: s.penerimaName ?? null,
    detailsCount: s.details.length,
    totalWeightKg: s.totals?.totalActualKg ?? s.details.reduce((sum, d) => sum + d.actualWeightKg, 0),
    totalVolumeM3: s.totals?.totalVolumeM3 ?? 0,
  };
}
