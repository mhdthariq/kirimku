"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  ClipboardList,
  Coins,
  History,
  MapPin,
  Package,
  Receipt,
  Route,
  Truck,
  Users,
  CarFront,
  Warehouse,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasPermission, type DashboardData } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { PageHeader } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const LIFECYCLE = ["CREATED", "READY_FOR_PICKUP", "PICKED_UP", "RECEIVED_AT_GUDANG", "IN_TRANSPORT", "ARRIVED_AT_GUDANG", "DELIVERED"];

export function DashboardPage() {
  const { user } = useAuth();
  const { data, loading } = useApiData<DashboardData>(() => {
    if (!user) return Promise.resolve(null as unknown as DashboardData);
    return fetch("/api/v1/dashboard", {
      headers: { Authorization: `Bearer ${localStorage.getItem("kirimku_token") ?? ""}` },
    }).then((r) => r.json().then((j) => j.data as DashboardData));
  }, [user?.id]);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const can = (p: string) => hasPermission(user, p);
  const counts = data.counts ?? {};
  const greeting = new Date().getHours() < 12 ? "Selamat pagi" : new Date().getHours() < 18 ? "Selamat siang" : "Selamat malam";

  const stats = [
    { label: "Shipment Total", value: counts.shipments, icon: Package, href: "#/shipments", show: can("shipment.view") },
    { label: "Pickup Aktif", value: counts.activePickups, icon: Truck, href: "#/pickups", show: can("pickup.view") },
    { label: "Delivery Tertunda", value: counts.pendingDeliveries, icon: ClipboardList, href: "#/deliveries", show: can("delivery.view") },
    { label: "Transport Berjalan", value: counts.inTransit, icon: Route, href: "#/transports", show: can("transport.view") },
    { label: "Customer Aktif", value: counts.customers, icon: Users, href: "#/customers", show: can("customer.view") },
    { label: "Gudang", value: counts.gudang, icon: Warehouse, href: "#/gudang", show: can("warehouse.view") },
    { label: "Kendaraan", value: counts.vehicles, icon: CarFront, href: "#/vehicles", show: can("vehicle.view") },
    { label: "Invoice", value: counts.invoices, icon: Receipt, href: "#/invoices", show: can("invoice.view") },
  ].filter((s) => s.show && s.value != null);

  const maxStatus = Math.max(1, ...Object.values(data.statusCounts ?? {}));

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${greeting}, ${user?.name.split(" ")[0]}`}
        subtitle="Ringkasan operasional pengiriman hari ini."
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
                  <p className="mt-1.5 text-2xl font-bold text-foreground">{formatNumber(stat.value ?? 0, 0)}</p>
                </div>
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <stat.icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </motion.a>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Shipment lifecycle funnel */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Status Shipment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 overflow-x-auto pb-2 sm:gap-3">
              {LIFECYCLE.map((status) => {
                const count = data.statusCounts?.[status] ?? 0;
                const height = Math.max(4, Math.round((count / maxStatus) * 96));
                return (
                  <a key={status} href="#/shipments" className="group flex min-w-[64px] flex-1 flex-col items-center gap-1.5">
                    <span className="text-xs font-bold text-foreground">{count}</span>
                    <div
                      className="w-full rounded-t-md bg-primary/80 transition-all group-hover:bg-primary"
                      style={{ height }}
                      aria-label={`${status}: ${count}`}
                    />
                    <StatusBadge status={status} className="scale-90" />
                  </a>
                );
              })}
            </div>
            {can("payment.view") && (
              <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/60 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Coins className="h-4 w-4 text-primary" /> Total pembayaran terverifikasi
                </span>
                <span className="text-sm font-bold text-foreground">{formatRupiah(data.revenueVerified)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent audit */}
        {can("audit_log.view") && (
          <Card className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-primary" /> Aktivitas Terbaru
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2.5">
                {(data.recentAudit ?? []).slice(0, 6).map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{entry.entityLabel ?? entry.entityType}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {entry.action} · {entry.actorName}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(entry.createdAt, true)}</span>
                  </li>
                ))}
              </ul>
              <a href="#/audit" className="mt-4 flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Lihat audit timeline <ArrowRight className="h-3 w-3" />
              </a>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent shipments */}
      {can("shipment.view") && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Shipment Terbaru</CardTitle>
              <a href="#/shipments" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Semua shipment <ArrowRight className="h-3 w-3" />
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data.recentShipments ?? []).map((s) => (
                <a
                  key={s.id}
                  href={`#/shipments/${s.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 transition hover:border-primary/40 hover:bg-accent/50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-foreground">{s.masterCode}</span>
                    <span className="hidden text-sm text-muted-foreground sm:block">
                      {s.customerName} · {s.origin} → {s.destination}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="hidden text-[11px] text-muted-foreground md:block">{formatDate(s.createdAt)}</span>
                    <StatusBadge status={s.status} />
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
