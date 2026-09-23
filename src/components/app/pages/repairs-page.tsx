"use client";

import { useMemo, useState } from "react";
import {
  Clock,
  ExternalLink,
  FileImage,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  hasPermission,
  type VehicleRepairRow,
  type RepairActionLogRow,
} from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, FormSelect, NumberInput, SubmitButton, formatRupiah, formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Repair Verification (simplified §19/§22 flow) — dual mode:
 *  · Vehicle Owner → READ-ONLY: list + detail + action logs for their own
 *    vehicles. No approval buttons — creating a repair no longer needs the
 *    owner's confirmation.
 *  · Company (repair.view/create/update/delete) → full management: create is
 *    immediately VERIFIED (wallet deducted atomically); records can be
 *    edited (wallet auto-adjusted) or deleted (deduction refunded).
 *
 * TWO LOGS are always visible:
 *  1. Per-item log — inside each repair's detail dialog (when it was created
 *     and every change made to it, field by field).
 *  2. Activity log — "Log Aksi" tab next to the list tab: when records are
 *     created, changed, or deleted (deleted records survive here with their
 *     snapshots).
 */
export function RepairsPage() {
  const { user } = useAuth();
  const isVehicleOwner = user?.partnerType === "VEHICLE_OWNER";
  const canCompanyView = hasPermission(user, "repair.view");
  const canCreate = hasPermission(user, "repair.create");
  const canEdit = hasPermission(user, "repair.update");
  const canDelete = hasPermission(user, "repair.delete");

  const { data, loading, reload } = useApiData<VehicleRepairRow[]>(() => apiGet<VehicleRepairRow[]>("/repairs"), []);
  const [tab, setTab] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VehicleRepairRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VehicleRepairRow | null>(null);
  const [detail, setDetail] = useState<VehicleRepairRow | null>(null);
  const [logVersion, setLogVersion] = useState(0);

  // Company users need the vehicle list for the create/edit forms.
  const { data: vehicles } = useApiData<{ id: number; vehicleNumber: string; owner?: { id: number } | null }[]>(
    () => (canCreate || canEdit ? apiGet("/vehicles") : Promise.resolve([])),
    [canCreate, canEdit],
  );
  // Only partner-owned vehicles are eligible (repairs deduct from the Vehicle
  // Owner's profit — company vehicles have no owner to charge).
  const vehicleOptions = (vehicles ?? [])
    .filter((v) => v.owner != null)
    .map((v) => ({ value: String(v.id), label: v.vehicleNumber }));

  const rows = useMemo(() => data ?? [], [data]);

  function refreshAll() {
    reload();
    setLogVersion((v) => v + 1); // re-fetch both log views
  }

  async function onDelete(repair: VehicleRepairRow) {
    const ok = await runAction(() => apiDelete(`/repairs/${repair.id}`), {
      success: `Repair ${repair.repairCode} dihapus - deduction ${formatRupiah(repair.deductedAmount)} dikembalikan ke wallet Vehicle Owner. Tercatat di log aksi.`,
    });
    if (ok) {
      setDeleteTarget(null);
      refreshAll();
    }
  }

  if (!isVehicleOwner && !canCompanyView) {
    return <PageHeader title="Repair Verification" subtitle="Anda tidak memiliki izin melihat data repair." icon={<Wrench className="h-5 w-5" />} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Repair Verification"
        subtitle={
          isVehicleOwner
            ? "Biaya repair untuk kendaraan Anda - setiap pembuatan, perubahan, dan penghapusan record tercatat di log aksi."
            : "Record repair langsung TERVERIFIKASI dan wallet Vehicle Owner langsung didebit saat dibuat. Semua aksi tercatat di log."
        }
        icon={<Wrench className="h-5 w-5" />}
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Catat Repair
            </Button>
          ) : undefined
        }
      />

      {/* List + activity log share the page via tabs (same pattern as
          Shipments/Pickups "Daftar | Log Aktivitas") - the log is no longer
          stacked below the list. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Daftar</TabsTrigger>
          <TabsTrigger value="log">Log Aksi</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-3">
          <DataTable
            rows={rows}
            loading={loading}
            emptyMessage="Belum ada record repair."
            columns={[
              {
                key: "code",
                header: "Kode",
                primary: true,
                render: (r) => (
                  <div>
                    <p className="font-mono text-xs font-semibold">{r.repairCode}</p>
                    <p className="text-xs text-muted-foreground">{r.vehicle.vehicleNumber}</p>
                  </div>
                ),
              },
              {
                key: "desc",
                header: "Repair",
                render: (r) => (
                  <div>
                    <p className="text-sm font-medium">{r.description}</p>
                    <p className="text-xs text-muted-foreground">{r.workshopVendor ?? "-"} · {formatDate(r.repairDate)}</p>
                  </div>
                ),
              },
              { key: "amount", header: "Biaya (Deducted)", render: (r) => (
                <div>
                  <span className="font-semibold text-destructive">{formatRupiah(r.amount)}</span>
                  <p className="text-[10px] text-muted-foreground">dari wallet owner</p>
                </div>
              ) },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              ...(isVehicleOwner
                ? []
                : [
                    {
                      key: "owner",
                      header: "Vehicle Owner",
                      hideOnMobile: true,
                      render: (r: VehicleRepairRow) => <span className="text-sm">{r.owner?.user?.name ?? "-"}</span>,
                    } as const,
                  ]),
              {
                key: "actions",
                header: "Aksi",
                render: (r) => (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setDetail(r)}>
                      Detail
                    </Button>
                    {canEdit && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => setEditTarget(r)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={() => setDeleteTarget(r)}>
                        <Trash2 className="h-3.5 w-3.5" /> Hapus
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="log" className="mt-3">
          {/* LOG #2 - global activity log (created / changed / deleted), now a
              tab instead of a panel below the list. */}
          <RepairActivityLogPanel version={logVersion} />
        </TabsContent>
      </Tabs>

      <CreateRepairDialog
        key={createOpen ? "open" : "closed"}
        open={createOpen}
        vehicleOptions={vehicleOptions}
        onOpenChange={setCreateOpen}
        onDone={refreshAll}
      />
      <EditRepairDialog
        repair={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        onDone={() => {
          setEditTarget(null);
          refreshAll();
        }}
      />
      <RepairDetailDialog repair={detail} onOpenChange={(open) => !open && setDetail(null)} />
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus repair {deleteTarget?.repairCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Record {deleteTarget?.repairCode} ({deleteTarget?.description} - {formatRupiah(deleteTarget?.amount ?? 0)}) akan dihapus dan
              deduction {formatRupiah(deleteTarget?.deductedAmount ?? 0)} dikembalikan ke wallet Vehicle Owner.
              Vehicle Owner tetap bisa melihat bekas record ini di log aksi (dibuat → dihapus).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && onDelete(deleteTarget)}
            >
              Ya, Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repair action log timeline (shared renderer)
// ---------------------------------------------------------------------------

const ACTION_META: Record<string, { label: string; icon: React.ReactNode; badge: string; dot: string }> = {
  CREATED: { label: "Dibuat", icon: <Plus className="h-3 w-3" />, badge: "bg-primary/10 text-primary", dot: "bg-primary" },
  UPDATED: { label: "Diubah", icon: <Pencil className="h-3 w-3" />, badge: "bg-chart-3/15 text-chart-3", dot: "bg-chart-3" },
  DELETED: { label: "Dihapus", icon: <Trash2 className="h-3 w-3" />, badge: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
};

const FIELD_LABELS: Record<string, string> = {
  description: "Deskripsi",
  amount: "Biaya",
  repairDate: "Tanggal Repair",
  workshopVendor: "Bengkel / Vendor",
  notes: "Catatan",
  relatedTransportId: "Transport Terkait",
  proofUrl: "Bukti",
};

function formatChangeValue(field: string, value: unknown): string {
  if (value == null || value === "") return "-";
  if (field === "amount") return formatRupiah(Number(value));
  return String(value);
}

export function RepairLogTimeline({ logs, showRepairCode }: { logs: RepairActionLogRow[]; showRepairCode?: boolean }) {
  if (logs.length === 0) {
    return <p className="px-1 py-4 text-center text-xs text-muted-foreground">Belum ada aktivitas tercatat.</p>;
  }
  return (
    <ol className="relative ml-2 space-y-0 border-l pl-4">
      {logs.map((log) => {
        const meta = ACTION_META[log.action] ?? ACTION_META.UPDATED;
        const changes = log.changes ?? {};
        const changedFields = Object.keys(changes);
        return (
          <li key={log.id} className="relative pb-4 pt-1 last:pb-1">
            <span className={cn("absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card", meta.dot)} />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", meta.badge)}>
                {meta.icon} {meta.label}
              </span>
              {showRepairCode && <span className="font-mono text-xs font-semibold">{log.repairCode}</span>}
              {log.amount != null && <span className="text-xs font-medium text-destructive">{formatRupiah(log.amount)}</span>}
            </div>
            <p className="mt-1 text-xs text-foreground">{log.detail}</p>
            {changedFields.length > 0 && (
              <div className="mt-1 space-y-0.5 rounded-lg border bg-muted/30 px-2 py-1.5">
                {changedFields.map((f) => (
                  <p key={f} className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{FIELD_LABELS[f] ?? f}:</span>{" "}
                    {f === "proofUrl" ? (
                      "bukti diganti"
                    ) : (
                      <>
                        <span className="line-through opacity-70">{formatChangeValue(f, changes[f].before)}</span>
                        {" → "}
                        <span className="font-medium text-foreground">{formatChangeValue(f, changes[f].after)}</span>
                      </>
                    )}
                  </p>
                ))}
              </div>
            )}
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {formatDate(log.createdAt, true)} · oleh {log.actorName ?? "System"}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// LOG #2 — activity log panel below the list
// ---------------------------------------------------------------------------

const LOG_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "CREATED", label: "Dibuat" },
  { key: "UPDATED", label: "Diubah" },
  { key: "DELETED", label: "Dihapus" },
];

export function RepairActivityLogPanel({ version }: { version: number }) {
  const [filter, setFilter] = useState("all");
  const query = `/repairs/logs?limit=100${filter === "all" ? "" : `&action=${filter}`}`;
  const { data, loading, reload } = useApiData<RepairActionLogRow[]>(() => apiGet<RepairActionLogRow[]>(query), [query, version]);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Log Aksi Repair</p>
          {!loading && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {(data ?? []).length} entri
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            {LOG_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  filter === f.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reload} aria-label="Muat ulang log">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto p-3">
        {loading ? (
          <div className="space-y-1 p-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        ) : (
          <RepairLogTimeline logs={data ?? []} showRepairCode />
        )}
      </div>
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        Log permanen (append-only): setiap record yang dibuat, diubah, atau dihapus tetap terlihat di sini - termasuk record yang sudah dihapus.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit dialogs
// ---------------------------------------------------------------------------

interface RepairFormState {
  vehicleId: string;
  description: string;
  amount: string;
  repairDate: string;
  workshopVendor: string;
  notes: string;
}

const EMPTY_FORM: RepairFormState = { vehicleId: "", description: "", amount: "", repairDate: "", workshopVendor: "", notes: "" };

function useProofUpload() {
  const [proof, setProof] = useState<{ name: string; type: string; dataUrl: string } | null>(null);
  const [proofError, setProofError] = useState("");

  function onProofChange(file: File | undefined) {
    setProofError("");
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      setProofError("Pilih file gambar atau PDF.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setProofError("Ukuran file maksimal 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setProof({ name: file.name, type: file.type, dataUrl: String(reader.result) });
    reader.onerror = () => setProofError("File tidak bisa dibaca. Coba pilih file lain.");
    reader.readAsDataURL(file);
  }
  return { proof, proofError, onProofChange, setProof, setProofError };
}

function ProofField({
  proof,
  proofError,
  onProofChange,
  optional,
}: {
  proof: { name: string; type: string; dataUrl: string } | null;
  proofError: string;
  onProofChange: (file: File | undefined) => void;
  optional?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">
        Bukti Repair {!optional && <span className="text-destructive">*</span>}
      </p>
      {optional && <p className="text-[11px] text-muted-foreground">Biarkan kosong untuk mempertahankan bukti yang sudah ada.</p>}
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-3 text-sm hover:bg-primary/10">
        <Upload className="h-4 w-4 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{proof ? proof.name : "Pilih nota, invoice, atau foto"}</span>
          <span className="block text-xs text-muted-foreground">JPG, PNG, WEBP, atau PDF · maksimal 8 MB</span>
        </span>
        <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => onProofChange(e.target.files?.[0])} />
      </label>
      {proofError && <p className="text-xs text-destructive">{proofError}</p>}
      {proof?.type.startsWith("image/") && <img src={proof.dataUrl} alt="Preview bukti repair" className="max-h-40 w-full rounded-lg border object-contain" />}
      {proof?.type === "application/pdf" && <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">PDF siap diunggah dan dapat dibuka kembali dari detail repair.</p>}
    </div>
  );
}

function CreateRepairDialog({
  open,
  onOpenChange,
  onDone,
  vehicleOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  vehicleOptions: { value: string; label: string }[];
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<RepairFormState>(EMPTY_FORM);
  const { proof, proofError, onProofChange, setProof, setProofError } = useProofUpload();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await runAction(
      () =>
        apiPost("/repairs", {
          vehicleId: Number(form.vehicleId),
          description: form.description,
          amount: Number(form.amount),
          repairDate: form.repairDate || null,
          workshopVendor: form.workshopVendor || null,
          notes: form.notes || null,
          proofUrl: proof?.dataUrl,
        }),
      { success: "Repair tercatat & langsung TERVERIFIKASI - wallet Vehicle Owner didebit. Tercatat di log aksi." },
    );
    if (ok) {
      setForm(EMPTY_FORM);
      setProof(null);
      setProofError("");
      onOpenChange(false);
      onDone();
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Catat Repair / Maintenance</DialogTitle>
          <DialogDescription>
            Record langsung TERVERIFIKASI dan wallet Vehicle Owner langsung didebit saat disimpan - tanpa alur approval.
            Bukti (nota/invoice) wajib dilampirkan. Vehicle Owner melihat semua ini lewat log aksi.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Kendaraan">
            <FormSelect
              value={form.vehicleId}
              onValueChange={(value) => setForm({ ...form, vehicleId: value })}
              placeholder="Pilih kendaraan…"
              options={vehicleOptions}
              required
            />
          </Field>
          <Field label="Deskripsi Repair">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="mis. Ganti oli + servis rem" rows={2} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Biaya (Rupiah)">
              <NumberInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} min={1} required />
            </Field>
            <Field label="Tanggal Repair">
              <input
                type="date"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                value={form.repairDate}
                onChange={(e) => setForm({ ...form, repairDate: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Bengkel / Vendor">
            <Textarea value={form.workshopVendor} onChange={(e) => setForm({ ...form, workshopVendor: e.target.value })} rows={1} />
          </Field>
          <Field label="Catatan">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </Field>
          <ProofField proof={proof} proofError={proofError} onProofChange={onProofChange} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <SubmitButton busy={busy} disabled={!proof}>Simpan & Verifikasi</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRepairDialog({
  repair,
  onOpenChange,
  onDone,
}: {
  repair: VehicleRepairRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<RepairFormState>(EMPTY_FORM);
  const [initialized, setInitialized] = useState<number | null>(null);
  const { proof, proofError, onProofChange, setProof, setProofError } = useProofUpload();

  // Prefill when a new repair target opens (id-guard so re-renders don't clobber typing).
  if (repair && initialized !== repair.id) {
    setInitialized(repair.id);
    setForm({
      vehicleId: String(repair.vehicleId),
      description: repair.description,
      amount: String(repair.amount),
      repairDate: repair.repairDate.slice(0, 10),
      workshopVendor: repair.workshopVendor ?? "",
      notes: repair.notes ?? "",
    });
    setProof(null);
    setProofError("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!repair) return;
    setBusy(true);
    const ok = await runAction(
      () =>
        apiPut(`/repairs/${repair.id}`, {
          description: form.description,
          amount: Number(form.amount),
          repairDate: form.repairDate || null,
          workshopVendor: form.workshopVendor || null,
          notes: form.notes || null,
          proofUrl: proof?.dataUrl ?? null,
        }),
      { success: `Repair ${repair.repairCode} diperbarui - perubahan & penyesuaian wallet tercatat di log aksi.` },
    );
    if (ok) {
      setInitialized(null);
      onDone();
    }
    setBusy(false);
  }

  if (!repair) return null;

  return (
    <Dialog open={!!repair} onOpenChange={(open) => { if (!open) setInitialized(null); onOpenChange(open); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Repair {repair.repairCode}</DialogTitle>
          <DialogDescription>
            Perubahan tercatat di log aksi (field apa yang berubah, siapa, kapan). Jika biaya berubah, wallet Vehicle
            Owner otomatis disesuaikan: selisih ditambahkan atau dikembalikan. Kendaraan tidak bisa diganti - hapus
            record dan buat ulang jika salah kendaraan.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Kendaraan">
            <FormSelect value={String(repair.vehicleId)} onValueChange={() => {}} options={[{ value: String(repair.vehicleId), label: `${repair.vehicle.vehicleNumber} (tidak dapat diubah)` }]} required />
          </Field>
          <Field label="Deskripsi Repair">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Biaya (Rupiah)">
              <NumberInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} min={1} required />
            </Field>
            <Field label="Tanggal Repair">
              <input
                type="date"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                value={form.repairDate}
                onChange={(e) => setForm({ ...form, repairDate: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Bengkel / Vendor">
            <Textarea value={form.workshopVendor} onChange={(e) => setForm({ ...form, workshopVendor: e.target.value })} rows={1} />
          </Field>
          <Field label="Catatan">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </Field>
          <ProofField proof={proof} proofError={proofError} onProofChange={onProofChange} optional />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setInitialized(null); onOpenChange(false); }}>Batal</Button>
            <SubmitButton busy={busy}>Simpan Perubahan</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Detail dialog — with LOG #1 (per-item action log)
// ---------------------------------------------------------------------------

function RepairDetailDialog({ repair, onOpenChange }: { repair: VehicleRepairRow | null; onOpenChange: (open: boolean) => void }) {
  const repairId = repair?.id ?? null;
  const { data: logs, loading: logsLoading } = useApiData<RepairActionLogRow[]>(
    () => (repairId != null ? apiGet<RepairActionLogRow[]>(`/repairs/logs?repairId=${repairId}&limit=100`) : Promise.resolve([])),
    [repairId],
  );

  if (!repair) return null;
  return (
    <Dialog open={!!repair} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{repair.repairCode} · {repair.vehicle.vehicleNumber}</DialogTitle>
          <DialogDescription>
            {repair.description} - {formatRupiah(repair.amount)} (terdeduct dari wallet Vehicle Owner)
          </DialogDescription>
        </DialogHeader>
        {/* Tabs keep the dialog clean: data repair di tab pertama, riwayat
            aksi (kapan dibuat & siapa mengubah apa) di tab kedua. */}
        <Tabs defaultValue="detail">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="detail">Detail Repair</TabsTrigger>
            <TabsTrigger value="log">
              Log Item Ini
              {!logsLoading && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">{(logs ?? []).length}</span>}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="detail" className="mt-3 space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <DetailItem label="Bengkel" value={repair.workshopVendor ?? "-"} />
              <DetailItem label="Tanggal Repair" value={formatDate(repair.repairDate)} />
              <DetailItem label="Dibuat" value={formatDate(repair.createdAt, true)} />
              <DetailItem label="Status" value="Terverifikasi & Terdeduct" />
            </div>
            {repair.notes && <DetailItem label="Catatan" value={repair.notes} />}
            {repair.proofUrl && (
              <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-primary"><FileImage className="h-3.5 w-3.5" /> Bukti Repair</p>
                {repair.proofUrl.startsWith("data:image/") && <img src={repair.proofUrl} alt={`Bukti ${repair.repairCode}`} className="max-h-64 w-full rounded-md border bg-white object-contain" />}
                <a href={repair.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> Buka bukti dalam tab baru
                </a>
              </div>
            )}
          </TabsContent>
          <TabsContent value="log" className="mt-3">
            {/* LOG #1 - per-item action log */}
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <History className="h-3.5 w-3.5" /> Log Item Ini - kapan dibuat & siapa mengubah apa
              </p>
              {logsLoading ? (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Memuat log…
                </div>
              ) : (
                <RepairLogTimeline logs={logs ?? []} />
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
