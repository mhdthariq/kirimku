"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Camera,
  ClipboardList,
  MapPin,
  Package,
  Phone,
  QrCode,
  Truck,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, type PickupTask, type DeliveryTask } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { DatePeriodFilter } from "@/components/app/date-period-filter";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate, formatRupiah } from "@/components/app/form-parts";
import { QrScanDialog, type ScanTaskInfo } from "@/components/app/qr-scan-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface KurirDashboardData {
  period: { from: string; to: string; days: number };
  counts: {
    pickupsAssigned: number;
    pickupsPickedUp: number;
    pickupsCompleted: number;
    deliveriesAssigned: number;
    deliveriesDelivered: number;
  };
  pickups: (PickupTask & { customerPhone: string | null })[];
  deliveries: DeliveryTask[];
  note?: string;
}

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Kurir operational dashboard (Revision Part R):
 * - pickup & delivery tasks ASSIGNED TO ME only (backend-enforced)
 * - date/period filter (default start = today) via the calendar filter
 * - counts: assigned / picked up / completed / delivered
 */
export function KurirDashboard() {
  const { user } = useAuth();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [scanTask, setScanTask] = useState<ScanTaskInfo | null>(null);
  const [scanMode, setScanMode] = useState<"pickup" | "delivery">("pickup");

  const { data, loading, reload } = useApiData<KurirDashboardData>(
    () => apiGet<KurirDashboardData>(`/dashboard/kurir?from=${from}&to=${to}`),
    [from, to],
  );

  const greeting = new Date().getHours() < 12 ? "Selamat pagi" : new Date().getHours() < 18 ? "Selamat siang" : "Selamat malam";

  function openPickupScan(p: KurirDashboardData["pickups"][number]) {
    setScanMode("pickup");
    setScanTask({
      id: p.id,
      code: p.pickupCode,
      masterCode: p.masterCode,
      customerName: p.customerName,
      route: `${p.origin} → ${p.destination}`,
      status: p.status,
      completedAt: p.completedAt,
    });
  }

  function openDeliveryScan(d: KurirDashboardData["deliveries"][number]) {
    setScanMode("delivery");
    setScanTask({
      id: d.id,
      code: d.deliveryCode,
      masterCode: d.masterCode,
      customerName: d.customerName,
      route: d.destination,
      status: d.status,
      completedAt: d.completedAt,
    });
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-56 rounded-xl" />
      </div>
    );
  }

  const stats = [
    { label: "Pickup Ditugaskan", value: data.counts.pickupsAssigned, icon: MapPin, href: "#/pickups", tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
    { label: "Paket Diambil", value: data.counts.pickupsPickedUp, icon: Truck, href: "#/pickups", tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
    { label: "Pickup Selesai", value: data.counts.pickupsCompleted, icon: Package, href: "#/pickups", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    { label: "Delivery Ditugaskan", value: data.counts.deliveriesAssigned, icon: ClipboardList, href: "#/deliveries", tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
    { label: "Sudah Diantar", value: data.counts.deliveriesDelivered, icon: Camera, href: "#/deliveries", tone: "bg-primary/10 text-primary" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {greeting}, {user?.name.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground">Dashboard operasional kurir — tugas pickup & delivery Anda.</p>
        </div>
        <DatePeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      {data.note && (
        <p className="rounded-lg border border-amber-300 bg-amber-50/60 px-3.5 py-2.5 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">{data.note}</p>
      )}

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat, i) => (
          <motion.a
            key={stat.label}
            href={stat.href}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <CardContent className="flex items-start justify-between p-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                  <p className="mt-1.5 text-2xl font-bold text-foreground">{stat.value}</p>
                </div>
                <div className={`rounded-lg p-2 ${stat.tone}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </motion.a>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pickup list */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" /> Pickup Saya
              </span>
              <a href="#/pickups" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Semua pickup <ArrowRight className="h-3 w-3" />
              </a>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.pickups.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-sm text-muted-foreground">
                Tidak ada tugas pickup pada periode ini.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.pickups.slice(0, 8).map((p) => (
                  <li key={p.id} className="rounded-lg border px-3.5 py-2.5 transition hover:border-primary/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className="font-mono text-xs">{p.pickupCode}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="truncate">{p.customerName}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.origin} → {p.destination} · {p.scannedCount ?? 0}/{p.detailsCount} paket ter-scan · {formatDate(p.createdAt, true)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={p.status} />
                        {!["COMPLETED", "CANCELLED"].includes(p.status) && (
                          <button
                            onClick={() => openPickupScan(p)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                          >
                            <QrCode className="h-3.5 w-3.5" /> Proses
                          </button>
                        )}
                      </div>
                    </div>
                    {p.customerPhone && (
                      <a href={`tel:${p.customerPhone}`} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                        <Phone className="h-3 w-3" /> {p.customerPhone}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Delivery list */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" /> Delivery Saya
              </span>
              <a href="#/deliveries" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Semua delivery <ArrowRight className="h-3 w-3" />
              </a>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.deliveries.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-sm text-muted-foreground">
                Tidak ada tugas delivery pada periode ini.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.deliveries.slice(0, 8).map((d) => (
                  <li key={d.id} className="rounded-lg border px-3.5 py-2.5 transition hover:border-primary/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className="font-mono text-xs">{d.deliveryCode}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="truncate">{d.penerimaName ?? d.customerName}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {d.destination}
                          {d.address ? ` · ${d.address}` : ""} · {d.scannedCount ?? 0}/{d.detailsCount} paket
                          {d.priceAmount != null ? ` · ${formatRupiah(d.priceAmount)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={d.status} />
                        {d.status === "ASSIGNED" && (
                          <button
                            onClick={() => openDeliveryScan(d)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                          >
                            <QrCode className="h-3.5 w-3.5" /> Proses
                          </button>
                        )}
                      </div>
                    </div>
                    {d.customerPhone && (
                      <a href={`tel:${d.customerPhone}`} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                        <Phone className="h-3 w-3" /> {d.customerPhone}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <QrScanDialog
        open={!!scanTask}
        onOpenChange={(open) => !open && setScanTask(null)}
        mode={scanMode}
        task={scanTask}
        onDone={reload}
      />
    </div>
  );
}
