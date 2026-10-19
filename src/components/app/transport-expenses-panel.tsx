"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Fuel, HandCoins, ParkingCircle, Pencil, Plus, Trash2, Utensils, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type TransportExpenseRow as BaseExpenseRow } from "@/infrastructure/http/client-api";
import { useAuth } from "@/hooks/use-auth";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { EXPENSE_LABEL, EXPENSE_TYPES, summarizeExpenses, validateExpense, validateExpenseLocation, type ExpenseLocation, type ExpenseType } from "@/domain/transport-ops";
import { fileToCompressedJpeg } from "@/presentation/image-file";
import { expenseProgress } from "@/domain/expense-progress";
import { Field, FormSelect, Input, NumberInput, SubmitButton, formatDate, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const ICON: Record<ExpenseType, typeof Fuel> = { BBM: Fuel, PARKIR: ParkingCircle, MAKAN: Utensils, BONGKAR: HandCoins, ANGKUT: HandCoins, TOL: HandCoins };

type TransportExpenseRow = BaseExpenseRow & {
  status: string;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  approvedAt: string | null;
  approvedById: number | null;
  approvedByUsername: string | null;
  approvedByRole: string | null;
};

function captureLocation(): Promise<ExpenseLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(new Error("GPS tidak tersedia di perangkat ini."));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          locationAccuracy: coords.accuracy,
        };
        const problem = validateExpenseLocation(location);
        if (problem) reject(new Error(problem));
        else resolve(location);
      },
      () =>
        reject(
          new Error(
            "GPS gagal diperoleh. Izinkan akses lokasi dan coba lagi (HTTPS diperlukan).",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

interface FormState {
  type: ExpenseType;
  amount: string;
  description: string;
  /** new photo (data URL); "" = unchanged/none */
  photo: string;
  removePhoto: boolean;
}
const EMPTY: FormState = { type: "BBM", amount: "", description: "", photo: "", removePhoto: false };

/**
 * "Biaya Operasional" of a transport. Every
 * type can have many entries (e.g. 3 BBM fill-ups); the photo proof is optional.
 */
export function TransportExpensesPanel({
  transportId,
  canView = true,
  canCreate: createPermission,
  canUpdate: updatePermission,
  transportStatus,
  canDelete,
  canApprove: approvePermission,
}: {
  transportId: number;
  transportStatus?: string;
  canView?: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove?: boolean;
}) {
  const { user } = useAuth();
  const completed = transportStatus === "COMPLETED";
  const canCreate = createPermission && !completed;
  const canUpdate = updatePermission && !completed;
  const canApprove = approvePermission ?? hasPermission(user, "transport.expense.approve");
  const { data, loading, reload } = useApiData<TransportExpenseRow[]>(
    () => canView ? apiGet<TransportExpenseRow[]>(`/transports/${transportId}/expenses`) : Promise.resolve([]),
    [transportId, canView],
  );
  const rows = useMemo(() => canView ? data ?? [] : [], [data, canView]);
  const summary = useMemo(() => summarizeExpenses(rows), [rows]);
  const progress = expenseProgress(rows);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TransportExpenseRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const submitting = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState<TransportExpenseRow | null>(null);
  const [reversal, setReversal] = useState<{ row: TransportExpenseRow; action: "cancel" | "remove" } | null>(null);
  const [reason, setReason] = useState("");
  const [reversing, setReversing] = useState(false);
  const [viewPhoto, setViewPhoto] = useState<{ title: string; src: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function openCreate(type: ExpenseType = "BBM") {
    setEditing(null);
    setForm({ ...EMPTY, type });
    setDialogOpen(true);
  }
  function openEdit(row: TransportExpenseRow) {
    setEditing(row);
    setForm({ type: row.type, amount: String(row.amount), description: row.description ?? "", photo: "", removePhoto: false });
    setDialogOpen(true);
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const photo = await fileToCompressedJpeg(file);
      setForm((f) => ({ ...f, photo, removePhoto: false }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Foto gagal dibaca.");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (completed) return toast.error("Transport sudah COMPLETED. Biaya operasional dan foto tidak dapat ditambahkan atau diubah.");
    const problem = validateExpense({ type: form.type, amount: form.amount });
    if (problem) return toast.error(problem);
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const location = await captureLocation();
      const payload: Record<string, unknown> = { type: form.type, amount: Number(form.amount), description: form.description.trim() || null, ...location };
      if (form.photo) payload.photo = form.photo;
      if (editing && form.removePhoto) payload.removePhoto = true;
      const ok = await runAction(
        () => (editing ? apiPut(`/transports/${transportId}/expenses/${editing.id}`, payload) : apiPost(`/transports/${transportId}/expenses`, payload)),
        { success: editing ? "Biaya diperbarui." : "Biaya ditambahkan." },
      );
      if (ok) {
        setDialogOpen(false);
        reload();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lokasi GPS gagal diperoleh.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function onApprove(row: TransportExpenseRow) {
    if (approvingId != null) return;
    setApprovingId(row.id);
    try {
      if (await runAction(() => apiPost(`/transports/${transportId}/expenses/${row.id}/approve`), { success: "Biaya disetujui." })) reload();
    } finally {
      setApprovingId(null);
    }
  }

  async function onDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    if (await runAction(() => apiDelete(`/transports/${transportId}/expenses/${target.id}`), { success: "Biaya dihapus." })) reload();
  }

  async function showPhoto(row: TransportExpenseRow) {
    try {
      const full = await apiGet<TransportExpenseRow & { photoUrl: string | null }>(`/transports/${transportId}/expenses/${row.id}`);
      if (full.photoUrl) setViewPhoto({ title: `${row.expenseCode} · ${EXPENSE_LABEL[row.type]}`, src: full.photoUrl });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Foto gagal dimuat.");
    }
  }

  const hasExistingPhoto = !!editing?.hasPhoto && !form.removePhoto && !form.photo;

  return (
    <Card className="min-w-0 rounded-2xl shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" /> Biaya Operasional
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-3">
            {canView && <span className="min-w-0 break-words text-sm font-semibold">Biaya {formatRupiah(progress.submitted)} · Approve {formatRupiah(progress.approved)} ({progress.percentage}%)</span>}
            {canCreate && (
              <Button size="sm" onClick={() => openCreate()}>
                <Plus className="h-3.5 w-3.5" /> Tambah Biaya
              </Button>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {completed
            ? "Transport sudah COMPLETED. Penambahan biaya dan unggah foto ditutup; approval biaya tetap terpisah."
            : "Approval berlaku per biaya, bukan untuk seluruh transport. Biaya baru tetap dapat ditambahkan sampai transport COMPLETED."}
        </p>
        {canView && <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 xl:grid-cols-5">
          {EXPENSE_TYPES.map((t) => {
            const Icon = ICON[t];
            const s = summary.byType[t];
            const amounts = expenseProgress(rows.filter(row => row.type === t));
            return (
              <div key={t} className="rounded-lg border bg-muted/30 p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" /> {EXPENSE_LABEL[t]}
                </p>
                <p className="mt-1 break-all text-sm font-semibold">Biaya {formatRupiah(amounts.submitted)}</p>
                <p className="break-words text-[11px] text-muted-foreground">Approve {formatRupiah(s.total)} ({amounts.percentage}%) · {s.count} disetujui</p>
              </div>
            );
          })}
        </div>}

        {!canView ? (
          <p className="rounded-lg border border-dashed px-3.5 py-4 text-sm text-muted-foreground">Anda tidak memiliki izin melihat daftar biaya. Izin transport.expense.view diperlukan untuk melihat dan memilih biaya yang akan diubah.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Memuat biaya…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3.5 py-4 text-center text-sm text-muted-foreground">Belum ada biaya operasional untuk transport ini.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {rows.map((r) => {
              const Icon = ICON[r.type];
              return (
                <div key={r.id} className="flex min-w-0 flex-wrap items-start gap-3 px-3 py-3 sm:items-center">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">
                      {EXPENSE_LABEL[r.type]} · {formatRupiah(r.amount)}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      <span className="font-mono">{r.expenseCode}</span> · {formatDate(r.createdAt, true)}
                      {r.description ? ` · ${r.description}` : ""}
                    </p>
                    <span className="inline-block rounded border px-1.5 py-0.5 text-xs">
                      {r.status === "APPROVED"
                        ? "Approved"
                        : r.status === "CANCELLED" ? "Cancelled" : "Pending"}
                    </span>
                    {r.cancellationReason && <p className="break-words text-xs text-muted-foreground">Alasan pembatalan: {r.cancellationReason}</p>}
                    {["APPROVED", "CANCELLED"].includes(r.status) && (
                      <p className="text-xs text-muted-foreground">
                        {r.approvedByUsername
                          ? `Approve by ${r.approvedByUsername}(${r.approvedByRole ?? "—"})`
                          : "Biaya lama (migrasi); penyetuju tidak tercatat."}
                        {r.approvedAt
                          ? ` · ${formatDate(r.approvedAt, true)}`
                          : ""}
                      </p>
                    )}
                    {typeof r.latitude === "number" &&
                      typeof r.longitude === "number" &&
                      Number.isFinite(r.latitude) &&
                      Number.isFinite(r.longitude) && (
                        <a
                          className="block text-xs text-primary underline"
                          href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {r.latitude.toFixed(6)},{" "}
                          {r.longitude.toFixed(6)}
                          {r.locationAccuracy != null
                            ? ` (±${r.locationAccuracy.toFixed(0)} m)`
                            : ""}
                        </a>
                      )}
                  </div>
                  {canApprove && r.status === "PENDING" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={approvingId != null}
                      onClick={() => onApprove(r)}
                    >
                      {approvingId === r.id
                        ? "Menyetujui…"
                        : "Approve"}
                    </Button>
                  )}
                  {r.hasPhoto && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => showPhoto(r)} aria-label="Lihat foto bukti">
                      <Camera className="h-4 w-4" />
                    </Button>
                  )}
                  {canUpdate && r.status === "PENDING" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)} aria-label="Edit biaya">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && r.status === "PENDING" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(r)} aria-label="Hapus biaya">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  {canApprove && r.status === "APPROVED" && <Button size="sm" variant="outline" onClick={() => { setReason(""); setReversal({ row: r, action: "cancel" }); }}>Batalkan approval</Button>}
                  {canApprove && ["APPROVED", "CANCELLED"].includes(r.status) && <Button size="sm" variant="destructive" onClick={() => { setReason(""); setReversal({ row: r, action: "remove" }); }}>Hapus biaya</Button>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Biaya" : "Tambah Biaya"}</DialogTitle>
            <DialogDescription>Satu transport boleh punya banyak biaya untuk tiap jenis. Foto bukti opsional. GPS saat ini wajib diambil saat menyimpan. Biaya baru menunggu persetujuan.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Jenis Biaya" htmlFor="x-type">
              <FormSelect
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as ExpenseType })}
                options={EXPENSE_TYPES.map((t) => ({ value: t, label: EXPENSE_LABEL[t] }))}
                disabled={busy}
              />
            </Field>
            <Field label="Nominal (Rp)" htmlFor="x-amount">
              <NumberInput id="x-amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="300000" required disabled={busy} />
            </Field>
            <Field label="Keterangan" htmlFor="x-desc">
              <Input id="x-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Opsional - mis. SPBU Binjai" disabled={busy} />
            </Field>
            <Field label="Foto Bukti" htmlFor="x-photo" hint="Opsional">
              <div className="space-y-2">
                <input ref={fileRef} id="x-photo" type="file" accept="image/*" className="hidden" onChange={(e) => onPickPhoto(e.target.files?.[0])} />
                {form.photo ? (
                  <div className="relative w-fit">
                    <img src={form.photo} alt="Bukti biaya" className="max-h-40 rounded-md border" />
                    <Button type="button" size="icon" variant="secondary" className="absolute -right-2 -top-2 h-6 w-6 rounded-full" onClick={() => setForm({ ...form, photo: "" })} aria-label="Hapus foto">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : hasExistingPhoto ? (
                  <p className="text-xs text-muted-foreground">Sudah ada foto bukti tersimpan.</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                    <Camera className="h-3.5 w-3.5" /> {form.photo || hasExistingPhoto ? "Ganti foto" : "Ambil / pilih foto"}
                  </Button>
                  {hasExistingPhoto && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setForm({ ...form, removePhoto: true })} disabled={busy}>
                      Hapus foto tersimpan
                    </Button>
                  )}
                </div>
              </div>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editing ? "Simpan" : "Tambah"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewPhoto} onOpenChange={(o) => !o && setViewPhoto(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewPhoto?.title}</DialogTitle>
            <DialogDescription>Foto bukti biaya</DialogDescription>
          </DialogHeader>
          {viewPhoto && <img src={viewPhoto.src} alt={viewPhoto.title} className="max-h-[70vh] w-full rounded-md object-contain" />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus biaya ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? `${EXPENSE_LABEL[confirmDelete.type]} ${formatRupiah(confirmDelete.amount)} (${confirmDelete.expenseCode}) akan dihapus.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={!!reversal} onOpenChange={open => { if (!open && !reversing) setReversal(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>{reversal?.action === "cancel" ? "Batalkan approval biaya" : "Hapus biaya"}</DialogTitle><DialogDescription>{reversal?.row.expenseCode} · {reversal?.action === "cancel" ? "Biaya akan tetap terlihat dengan status Cancelled." : "Biaya akan dihapus. Alasan tetap tersimpan di log audit."}</DialogDescription></DialogHeader>
          <form className="min-w-0 space-y-4" onSubmit={async event => {
            event.preventDefault(); if (!reversal || !reason.trim() || reversing) return;
            setReversing(true);
            try {
              const path = `/transports/${transportId}/expenses/${reversal.row.id}`;
              if (await runAction(() => reversal.action === "cancel" ? apiPost(`${path}/cancel`, { reason }) : apiDelete(path, { reason }), { success: reversal.action === "cancel" ? "Biaya dibatalkan." : "Biaya dihapus." })) { setReversal(null); reload(); }
            } finally { setReversing(false); }
          }}>
            <Field label="Alasan (wajib)" htmlFor="expense-reason"><Input id="expense-reason" value={reason} maxLength={1000} required onChange={event => setReason(event.target.value)} disabled={reversing} /></Field>
            <DialogFooter><Button type="button" variant="outline" disabled={reversing} onClick={() => setReversal(null)}>Kembali</Button><SubmitButton busy={reversing} disabled={!reason.trim()}>{reversal?.action === "cancel" ? "Batalkan approval" : "Hapus biaya"}</SubmitButton></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
