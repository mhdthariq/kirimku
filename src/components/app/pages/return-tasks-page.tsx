"use client";

import { useMemo, useState } from "react";
import { CheckCheck, Truck, Undo2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPost, hasPermission, type ReturnTaskRow } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, SubmitButton, formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const FILTERS = [
  { value: "all", label: "Semua" },
  { value: "CREATED", label: "Menunggu approval" },
  { value: "APPROVED", label: "Disetujui" },
  { value: "PLANNED", label: "Direncanakan" },
  { value: "DEPARTED", label: "Berangkat" },
  { value: "ARRIVED", label: "Tiba" },
];

/**
 * Resi Tugas Balik: an emptied vehicle going back to its origin.
 * CREATED → (approve) APPROVED → (create transport) PLANNED → DEPARTED → ARRIVED,
 * the last three following the return transport automatically.
 */
export function ReturnTasksPage() {
  const { user } = useAuth();
  const can = { approve: hasPermission(user, "return-task.approve"), create: hasPermission(user, "return-task.create") };
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { data, loading, reload } = useApiData<ReturnTaskRow[]>(
    () => apiGet<ReturnTaskRow[]>(`/return-tasks${filter === "all" ? "" : `?status=${filter}`}`),
    [filter],
  );
  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return (data ?? []).filter(
      (t) => !q || [t.returnTaskCode, t.origin, t.destination, t.vehicleNumber, t.originalTransportCode].some((v) => v.toLowerCase().includes(q)),
    );
  }, [data, search]);

  const [transportFor, setTransportFor] = useState<ReturnTaskRow | null>(null);
  const [departAt, setDepartAt] = useState("");
  const [arriveAt, setArriveAt] = useState("");
  const [busy, setBusy] = useState(false);

  async function approve(t: ReturnTaskRow) {
    if (await runAction(() => apiPost(`/return-tasks/${t.id}/approve`, {}), { success: `${t.returnTaskCode} disetujui.` })) reload();
  }

  async function createTransport(e: React.FormEvent) {
    e.preventDefault();
    if (!transportFor) return;
    if (departAt && arriveAt && arriveAt < departAt) return;
    setBusy(true);
    const ok = await runAction(
      () =>
        apiPost(`/return-tasks/${transportFor.id}/create-transport`, {
          plannedDepartureAt: departAt ? new Date(departAt).toISOString() : undefined,
          plannedArrivalAt: arriveAt ? new Date(arriveAt).toISOString() : undefined,
        }),
      { success: "Transport balik dibuat." },
    );
    setBusy(false);
    if (ok) {
      setTransportFor(null);
      reload();
    }
  }

  if (!hasPermission(user, "return-task.view")) {
    return <PageHeader title="Tugas Balik" subtitle="Anda tidak punya akses ke halaman ini." icon={<Undo2 className="h-5 w-5" />} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Resi Tugas Balik"
        subtitle="Kendaraan kosong yang kembali ke asal setelah seluruh resi disetujui. Dibuat dari halaman detail transport."
        icon={<Undo2 className="h-5 w-5" />}
      />
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="flex-wrap">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        rows={rows}
        loading={loading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Cari kode / kota / kendaraan…"
        emptyMessage="Belum ada resi tugas balik."
        columns={[
          {
            key: "code",
            header: "Resi Tugas Balik",
            primary: true,
            render: (t) => (
              <div>
                <p className="font-mono text-sm font-semibold">{t.returnTaskCode}</p>
                <p className="text-xs text-muted-foreground">
                  {t.origin} → {t.destination}
                </p>
              </div>
            ),
          },
          {
            key: "vehicle",
            header: "Kendaraan",
            render: (t) => (
              <div>
                <p className="text-sm">{t.vehicleNumber}</p>
                <p className="text-xs text-muted-foreground">{t.driverName ?? "-"}</p>
              </div>
            ),
          },
          {
            key: "from",
            header: "Dari transport",
            hideOnMobile: true,
            render: (t) => (
              <a href={`/#/transports/${t.originalTransportId}`} className="font-mono text-xs text-primary hover:underline">
                {t.originalTransportCode}
              </a>
            ),
          },
          {
            key: "return",
            header: "Transport balik",
            hideOnMobile: true,
            render: (t) =>
              t.returnTransportId ? (
                <a href={`/#/transports/${t.returnTransportId}`} className="font-mono text-xs text-primary hover:underline">
                  {t.returnTransportCode}
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">belum dibuat</span>
              ),
          },
          { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status} /> },
          { key: "created", header: "Dibuat", hideOnMobile: true, render: (t) => formatDate(t.createdAt, true) },
          {
            key: "actions",
            header: "Aksi",
            render: (t) => (
              <div className="flex gap-1.5">
                {t.status === "CREATED" && can.approve && (
                  <Button size="sm" onClick={() => approve(t)}>
                    <CheckCheck className="h-3.5 w-3.5" /> Setujui
                  </Button>
                )}
                {t.status === "APPROVED" && !t.returnTransportId && can.create && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDepartAt("");
                      setArriveAt("");
                      setTransportFor(t);
                    }}
                  >
                    <Truck className="h-3.5 w-3.5" /> Buat Transport
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <Dialog open={!!transportFor} onOpenChange={(o) => !o && setTransportFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Transport Balik</DialogTitle>
            <DialogDescription>
              {transportFor?.returnTaskCode}: {transportFor?.origin} → {transportFor?.destination}. Rute balik = checkpoint rute asal dibalik, kendaraan & driver sama, tanpa resi.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createTransport} className="space-y-4">
            <Field label="Rencana Berangkat" htmlFor="rt-dep" hint="Kosong = sekarang">
              <input id="rt-dep" type="datetime-local" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs" value={departAt} onChange={(e) => setDepartAt(e.target.value)} disabled={busy} />
            </Field>
            <Field
              label="Rencana Tiba"
              htmlFor="rt-arr"
              hint="Kosong = 6 jam setelah berangkat"
              error={departAt && arriveAt && arriveAt < departAt ? "Rencana tiba tidak boleh lebih awal dari berangkat." : undefined}
            >
              <input id="rt-arr" type="datetime-local" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs" value={arriveAt} onChange={(e) => setArriveAt(e.target.value)} disabled={busy} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTransportFor(null)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>Buat Transport</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
