"use client";

import { useState } from "react";
import { CheckCircle2, FileImage, Plus, Receipt, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPost, hasPermission, type PartnerRow, type TopUpRequest, type TopUpsResponse } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, Input, NumberInput, SubmitButton, formatRupiah, formatDate } from "@/components/app/form-parts";
import { ItemAuditDialog } from "@/components/app/item-audit-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Top Up management (Revise.md §10/§33/§34) — company side:
 *  · Admin Kantor (wallet.topup.create): creates the request with transfer
 *    proof and submits it for verification.
 *  · Owner Company (wallet.topup.verify): final verification → VERIFIED +
 *    atomic wallet credit; or rejection.
 * Marketing can never verify their own top-up (server-enforced §10.1).
 */
export function TopUpManagementPage() {
  const { user } = useAuth();
  const canView = hasPermission(user, "wallet.topup.view");
  const canVerify = hasPermission(user, "wallet.topup.verify");
  const canCreate = hasPermission(user, "wallet.topup.create");

  const { data, loading, reload } = useApiData<TopUpsResponse>(() => apiGet<TopUpsResponse>("/topups"), []);
  const { data: partners } = useApiData<PartnerRow[]>(() => (canCreate ? apiGet<PartnerRow[]>("/partners?type=MARKETING") : Promise.resolve([])), [canCreate]);
  const [proofFor, setProofFor] = useState<TopUpRequest | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const rows = (data?.topUps ?? []).filter((r) => statusFilter === "all" || r.status === statusFilter);

  if (!canView) {
    return <PageHeader title="Top Up Requests" subtitle="Anda tidak memiliki izin wallet.topup.view." icon={<Receipt className="h-5 w-5" />} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Top Up Requests"
        subtitle="Marketing meminta top up dengan bukti transfer → Owner memeriksa dan memverifikasi (saldo bertambah atomik saat VERIFIED)."
        icon={<Receipt className="h-5 w-5" />}
        actions={canCreate ? <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Buat Top Up</Button> : undefined}
      />

      <div className="flex flex-wrap gap-2">
        {["all", "PENDING_PAYMENT", "PENDING_VERIFICATION", "VERIFIED", "REJECTED", "CANCELLED"].map((f) => (
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
            header: "Keterangan Partner",
            hideOnMobile: true,
            render: (r) => <span className="text-xs text-muted-foreground">{r.partnerNote ?? "—"}</span>,
          },
          {
            key: "proof",
            header: "Bukti",
            hideOnMobile: true,
            render: (r) => (r.proofUrl ? <span className="text-xs text-primary">✓ terunggah</span> : <span className="text-xs text-muted-foreground">—</span>),
          },
          { key: "date", header: "Tanggal", hideOnMobile: true, render: (r) => formatDate(r.createdAt, true) },
          {
            key: "actions",
            header: "Aksi",
            render: (r) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <ItemAuditDialog entityType="topup" entityId={r.id} itemLabel={r.requestCode} />
                {r.proofUrl && <Button size="sm" variant="outline" className="h-7" onClick={() => setProofFor(r)}><FileImage className="h-3.5 w-3.5" /> Bukti</Button>}
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
                {r.status === "VERIFIED" && <span className="text-xs text-muted-foreground">✓ {formatDate(r.verifiedAt, true)}</span>}
                {r.status === "REJECTED" && <span className="text-xs text-destructive">{r.rejectReason}</span>}
              </div>
            ),
          },
        ]}
      />

      <CreateTopUpDialog partners={partners ?? []} open={createOpen} onOpenChange={setCreateOpen} onDone={reload} />
      <ProofDialog topUp={proofFor} onOpenChange={(open) => !open && setProofFor(null)} />
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
}

function CreateTopUpDialog({ partners, open, onOpenChange, onDone }: { partners: PartnerRow[]; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [partnerId, setPartnerId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<{ type: string; dataUrl: string } | null>(null);
  const [proofError, setProofError] = useState("");
  const [busy, setBusy] = useState(false);

  function onProofChange(file: File | undefined) {
    setProofError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProofError("Pilih file gambar.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setProofError("Ukuran file maksimal 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setProof({ type: file.type, dataUrl: String(reader.result) });
    reader.onerror = () => setProofError("File tidak bisa dibaca. Coba pilih file lain.");
    reader.readAsDataURL(file);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await runAction(() => apiPost("/topups", { partnerId: Number(partnerId), amount: Number(amount), note: note || null, proofUrl: proof?.dataUrl }), { success: "Top up dibuat dan dikirim untuk verifikasi Owner." });
    setBusy(false);
    if (ok) {
      setPartnerId("");
      setAmount("");
      setNote("");
      setProof(null);
      setProofError("");
      onOpenChange(false);
      onDone();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Buat Top Up</DialogTitle>
          <DialogDescription>Unggah bukti transfer saat membuat permintaan. Owner akan memeriksa bukti dan melakukan verifikasi akhir.</DialogDescription>
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
            <Input id="topup-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </Field>
          <Field label="Bukti Transfer" hint="Format gambar, maksimal 8 MB." error={proofError}>
            <Input type="file" accept="image/*" onChange={(e) => onProofChange(e.target.files?.[0])} required disabled={busy} />
            {proof?.type.startsWith("image/") && <img src={proof.dataUrl} alt="Preview bukti transfer" className="max-h-40 w-full rounded-lg border object-contain" />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Batal</Button>
            <SubmitButton busy={busy}>Buat Top Up</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProofDialog({ topUp, onOpenChange }: { topUp: TopUpRequest | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!topUp} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bukti Transfer</DialogTitle>
          <DialogDescription>{topUp?.requestCode} · {topUp ? formatRupiah(topUp.amount) : ""}</DialogDescription>
        </DialogHeader>
        {topUp?.proofUrl && <img src={topUp.proofUrl} alt={`Bukti ${topUp.requestCode}`} className="max-h-[60vh] w-full rounded-lg border bg-white object-contain" />}
      </DialogContent>
    </Dialog>
  );
}
