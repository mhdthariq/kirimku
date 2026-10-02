"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Fuel, HandCoins, ParkingCircle, Pencil, Plus, Trash2, Utensils, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost, apiPut, type TransportExpenseRow } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { EXPENSE_LABEL, EXPENSE_TYPES, summarizeExpenses, validateExpense, type ExpenseType } from "@/lib/transport-ops";
import { fileToCompressedJpeg } from "@/lib/image-file";
import { Field, FormSelect, Input, NumberInput, SubmitButton, formatDate, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const ICON: Record<ExpenseType, typeof Fuel> = { BBM: Fuel, PARKIR: ParkingCircle, MAKAN: Utensils, BONGKAR: HandCoins };

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
 * "Biaya Operasional" of a transport: BBM, Parkir, Makan and Bongkar. Every
 * type can have many entries (e.g. 3 BBM fill-ups); the photo proof is optional.
 */
export function TransportExpensesPanel({
  transportId,
  canCreate,
  canUpdate,
  canDelete,
}: {
  transportId: number;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const { data, loading, reload } = useApiData<TransportExpenseRow[]>(() => apiGet<TransportExpenseRow[]>(`/transports/${transportId}/expenses`), [transportId]);
  const rows = useMemo(() => data ?? [], [data]);
  const summary = useMemo(() => summarizeExpenses(rows), [rows]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TransportExpenseRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TransportExpenseRow | null>(null);
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
    const problem = validateExpense({ type: form.type, amount: form.amount });
    if (problem) return toast.error(problem);
    setBusy(true);
    const payload: Record<string, unknown> = { type: form.type, amount: Number(form.amount), description: form.description.trim() || null };
    if (form.photo) payload.photo = form.photo;
    if (editing && form.removePhoto) payload.removePhoto = true;
    const ok = await runAction(
      () => (editing ? apiPut(`/transports/${transportId}/expenses/${editing.id}`, payload) : apiPost(`/transports/${transportId}/expenses`, payload)),
      { success: editing ? "Biaya diperbarui." : "Biaya ditambahkan." },
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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" /> Biaya Operasional
          </span>
          <span className="flex items-center gap-3">
            <span className="text-sm font-semibold">{formatRupiah(summary.total)}</span>
            {canCreate && (
              <Button size="sm" onClick={() => openCreate()}>
                <Plus className="h-3.5 w-3.5" /> Tambah Biaya
              </Button>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {EXPENSE_TYPES.map((t) => {
            const Icon = ICON[t];
            const s = summary.byType[t];
            return (
              <div key={t} className="rounded-lg border bg-muted/30 p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" /> {EXPENSE_LABEL[t]}
                </p>
                <p className="mt-1 text-sm font-semibold">{formatRupiah(s.total)}</p>
                <p className="text-[11px] text-muted-foreground">{s.count} transaksi</p>
              </div>
            );
          })}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Memuat biaya…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3.5 py-4 text-center text-sm text-muted-foreground">Belum ada biaya operasional untuk transport ini.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {rows.map((r) => {
              const Icon = ICON[r.type];
              return (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {EXPENSE_LABEL[r.type]} · {formatRupiah(r.amount)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{r.expenseCode}</span> · {formatDate(r.createdAt, true)}
                      {r.description ? ` · ${r.description}` : ""}
                    </p>
                  </div>
                  {r.hasPhoto && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => showPhoto(r)} aria-label="Lihat foto bukti">
                      <Camera className="h-4 w-4" />
                    </Button>
                  )}
                  {canUpdate && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)} aria-label="Edit biaya">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(r)} aria-label="Hapus biaya">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Biaya" : "Tambah Biaya"}</DialogTitle>
            <DialogDescription>Satu transport boleh punya banyak biaya untuk tiap jenis. Foto bukti opsional.</DialogDescription>
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
                <input ref={fileRef} id="x-photo" type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPickPhoto(e.target.files?.[0])} />
                {form.photo ? (
                  <div className="relative w-fit">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.photo} alt="Bukti biaya" className="max-h-40 rounded-md border" />
                    <Button type="button" size="icon" variant="secondary" className="absolute -right-2 -top-2 h-6 w-6 rounded-full" onClick={() => setForm({ ...form, photo: "" })} aria-label="Hapus foto">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : hasExistingPhoto ? (
                  <p className="text-xs text-muted-foreground">Sudah ada foto bukti tersimpan.</p>
                ) : null}
                <div className="flex gap-2">
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewPhoto?.title}</DialogTitle>
            <DialogDescription>Foto bukti biaya</DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
    </Card>
  );
}
