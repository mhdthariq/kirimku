"use client";

import { useState } from "react";
import { Landmark, Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPost, apiPut, apiDelete, hasPermission, type BankAccount } from "@/infrastructure/http/client-api";
import { useApiData, runAction } from "@/hooks/use-api-data";
import { parseBankAccount } from "@/domain/bank-account";
import { DashboardHeading, DashboardError } from "@/components/app/dashboard-ui";
import { Field, Input, FormSelect, SubmitButton } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

const EMPTY = { bankName: "", accountNumber: "", accountName: "", isActive: true };

export function BankAccountsPage() {
  const { user } = useAuth();
  const can = { view: hasPermission(user, "bank_account.view"), create: hasPermission(user, "bank_account.create"), update: hasPermission(user, "bank_account.update"), remove: hasPermission(user, "bank_account.delete") };
  const { data, error, loading, reload } = useApiData<BankAccount[]>(() => can.view ? apiGet("/bank-accounts") : Promise.resolve([]), [can.view]);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [deactivating, setDeactivating] = useState<BankAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  if (!can.view) return <DashboardHeading eyebrow="Finance" title="Master Rekening" description="Anda tidak memiliki izin melihat master rekening." />;
  if (error) return <DashboardError message={error} onRetry={() => { void reload(); }} />;
  const rows = (data ?? []).filter(row => (filter === "all" || row.isActive === (filter === "active")) && `${row.bankName} ${row.accountName} ${row.accountNumber}`.toLowerCase().includes(search.toLowerCase()));
  function showForm(account: BankAccount | null) {
    setEditing(account);
    setForm(account ? { bankName: account.bankName, accountNumber: account.accountNumber, accountName: account.accountName, isActive: account.isActive } : EMPTY);
    setOpen(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const input = parseBankAccount(form);
    if (typeof input === "string") return toast.error(input);
    setBusy(true);
    const ok = await runAction(() => editing ? apiPut(`/bank-accounts/${editing.id}`, input) : apiPost("/bank-accounts", input), { success: "Rekening disimpan." });
    setBusy(false);
    if (ok) { setOpen(false); await reload(); }
  }
  async function deactivate() {
    if (!deactivating || busy) return;
    setBusy(true);
    const ok = await runAction(() => apiDelete(`/bank-accounts/${deactivating.id}`), { success: "Rekening dinonaktifkan. Rekening pada invoice lama tetap tersimpan." });
    setBusy(false);
    if (ok) { setDeactivating(null); await reload(); }
  }
  return <div className="dashboard-workspace mx-auto min-w-0 max-w-[1600px] space-y-6">
    <DashboardHeading eyebrow="Finance" title="Master Rekening" description="Kelola rekening tujuan pembayaran yang dapat dipilih pada invoice." actions={can.create && <Button className="min-h-10" onClick={() => showForm(null)}><Plus className="h-4 w-4" /> Tambah Rekening</Button>} />
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row"><Input aria-label="Cari rekening" value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari bank, nama, atau nomor rekening…" className="min-w-0 flex-1" /><div className="w-full sm:w-48"><FormSelect ariaLabel="Filter status rekening" value={filter} onValueChange={setFilter} options={[{ value: "all", label: "Semua rekening" }, { value: "active", label: "Aktif" }, { value: "inactive", label: "Nonaktif" }]} /></div></div>
    {loading ? <p role="status" className="rounded-2xl border p-6 text-sm text-muted-foreground">Memuat rekening…</p> : rows.length === 0 ? <p className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">Belum ada rekening yang cocok. Tambahkan rekening tujuan pembayaran invoice.</p> : <div className="grid min-w-0 gap-4 md:grid-cols-2 2xl:grid-cols-3">{rows.map(account => <article key={account.id} className="min-w-0 space-y-5 rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><span className="rounded-xl bg-primary/10 p-2.5 text-primary"><Landmark className="h-5 w-5" /></span><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${account.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{account.isActive ? "Aktif" : "Nonaktif"}</span></div><dl className="space-y-3"><div><dt className="text-xs text-muted-foreground">Bank</dt><dd className="mt-1 break-words text-lg font-semibold">{account.bankName}</dd></div><div><dt className="text-xs text-muted-foreground">No. Rekening</dt><dd className="mt-1 break-all font-mono text-xl font-semibold tracking-wide">{account.accountNumber}</dd></div><div><dt className="text-xs text-muted-foreground">Nama Rekening</dt><dd className="mt-1 break-words text-sm font-medium">{account.accountName}</dd></div></dl><div className="flex flex-wrap gap-2 border-t pt-4">{can.update && <Button variant="outline" className="min-h-10" size="sm" onClick={() => showForm(account)} aria-label={`Edit rekening ${account.accountNumber}`}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}{can.remove && account.isActive && <Button variant="outline" className="min-h-10" size="sm" onClick={() => setDeactivating(account)} aria-label={`Nonaktifkan rekening ${account.accountNumber}`}><Power className="h-3.5 w-3.5" /> Nonaktifkan</Button>}</div></article>)}</div>}
    <p className="text-xs leading-relaxed text-muted-foreground">Invoice menyimpan detail rekening saat dipilih. Perubahan master rekening tidak mengubah informasi pembayaran pada invoice yang sudah dibuat.</p>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{editing ? "Edit Rekening" : "Tambah Rekening"}</DialogTitle><DialogDescription>Rekening aktif dapat dipilih pada invoice. Pastikan nomor dan nama rekening sesuai dengan data bank.</DialogDescription></DialogHeader><form onSubmit={save} className="space-y-4"><Field label="Bank" htmlFor="bank-name"><Input id="bank-name" maxLength={100} required disabled={busy} value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} placeholder="Contoh: BCA" /></Field><Field label="No. Rekening" htmlFor="bank-number"><Input id="bank-number" inputMode="numeric" maxLength={50} required disabled={busy} value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} /></Field><Field label="Nama Rekening" htmlFor="bank-holder"><Input id="bank-holder" maxLength={150} required disabled={busy} value={form.accountName} onChange={e => setForm({ ...form, accountName: e.target.value })} /></Field><label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={form.isActive} disabled={busy} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> Rekening aktif</label><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Batal</Button><SubmitButton busy={busy}>Simpan Rekening</SubmitButton></DialogFooter></form></DialogContent></Dialog>
    <AlertDialog open={!!deactivating} onOpenChange={value => { if (!value && !busy) setDeactivating(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Nonaktifkan rekening {deactivating?.accountNumber}?</AlertDialogTitle><AlertDialogDescription>Rekening tidak lagi muncul pada pilihan invoice baru. Informasi rekening pada invoice lama tetap utuh.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void deactivate(); }}>Ya, nonaktifkan</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
