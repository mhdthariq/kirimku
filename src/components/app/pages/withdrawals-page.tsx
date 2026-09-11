"use client";

import { useState } from "react";
import { Banknote, CheckCircle2, Upload, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPost, hasPermission, type WithdrawalRequest } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { formatRupiah, formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";

/**
 * Withdrawal management (Revise.md §25/§26/§34) — company side:
 *  · Owner Company (approve/reject): PENDING → APPROVED / REJECTED.
 *  · Admin Kantor + Owner (process/proof): APPROVED → PROCESSING → COMPLETED
 *    (completion atomically debits the wallet + ledger entry).
 *  · FAILED releases the reservation without any wallet change.
 */
export function WithdrawalManagementPage() {
  const { user } = useAuth();
  const canView = hasPermission(user, "wallet.withdrawal.view");
  const canApprove = hasPermission(user, "wallet.withdrawal.approve");
  const canReject = hasPermission(user, "wallet.withdrawal.reject");
  const canProcess = hasPermission(user, "wallet.withdrawal.process");
  const canUpload = hasPermission(user, "wallet.withdrawal.proof.upload");

  const { data, loading, reload } = useApiData<WithdrawalRequest[]>(() => apiGet<WithdrawalRequest[]>("/withdrawals"), []);
  const [statusFilter, setStatusFilter] = useState("all");
  const rows = (data ?? []).filter((r) => statusFilter === "all" || r.status === statusFilter);

  if (!canView) {
    return <PageHeader title="Withdrawal Requests" subtitle="Anda tidak memiliki izin wallet.withdrawal.view." icon={<Banknote className="h-5 w-5" />} />;
  }

  async function act(path: string, body: Record<string, unknown>, success: string) {
    const ok = await runAction(() => apiPost(path, body), { success });
    if (ok) reload();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Withdrawal Requests"
        subtitle="Partner mengajukan → Owner menyetujui → perusahaan transfer bank (PROCESSING) → COMPLETED dengan bukti. Penyelesaian mendebit wallet secara atomik (§30)."
        icon={<Banknote className="h-5 w-5" />}
        actions={
          <div className="rounded-xl border bg-card px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total in-flight</p>
            <p className="text-base font-bold">{formatRupiah(rows.filter((r) => ["PENDING", "APPROVED", "PROCESSING"].includes(r.status)).reduce((s, r) => s + r.amount, 0))}</p>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {["all", "PENDING", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED", "FAILED", "CANCELLED"].map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            {f === "all" ? "Semua" : f}
          </button>
        ))}
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        emptyMessage="Belum ada permintaan withdrawal."
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
          {
            key: "bank",
            header: "Rekening Tujuan",
            hideOnMobile: true,
            render: (r) => (
              <div>
                <p className="text-xs font-medium">{r.bankAccountName}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{r.bankAccountNumber} · {r.bankName}</p>
              </div>
            ),
          },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "date", header: "Tanggal", hideOnMobile: true, render: (r) => formatDate(r.createdAt, true) },
          {
            key: "actions",
            header: "Aksi",
            render: (r) => (
              <div className="flex flex-wrap items-center gap-1.5">
                {canApprove && r.status === "PENDING" && (
                  <Button size="sm" className="h-7" onClick={() => act(`/withdrawals/${r.id}/approve`, {}, "Withdrawal disetujui — dana tetap di-reserve.")}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Setujui
                  </Button>
                )}
                {canReject && ["PENDING", "APPROVED"].includes(r.status) && (
                  <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={() => act(`/withdrawals/${r.id}/reject`, { reason: "Tidak dapat diproses saat ini" }, "Withdrawal ditolak — reserved dilepas.")}>
                    <XCircle className="h-3.5 w-3.5" /> Tolak
                  </Button>
                )}
                {canProcess && r.status === "APPROVED" && (
                  <Button size="sm" variant="secondary" className="h-7" onClick={() => act(`/withdrawals/${r.id}/process`, {}, "Withdrawal diproses — lakukan transfer bank lalu selesaikan dengan bukti.")}>
                    Proses Transfer
                  </Button>
                )}
                {canProcess && r.status === "PROCESSING" && (
                  <Button size="sm" className="h-7" onClick={() => act(`/withdrawals/${r.id}/complete`, { proofUrl: "attachment://bank-transfer-receipt" }, "Withdrawal COMPLETED — wallet didebit atomik + ledger WITHDRAWAL.")}>
                    <Upload className="h-3.5 w-3.5" /> Selesaikan + Bukti
                  </Button>
                )}
                {canProcess && ["PENDING", "APPROVED", "PROCESSING"].includes(r.status) && (
                  <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => act(`/withdrawals/${r.id}/fail`, { reason: "Transfer bank gagal" }, "Withdrawal ditandai gagal — reserved dilepas.")}>
                    Gagal
                  </Button>
                )}
                {r.status === "COMPLETED" && <span className="text-xs text-muted-foreground">✓ {formatDate(r.completedAt, true)}</span>}
                {["REJECTED", "FAILED"].includes(r.status) && r.rejectReason && (
                  <span className="text-xs text-destructive">{r.rejectReason}</span>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
