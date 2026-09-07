"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, MapPin, Pencil, Plus, Route as RouteIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Route as RouteModel, type Checkpoint } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ActiveBadge } from "@/components/app/status-badge";
import { Field, Input, SubmitButton } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

const CheckpointMapEditor = dynamic(
  () => import("@/components/app/checkpoint-map-editor").then((m) => m.CheckpointMapEditor),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[440px] w-full rounded-xl" />,
  },
);
import type { DraftCheckpoint } from "@/components/app/checkpoint-map-editor";

interface RouteForm {
  name: string;
  origin: string;
  destination: string;
}

const EMPTY: RouteForm = { name: "", origin: "", destination: "" };

export function RoutesPage({ routeId }: { routeId: number | null }) {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "checkpoint.view"),
    create: hasPermission(user, "checkpoint.create"),
    update: hasPermission(user, "checkpoint.update"),
    delete: hasPermission(user, "checkpoint.delete"),
  };

  const { data: routes, loading, reload } = useApiData<RouteModel[]>(() => apiGet<RouteModel[]>("/routes"), []);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RouteModel | null>(null);
  const [form, setForm] = useState<RouteForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RouteModel | null>(null);

  const selectedRoute = useMemo(
    () => (routeId != null ? routes?.find((r) => r.id === routeId) ?? null : null),
    [routes, routeId],
  );

  // Draft checkpoints for the selected route — derived per route, overridden by edits
  const [draftsState, setDraftsState] = useState<{ routeId: number | null; items: DraftCheckpoint[] }>({
    routeId: null,
    items: [],
  });
  const selectedRouteId = selectedRoute?.id ?? null;
  const drafts =
    draftsState.routeId === selectedRouteId
      ? draftsState.items
      : (selectedRoute?.checkpoints ?? []).map((c: Checkpoint) => ({
          id: c.id,
          name: c.name,
          latitude: c.latitude,
          longitude: c.longitude,
          radiusMeters: c.radiusMeters,
        }));
  const setDrafts = useCallback(
    (next: DraftCheckpoint[]) => setDraftsState({ routeId: selectedRouteId, items: next }),
    [selectedRouteId],
  );

  const rows = useMemo(() => {
    if (!routes) return [];
    const q = search.toLowerCase();
    return routes.filter(
      (r) => !q || r.name.toLowerCase().includes(q) || (r.origin ?? "").toLowerCase().includes(q) || (r.destination ?? "").toLowerCase().includes(q),
    );
  }, [routes, search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(r: RouteModel) {
    setEditing(r);
    setForm({ name: r.name, origin: r.origin ?? "", destination: r.destination ?? "" });
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = { ...form, origin: form.origin || null, destination: form.destination || null };
    const ok = await runAction(
      () => (editing ? apiPut(`/routes/${editing.id}`, payload) : apiPost("/routes", payload)),
      { success: editing ? "Rute diperbarui." : "Rute dibuat." },
    );
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
    const ok = await runAction(() => apiDelete(`/routes/${target.id}`), { success: "Rute diproses." });
    if (ok) {
      reload();
      if (routeId === target.id) window.location.hash = "#/routes";
    }
  }

  const saveCheckpoint = useCallback(
    async (cp: DraftCheckpoint) => {
      const route = selectedRoute;
      if (!route) return;
      if (!cp.name.trim()) {
        toast.error("Beri nama checkpoint sebelum menyimpan.");
        return;
      }
      const ok = await runAction(
        () =>
          cp.id
            ? apiPut(`/checkpoints/${cp.id}`, { name: cp.name, latitude: cp.latitude, longitude: cp.longitude, radiusMeters: cp.radiusMeters })
            : apiPost(`/routes/${route.id}/checkpoints`, {
                name: cp.name,
                latitude: cp.latitude,
                longitude: cp.longitude,
                radiusMeters: cp.radiusMeters,
              }),
        { success: cp.id ? "Checkpoint diperbarui." : "Checkpoint ditambahkan." },
      );
      if (ok) {
        const updated = await apiGet<RouteModel[]>(`/routes`);
        const fresh = updated.find((r) => r.id === route.id);
        if (fresh) {
          setDrafts(
            fresh.checkpoints.map((c: Checkpoint) => ({
              id: c.id,
              name: c.name,
              latitude: c.latitude,
              longitude: c.longitude,
              radiusMeters: c.radiusMeters,
            })),
          );
        }
      }
    },
     
    [selectedRoute, setDrafts],
  );

  const deleteCheckpoint = useCallback(
    async (cp: DraftCheckpoint) => {
      if (!cp.id) return;
      await runAction(() => apiDelete(`/checkpoints/${cp.id}`), { success: "Checkpoint dihapus." });
    },
    [],
  );

  if (!can.view) {
    return <PageHeader title="Rute & Checkpoint" subtitle="Anda tidak memiliki izin melihat rute." />;
  }

  // ----- Detail view: checkpoint editor for a selected route -----
  if (selectedRoute) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => (window.location.hash = "#/routes")} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Semua rute
        </Button>

        <PageHeader
          title={selectedRoute.name}
          subtitle={`${selectedRoute.origin ?? "?"} → ${selectedRoute.destination ?? "?"} · ${selectedRoute.checkpoints.length} checkpoint · dipakai ${selectedRoute._count?.transports ?? 0} transport`}
          icon={<RouteIcon className="h-5 w-5" />}
          actions={
            can.update && (
              <Button variant="outline" onClick={() => openEdit(selectedRoute)}>
                <Pencil className="h-4 w-4" /> Edit Rute
              </Button>
            )
          }
        />

        <CheckpointMapEditor
          checkpoints={drafts}
          onChange={setDrafts}
          onSaveCheckpoint={can.create || can.update ? saveCheckpoint : undefined}
          onDeleteCheckpoint={can.delete ? deleteCheckpoint : undefined}
          canEdit={can.create || can.update}
        />

        <ActivityLogPanel entityTypes={["checkpoint", "route"]} title="Log Aktivitas Rute & Checkpoint" />
      </div>
    );
  }

  // ----- List view -----
  return (
    <div className="space-y-4">
      <PageHeader
        title="Rute & Checkpoint"
        subtitle="Rute tetap dengan checkpoint GPS berurutan (minimal 3, tanpa batas maksimal)."
        icon={<MapPin className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Tambah Rute
            </Button>
          )
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Daftar</TabsTrigger>
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-3">
          <DataTable
            rows={rows}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Cari nama rute / kota…"
            emptyMessage="Belum ada rute. Klik “Tambah Rute”, lalu tambahkan checkpoint lewat peta."
            columns={[
              {
                key: "name",
                header: "Nama Rute",
                primary: true,
                render: (r) => (
                  <a href={`#/routes/${r.id}`} className="font-semibold text-foreground hover:text-primary hover:underline">
                    {r.name}
                  </a>
                ),
              },
              {
                key: "lane",
                header: "Koridor",
                render: (r) => (
                  <span className="text-sm text-muted-foreground">
                    {r.origin ?? "—"} → {r.destination ?? "—"}
                  </span>
                ),
              },
              {
                key: "checkpoints",
                header: "Checkpoint",
                render: (r) => (
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${r.checkpoints.length < 3 ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"}`}>
                      {r.checkpoints.length}
                    </span>
                    {r.checkpoints.length < 3 && <span className="text-[11px] text-destructive">min 3</span>}
                  </div>
                ),
              },
              { key: "transports", header: "Transport", hideOnMobile: true, render: (r) => r._count?.transports ?? 0 },
              { key: "status", header: "Status", render: (r) => <ActiveBadge active={r.isActive} /> },
              {
                key: "actions",
                header: "Aksi",
                render: (r) => (
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => (window.location.hash = `#/routes/${r.id}`)}>
                      <MapPin className="h-3.5 w-3.5" /> Checkpoint
                    </Button>
                    {can.update && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)} aria-label={`Edit ${r.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {can.delete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setConfirmDelete(r)}
                        aria-label={`Hapus ${r.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["route", "checkpoint"]} />
        </TabsContent>
      </Tabs>

      {/* Create / edit route dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Rute" : "Tambah Rute"}</DialogTitle>
            <DialogDescription>
              {editing ? "Perbarui informasi rute." : "Setelah rute dibuat, buka editornya untuk menambah checkpoint GPS di peta (minimal 3)."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Nama Rute" htmlFor="r-name">
              <Input id="r-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. JKT - BDG Tol Cipularang" required disabled={busy} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Asal" htmlFor="r-origin">
                <Input id="r-origin" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} placeholder="Jakarta Pusat" disabled={busy} />
              </Field>
              <Field label="Tujuan" htmlFor="r-destination">
                <Input id="r-destination" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="Bandung" disabled={busy} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Buat Rute"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus rute {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Rute yang sudah dipakai transport akan dinonaktifkan. Checkpoint ikut terhapus saat rute dihapus permanen.
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
