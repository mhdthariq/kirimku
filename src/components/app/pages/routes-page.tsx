"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Check, MapPin, Pencil, Plus, RotateCcw, Trash2, Waypoints } from "lucide-react";
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
import { metersToKm } from "@/components/app/checkpoint-geo";

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

  // ---------------------------------------------------------------------
  // Revision Parts B/D/AA — ONE draft collection as the single source of
  // truth. Drafts are keyed by route id and derived from the SERVER list
  // until the user edits anything. Adding a checkpoint appends to the
  // existing items — existing checkpoints can never disappear. The main
  // "Simpan Semua Checkpoint" action bulk-saves the whole collection.
  // ---------------------------------------------------------------------
  const toDraft = (c: Checkpoint): DraftCheckpoint => ({
    id: c.id,
    name: c.name,
    latitude: c.latitude,
    longitude: c.longitude,
    radiusMeters: c.radiusMeters,
  });
  const [draftsState, setDraftsState] = useState<{ routeId: number | null; items: DraftCheckpoint[]; base: DraftCheckpoint[] }>({
    routeId: null,
    items: [],
    base: [],
  });
  const selectedRouteId = selectedRoute?.id ?? null;
  const serverDrafts = useMemo(
    () => (selectedRoute?.checkpoints ?? []).map(toDraft),
    [selectedRoute],
  );
  const drafts = draftsState.routeId === selectedRouteId ? draftsState.items : serverDrafts;
  const baseDrafts = draftsState.routeId === selectedRouteId ? draftsState.base : serverDrafts;

  const setDrafts = useCallback(
    (next: DraftCheckpoint[]) => setDraftsState((s) => ({ routeId: selectedRouteId, items: next, base: s.routeId === selectedRouteId ? s.base : serverDrafts })),
    [selectedRouteId, serverDrafts],
  );

  // Dirty = the draft collection differs from the server state (name, coords,
  // radius, order or membership).  Simplified structural compare by value.
  const cpSignature = (list: DraftCheckpoint[]) =>
    list.map((c) => `${c.name.trim()}|${c.latitude.toFixed(7)}|${c.longitude.toFixed(7)}|${Math.round(c.radiusMeters)}`).join(";");
  const dirty = cpSignature(drafts) !== cpSignature(baseDrafts);
  const newCount = drafts.filter((d) => !d.id).length;

  // Warn before navigating away with unsaved checkpoint edits
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    const onHashChange = () => {
      if (dirtyRef.current) toast.info("Ada perubahan checkpoint yang belum disimpan — kembali ke rute untuk menyimpan.");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // ---------------------------------------------------------------------
  // Main save (Revision Part D/AA): ONE bulk request persists the entire
  // collection — new checkpoints are created, existing ones updated, removed
  // ones deleted — inside a single transaction.
  // ---------------------------------------------------------------------
  const saveAllCheckpoints = useCallback(async () => {
    const route = selectedRoute;
    if (!route) return;
    if (drafts.length < 3) {
      toast.error(`Rute wajib memiliki minimal 3 checkpoint (saat ini: ${drafts.length}).`);
      return;
    }
    if (drafts.some((d) => !d.name.trim())) {
      toast.error("Semua checkpoint wajib memiliki nama sebelum menyimpan.");
      return;
    }
    const ok = await runAction(
      () =>
        apiPut(`/routes/${route.id}/checkpoints`, {
          checkpoints: drafts.map((d) => ({
            id: d.id,
            name: d.name.trim(),
            latitude: d.latitude,
            longitude: d.longitude,
            radiusMeters: d.radiusMeters,
          })),
        }),
      { success: `Semua checkpoint tersimpan (${drafts.length} checkpoint).` },
    );
    if (ok) {
      const updated = await apiGet<RouteModel[]>(`/routes`);
      const fresh = updated.find((r) => r.id === route.id);
      const freshDrafts = (fresh?.checkpoints ?? []).map(toDraft);
      setDraftsState({ routeId: route.id, items: freshDrafts, base: freshDrafts });
      reload();
    }
  }, [selectedRoute, drafts, reload]);

  const resetDrafts = useCallback(() => {
    setDraftsState((s) => ({ ...s, items: s.base }));
  }, []);

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


  if (!can.view) {
    return <PageHeader title="Rute & Checkpoint" subtitle="Anda tidak memiliki izin melihat rute." />;
  }

  // ----- Detail view: checkpoint editor for a selected route -----
  if (selectedRoute) {
    const totalRadiusKm = drafts.reduce((s, d) => s + metersToKm(d.radiusMeters), 0);
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => (window.location.hash = "#/routes")} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Semua rute
        </Button>

        <PageHeader
          title={selectedRoute.name}
          subtitle={`${selectedRoute.origin ?? "?"} → ${selectedRoute.destination ?? "?"} · ${drafts.length} checkpoint · dipakai ${selectedRoute._count?.transports ?? 0} transport`}
          icon={<Waypoints className="h-5 w-5" />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {can.update && (
                <Button variant="outline" onClick={() => openEdit(selectedRoute)}>
                  <Pencil className="h-4 w-4" /> Edit Rute
                </Button>
              )}
              {(can.create || can.update) && (
                <>
                  {dirty && (
                    <Button variant="ghost" onClick={resetDrafts} className="text-muted-foreground">
                      <RotateCcw className="h-4 w-4" /> Reset
                    </Button>
                  )}
                  <Button onClick={saveAllCheckpoints} disabled={!dirty || busy} title={dirty ? "Simpan seluruh koleksi checkpoint" : "Tidak ada perubahan"}>
                    <Check className="h-4 w-4" /> Simpan Semua Checkpoint
                  </Button>
                </>
              )}
            </div>
          }
        />

        {/* Status strip — one source of truth for the collection state */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-semibold text-foreground">
            <MapPin className="h-3.5 w-3.5 text-primary" /> Koleksi Checkpoint
          </span>
          <span>Total: <strong className="text-foreground">{drafts.length}</strong></span>
          <span>Baru (belum tersimpan): <strong className="text-foreground">{newCount}</strong></span>
          <span>Total radius: <strong className="text-foreground">{totalRadiusKm.toFixed(2)} KM</strong></span>
          <span className={dirty ? "font-semibold text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
            {dirty ? "Ada perubahan belum disimpan" : "Sinkron dengan server"}
          </span>
        </div>

        <CheckpointMapEditor
          checkpoints={drafts}
          onChange={setDrafts}
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
              {editing ? "Perbarui informasi rute." : "Setelah rute dibuat, buka editornya untuk menambah checkpoint GPS di peta (minimal 3). Semua checkpoint disimpan sekaligus lewat tombol “Simpan Semua Checkpoint”."}
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
