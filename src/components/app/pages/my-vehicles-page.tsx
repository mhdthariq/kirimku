"use client";

import { useState } from "react";
import { CarFront } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, hasPermission, type Vehicle } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";

interface MyVehicleRow extends Vehicle {
  _count?: { transports: number; repairs: number; settlements: number };
}

/**
 * My Vehicles (Revise.md §13/§32): the Vehicle Owner sees ONLY their own
 * vehicles — ownership isolation is enforced server-side (§39).
 */
export function MyVehiclesPage() {
  const { user } = useAuth();
  const canView = hasPermission(user, "vehicle.view_own");
  const { data, loading } = useApiData<MyVehicleRow[]>(() => apiGet<MyVehicleRow[]>("/partner/vehicles"), []);

  if (!canView || user?.partnerType !== "VEHICLE_OWNER") {
    return <PageHeader title="Kendaraan Saya" subtitle="Halaman ini khusus untuk Vehicle Owner." icon={<CarFront className="h-5 w-5" />} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kendaraan Saya"
        subtitle="Daftar kendaraan yang terdaftar atas nama Anda."
        icon={<CarFront className="h-5 w-5" />}
        actions={
          <div className="rounded-xl border bg-card px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-base font-bold">{(data ?? []).length} kendaraan</p>
          </div>
        }
      />
      <DataTable
        rows={data ?? []}
        loading={loading}
        emptyMessage="Belum ada kendaraan yang ditautkan ke akun Anda."
        columns={[
          {
            key: "number",
            header: "Nomor Polisi",
            primary: true,
            render: (r) => (
              <div>
                <p className="font-mono text-sm font-semibold">{r.vehicleNumber}</p>
                <p className="text-xs text-muted-foreground">{r.name ?? "—"}</p>
              </div>
            ),
          },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            key: "capacity",
            header: "Kapasitas",
            hideOnMobile: true,
            render: (r) => (
              <div>
                <p className="text-sm">{r.maxWeightKg.toLocaleString("id-ID")} kg</p>
                <p className="text-xs text-muted-foreground">{r.maxVolumeM3} m³</p>
              </div>
            ),
          },
          {
            key: "stats",
            header: "Aktivitas",
            render: (r) => (
              <div className="text-xs text-muted-foreground">
                <p>{r._count?.transports ?? 0} transport</p>
                <p>{r._count?.settlements ?? 0} settlement</p>
                <p>{r._count?.repairs ?? 0} repair</p>
              </div>
            ),
          },
          {
            key: "notes",
            header: "Catatan",
            hideOnMobile: true,
            render: (r) => <span className="text-xs text-muted-foreground">{r.notes ?? "—"}</span>,
          },
        ]}
      />
      <Button variant="outline" asChild>
        <a href="#/vo-transport-history">Lihat Riwayat Transport →</a>
      </Button>
    </div>
  );
}
