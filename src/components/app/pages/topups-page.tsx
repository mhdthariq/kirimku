"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileImage,
  Plus,
  Receipt,
  Upload,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPost, hasPermission, type PartnerRow, type TopUpRequest, type TopUpsResponse } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, Input, NumberInput, SubmitButton, formatRupiah, formatDate } from "@/components/app/form-parts";
import { ItemAuditDialog } from "@/components/app/item-audit-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Top Up (simplified §10/§33/§34) — company side:
 *  · Admin Kantor / Owner (wallet.topup.create): creates the top-up request
 *    for a Marketing partner WITH the transfer proof image attached at
 *    creation — no separate "upload proof" step, no PENDING_PAYMENT stage.
 *  · Owner Company (wallet.topup.verify): final verification → VERIFIED +
 *    atomic wallet credit; or rejection. Admin Kantor can cancel a request
 *    that is still pending verification.
 * Marketing has NO Top Up menu access — they only see the resulting history
 * inside their own wallet page.
 */
export function TopUpManagementPage() {
  const { user } = useAuth();
  const canView = hasPermission(user, "wallet.topup.view");
  const canVerify = hasPermission(user, "wallet.topup.verify");
  const canCreate = hasPermission(user, "wallet.topup.create");
  const canCancel = hasPermission(user, "wallet.topup.cancel");

  const { data, loading, reload } = useApiData<TopUpsResponse>(() => apiGet<TopUpsResponse>("/topups"), []);
  const { data: partners } = useApiData<PartnerRow[]>(() => (canCreate ? apiGet<PartnerRow[]>("/partners?type=MARKETING") : Promise.resolve([])), [canCreate]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<TopUpRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const rows = (data?.topUps ?? []).filter((r) => statusFilter === "all" || r.status === statusFilter);

  if (!canView) {
    return <PageHeader title="Top Up" subtitle="Anda tidak memiliki izin wallet.topup.view." icon={<Receipt className="h-5 w-5" />} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Top Up"
        subtitle="Admin Kantor membuat top up untuk partner Marketing beserta bukti transfer → Owner memverifikasi (saldo bertambah atomik saat VERIFIED)."
        icon={<Receipt className="h-5 w-5" />}
        actions={canCreate ? <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Tambah Top Up</Button> : undefined}
      />

      <div className="flex flex-wrap gap-2">
        {["all", "PENDING_VERIFICATION", "VERIFIED", "REJECTED", "CANCELLED"].map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            {f === "all" ? "Semua" : f.replace("_", " ")}
          </button>
        ))}
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        emptyMessage="Belum ada permintaan top up."
        columns={[
          {
            key: "partner",
            header: "Partner",
            primary: true,
            render: (r) => (
              <div>
                <p className="text-sm font-semibold">{r.partner?.user.name ?? `#${r.partnerId}`}</p>
                <p className="font-mono text-xs text-muted-foreground">{r.requestCode}</p>
              </div>
            ),
          },
          { key: "amount", header: "Jumlah", render: (r) => <span className="font-semibold">{formatRupiah(r.amount)}</span> },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            key: "info",
            header: "Keterangan",
            hideOnMobile: true,
            render: (r) => <span className="text-xs text-muted-foreground">{r.partnerNote ?? "—"}</span>,
          },
          { key: "date", header: "Tanggal", hideOnMobile: true, render: (r) => formatDate(r.createdAt, true) },
          {
            key: "actions",
            header: "Aksi",
            render: (r) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setDetail(r)}>
                  Detail
                </Button>
                <ItemAuditDialog entityType="topup" entityId={r.id} itemLabel={r.requestCode} />
                {canVerify && r.status === "PENDING_VERIFICATION" && (
                  <>
                    <Button size="sm" className="h-7" onClick={() => verifyTopUp(r.id)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Verifikasi
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={() => rejectTopUp(r.id)}>
                      <XCircle className="h-3.5 w-3.5" /> Tolak
                    </Button>
                  </>
                )}
                {canCancel && r.status === "PENDING_VERIFICATION" && (
                  <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => cancelTopUp(r.id)}>
                    <XCircle className="h-3.5 w-3.5" /> Batal
                  </Button>
                )}
                {r.status === "VERIFIED" && <span className="text-xs text-muted-foreground">✓ {formatDate(r.verifiedAt, true)}</span>}
                {r.status === "REJECTED" && <span className="text-xs text-destructive">{r.rejectReason}</span>}
              </div>
            ),
          },
        ]}
      />

      <CreateTopUpDialog partners={partners ?? []} open={createOpen} onOpenChange={setCreateOpen} onDone={reload} />
      <TopUpDetailDialog topUp={detail} onOpenChange={(open) => !open && setDetail(null)} />
    </div>
  );

  async function verifyTopUp(id: number) {
    const ok = await runAction(() => apiPost(`/topups/${id}/verify`), {
      success: "Top up VERIFIED — wallet dikredit atomik (ledger TOPUP dibuat).",
    });
    if (ok) reload();
  }

  async function rejectTopUp(id: number) {
    const ok = await runAction(() => apiPost(`/topups/${id}/reject`, { reason: "Bukti transfer tidak valid" }), {
      success: "Top up ditolak — wallet tidak berubah.",
    });
    if (ok) reload();
  }

  async function cancelTopUp(id: number) {
    const ok = await runAction(() => apiPost(`/topups/${id}/cancel`, { reason: "Dibatalkan oleh Admin Kantor" }), {
      success: "Top up dibatalkan — wallet tidak berubah.",
    });
    if (ok) reload();
  }
}

function CreateTopUpDialog({ partners, open, onOpenChange, onDone }: { partners: PartnerRow[]; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [partnerId, setPartnerId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<{ name: string; type: string; dataUrl: string } | null>(null);
  const [proofError, setProofError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!proof) {
      setProofError("Bukti transfer wajib diunggah.");
      return;
    }
    setBusy(true);
    const ok = await runAction(
      () =>
        apiPost("/topups", {
          partnerId: Number(partnerId),
          amount: Number(amount),
          note: note || null,
          proofUrl: proof.dataUrl,
        }),
      { success: "Top up dibuat dengan bukti transfer — status PENDING_VERIFICATION, menunggu verifikasi Owner." },
    );
    setBusy(false);
    if (ok) {
      setPartnerId("");
      setAmount("");
      setNote("");
      setProof(null);
      setProofError("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onOpenChange(false);
      onDone();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tambah Top Up</DialogTitle>
          <DialogDescription>
            Buat top up untuk partner Marketing beserta bukti transfernya. Owner tetap melakukan verifikasi akhir sebelum saldo bertambah.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Partner Marketing" htmlFor="topup-partner">
            <select id="topup-partner" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required disabled={busy}>
              <option value="">Pilih partner…</option>
              {partners.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name} (@{p.username})</option>)}
            </select>
          </Field>
          <Field label="Jumlah Top Up (Rupiah)" htmlFor="topup-amount">
            <NumberInput id="topup-amount" value={amount} onChange={(e) => setAmount(e.target.value)} min={10000} step={1000} required disabled={busy} />
          </Field>
          <Field label="Catatan (opsional)" htmlFor="topup-note">
            <Input id="topup-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. transfer via BCA mobile jam 08:35" disabled={busy} />
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Bukti Transfer <span className="text-destructive">*</span></p>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-3 text-sm hover:bg-primary/10">
              <Upload className="h-4 w-4 text-primary" />
              <span className="min-w-0 flex-1"><span className="block font-medium">{proof ? proof.name : "Pilih bukti transfer (nota / mutasi)"}</span><span className="block text-xs text-muted-foreground">JPG, PNG, WEBP, atau PDF · maksimal 8 MB</span></span>
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => onProofChange(e.target.files?.[0])} disabled={busy} />
            </label>
            {proofError && <p className="text-xs text-destructive">{proofError}</p>}
            {proof?.type.startsWith("image/") && <img src={proof.dataUrl} alt="Preview bukti transfer" className="max-h-40 w-full rounded-lg border object-contain" />}
            {proof?.type === "application/pdf" && <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">PDF siap diunggah dan dapat dibuka kembali dari tombol Detail.</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Batal</Button>
            <SubmitButton busy={busy} disabled={!proof}>Buat Top Up</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Full record detail — mirrors RepairDetailDialog (repairs-page): all fields + Bukti Pembayaran inline. */
function TopUpDetailDialog({ topUp, onOpenChange }: { topUp: TopUpRequest | null; onOpenChange: (open: boolean) => void }) {
  if (!topUp) return null;
  const isImage = !!topUp.proofUrl && (topUp.proofUrl.startsWith("data:image/") || topUp.proofUrl.startsWith("image/"));
  const fileName = `bukti-${topUp.requestCode}${isImage ? ".png" : ".pdf"}`;
  return (
    <Dialog open={!!topUp} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{topUp.requestCode} · {topUp.partner?.user.name ?? `#${topUp.partnerId}`}</DialogTitle>
          <DialogDescription>
            Top up saldo Marketing — {formatRupiah(topUp.amount)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <DetailItem label="Partner" value={topUp.partner?.user.name ?? `#${topUp.partnerId}`} />
            <DetailItem label="Jumlah" value={formatRupiah(topUp.amount)} />
            <DetailItem label="Diajukan" value={formatDate(topUp.createdAt, true)} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
              <div className="mt-0.5"><StatusBadge status={topUp.status} /></div>
            </div>
            {topUp.verifiedAt && <DetailItem label="Diverifikasi" value={formatDate(topUp.verifiedAt, true)} />}
            {topUp.verifiedBy?.name && <DetailItem label="Diverifikasi Oleh" value={topUp.verifiedBy.name} />}
          </div>
          {topUp.partnerNote && <DetailItem label="Catatan" value={topUp.partnerNote} />}
          {topUp.rejectReason && <DetailItem label="Alasan Penolakan" value={topUp.rejectReason} />}
          {topUp.proofUrl && (
            <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-primary"><FileImage className="h-3.5 w-3.5" /> Bukti Pembayaran</p>
              {isImage && <img src={topUp.proofUrl} alt={`Bukti ${topUp.requestCode}`} className="max-h-64 w-full rounded-md border bg-white object-contain" />}
              {!isImage && <p className="text-xs text-muted-foreground">Bukti berbentuk PDF — unduh atau buka di tab baru untuk melihat dokumen.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <a href={topUp.proofUrl} download={fileName} className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <Download className="h-3.5 w-3.5" /> Unduh bukti
                </a>
                <a href={topUp.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> Buka bukti dalam tab baru
                </a>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words text-sm">{value}</p>
    </div>
  );
}
