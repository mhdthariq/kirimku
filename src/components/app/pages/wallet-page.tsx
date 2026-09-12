"use client";

import { useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CheckCircle2,
  Loader2,
  Plus,
  Receipt,
  ShieldQuestion,
  Wallet as WalletIcon,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  apiGet,
  apiPost,
  hasPermission,
  type CommissionRow,
  type TopUpRequest,
  type TopUpsResponse,
  type WalletSummaryData,
  type WalletTransaction,
  type WithdrawalRequest,
} from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, NumberInput, SubmitButton, formatRupiah, formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const MIN_TOP_UP_AMOUNT = 10_000;

/**
 * Partner Wallet (Revise.md §31 Marketing / §32 Vehicle Owner):
 * Balance · Top Up (Marketing only) · Transactions · Commissions (Marketing) ·
 * Withdrawals. A partner only ever sees their OWN financial data (§39).
 */
export function WalletPage() {
  const { user } = useAuth();
  const isMarketing = user?.partnerType === "MARKETING";
  const isVehicleOwner = user?.partnerType === "VEHICLE_OWNER";

  const { data: wallet, loading, reload } = useApiData<WalletSummaryData>(() => apiGet<WalletSummaryData>("/wallet"), []);
  const { data: transactions, reload: reloadTx } = useApiData<WalletTransaction[]>(
    () => apiGet<WalletTransaction[]>("/wallet/transactions"),
    [],
  );
  const { data: topUpsData, reload: reloadTopUps } = useApiData<TopUpsResponse>(() => apiGet<TopUpsResponse>("/topups"), []);
  const { data: withdrawals, reload: reloadWd } = useApiData<WithdrawalRequest[]>(() => apiGet<WithdrawalRequest[]>("/withdrawals"), []);
  const { data: commissions, reload: reloadComm } = useApiData<CommissionRow[]>(() => apiGet<CommissionRow[]>("/commissions"), []);

  const [topUpOpen, setTopUpOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [submitProofFor, setSubmitProofFor] = useState<TopUpRequest | null>(null);

  if (!isMarketing && !isVehicleOwner) {
    return (
      <PageHeader
        title="Wallet"
        subtitle="Halaman ini khusus untuk partner (Marketing / Vehicle Owner)."
        icon={<WalletIcon className="h-5 w-5" />}
      />
    );
  }

  function reloadAll() {
    reload();
    reloadTx();
    reloadTopUps();
    reloadWd();
    reloadComm();
  }

  const txIn = (transactions ?? []).filter((t) => t.direction === "CREDIT");
  const txOut = (transactions ?? []).filter((t) => t.direction === "DEBIT");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Wallet Partner"
        subtitle={
          isMarketing
            ? "Saldo, top up, transaksi, komisi B2B, dan withdrawal — data milik Anda sendiri."
            : "Saldo, transaksi, dan withdrawal — data milik Anda sendiri."
        }
        icon={<WalletIcon className="h-5 w-5" />}
        actions={
          <>
            {isMarketing && hasPermission(user, "wallet.topup.create") && (
              <Button onClick={() => setTopUpOpen(true)}>
                <Plus className="h-4 w-4" /> Top Up
              </Button>
            )}
            {hasPermission(user, "wallet.withdrawal.create") && (
              <Button variant="outline" onClick={() => setWithdrawOpen(true)}>
                <Banknote className="h-4 w-4" /> Withdraw
              </Button>
            )}
          </>
        }
      />

      {/* Balance cards (§17/§24/§27) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Saldo Wallet"
          value={loading ? "…" : formatRupiah(wallet?.balance ?? 0)}
          icon={<WalletIcon className="h-4 w-4" />}
          accent="text-foreground"
        />
        <StatCard
          label="Reserved (withdrawal aktif)"
          value={loading ? "…" : formatRupiah(wallet?.reserved ?? 0)}
          icon={<ShieldQuestion className="h-4 w-4" />}
          accent="text-chart-4"
          hint="Ditahan untuk permintaan withdrawal yang sedang diproses"
        />
        <StatCard
          label="Saldo Tersedia"
          value={loading ? "…" : formatRupiah(wallet?.available ?? 0)}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="text-primary"
          hint="Saldo − reserved (§27)"
        />
      </div>

      <Tabs defaultValue="balance">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="balance">Ringkasan</TabsTrigger>
          {isMarketing && <TabsTrigger value="topup">Top Up</TabsTrigger>}
          <TabsTrigger value="transactions">Transaksi</TabsTrigger>
          {isMarketing && <TabsTrigger value="commissions">Komisi B2B</TabsTrigger>}
          <TabsTrigger value="withdrawals">Withdrawal</TabsTrigger>
        </TabsList>

        <TabsContent value="balance" className="mt-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border bg-card p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profit Sharing Anda</p>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-2xl font-bold text-foreground">{wallet?.profitShare.partner ?? 0}%</p>
                  <p className="text-xs text-muted-foreground">Bagian Anda</p>
                </div>
                <div className="flex-1 border-l pl-4">
                  <p className="text-2xl font-bold text-muted-foreground">{wallet?.profitShare.company ?? 0}%</p>
                  <p className="text-xs text-muted-foreground">Bagian Perusahaan</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Persentase berlaku untuk settlement berikutnya; settlement lama memakai persentase saat ia dibuat (§37).
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rekening Terdaftar (Withdrawal)</p>
              {wallet?.bank?.bankAccountNumber ? (
                <>
                  <p className="text-sm font-semibold">{wallet.bank.bankAccountName}</p>
                  <p className="font-mono text-sm">{wallet.bank.bankAccountNumber}</p>
                  <p className="text-xs text-muted-foreground">{wallet.bank.bankName}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Belum ada rekening — lengkapi di halaman <a className="text-primary underline" href="#/profile">Profil</a> sebelum withdrawal.
                </p>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Total Masuk (kredit)" value={formatRupiah(txIn.reduce((s, t) => s + t.amount, 0))} icon={<ArrowDownCircle className="h-4 w-4" />} accent="text-primary" />
            <StatCard label="Total Keluar (debit)" value={formatRupiah(txOut.reduce((s, t) => s + t.amount, 0))} icon={<ArrowUpCircle className="h-4 w-4" />} accent="text-destructive" />
          </div>
        </TabsContent>

        {isMarketing && (
          <TabsContent value="topup" className="mt-3">
            {topUpsData && (
              <div className="mb-3 rounded-xl border bg-primary/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Transfer ke rekening perusahaan</p>
                <p className="mt-1 text-sm font-semibold">{topUpsData.bankInfo.accountName}</p>
                <p className="font-mono text-sm">{topUpsData.bankInfo.accountNumber}</p>
                <p className="text-xs text-muted-foreground">{topUpsData.bankInfo.bankName}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Setelah transfer, submit keterangan bukti di sini. Admin Kantor mengunggah bukti resmi, lalu Owner memverifikasi — saldo bertambah hanya saat VERIFIED (§10/§11).
                </p>
              </div>
            )}
            <DataTable
              rows={topUpsData?.topUps ?? []}
              loading={!topUpsData}
              emptyMessage="Belum ada permintaan top up."
              columns={[
                {
                  key: "code",
                  header: "Kode",
                  primary: true,
                  render: (r) => <span className="font-mono text-xs font-semibold">{r.requestCode}</span>,
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
                  render: (r) =>
                    r.status === "PENDING_PAYMENT" ? (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => setSubmitProofFor(r)}>
                        <Receipt className="h-3.5 w-3.5" /> Submit Bukti
                      </Button>
                    ) : r.verifiedAt ? (
                      <span className="text-xs text-muted-foreground">✓ {formatDate(r.verifiedAt, true)}</span>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </TabsContent>
        )}

        <TabsContent value="transactions" className="mt-3">
          <DataTable
            rows={transactions ?? []}
            loading={!transactions}
            emptyMessage="Belum ada transaksi wallet."
            columns={[
              {
                key: "type",
                header: "Tipe",
                primary: true,
                render: (r) => (
                  <div className="flex items-center gap-2">
                    <span className={cn("rounded-md p-1", r.direction === "CREDIT" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>
                      {r.direction === "CREDIT" ? <ArrowDownCircle className="h-3.5 w-3.5" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}
                    </span>
                    <span className="text-xs font-semibold">{TX_LABELS[r.type] ?? r.type}</span>
                  </div>
                ),
              },
              {
                key: "amount",
                header: "Jumlah",
                render: (r) => (
                  <span className={cn("font-semibold", r.direction === "CREDIT" ? "text-primary" : "text-destructive")}>
                    {r.direction === "CREDIT" ? "+" : "−"} {formatRupiah(r.amount)}
                  </span>
                ),
              },
              { key: "balance", header: "Saldo", render: (r) => <span className="text-sm">{formatRupiah(r.balanceAfter)}</span> },
                {
                  key: "desc",
                  header: "Keterangan",
                  hideOnMobile: true,
                  render: (r) => <span className="text-xs text-muted-foreground">{r.description ?? r.businessRef}</span>,
                },
              { key: "date", header: "Waktu", hideOnMobile: true, render: (r) => formatDate(r.createdAt, true) },
            ]}
          />
        </TabsContent>

        {isMarketing && (
          <TabsContent value="commissions" className="mt-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Komisi B2B hanya dirilis ke wallet setelah invoice terkait <b>LUNAS penuh</b> (§8/§9) — pembayaran parsial tetap PENDING.
            </p>
            <DataTable
              rows={commissions ?? []}
              loading={!commissions}
              emptyMessage="Belum ada komisi B2B."
              columns={[
                {
                  key: "invoice",
                  header: "Invoice",
                  primary: true,
                  render: (r) => (
                    <div>
                      <p className="font-mono text-xs font-semibold">{r.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">{r.customerName}</p>
                    </div>
                  ),
                },
                { key: "amount", header: "Nilai Invoice", hideOnMobile: true, render: (r) => formatRupiah(r.invoiceAmount) },
                {
                  key: "paid",
                  header: "Terbayar",
                  hideOnMobile: true,
                  render: (r) => (
                    <div>
                      <p className="text-sm">{formatRupiah(r.paidAmount)}</p>
                      {r.remainingAmount > 0 && <p className="text-xs text-destructive">sisa {formatRupiah(r.remainingAmount)}</p>}
                    </div>
                  ),
                },
                {
                  key: "commission",
                  header: `Komisi (${commissions?.[0]?.partnerPercent ?? 20}%)`,
                  render: (r) => <span className="font-semibold text-primary">{formatRupiah(r.commissionAmount)}</span>,
                },
                { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          </TabsContent>
        )}

        <TabsContent value="withdrawals" className="mt-3">
          <DataTable
            rows={withdrawals ?? []}
            loading={!withdrawals}
            emptyMessage="Belum ada permintaan withdrawal."
            columns={[
              {
                key: "code",
                header: "Kode",
                primary: true,
                render: (r) => <span className="font-mono text-xs font-semibold">{r.requestCode}</span>,
              },
              { key: "amount", header: "Jumlah", render: (r) => <span className="font-semibold">{formatRupiah(r.amount)}</span> },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
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
              { key: "date", header: "Tanggal", hideOnMobile: true, render: (r) => formatDate(r.createdAt, true) },
              {
                key: "actions",
                header: "Aksi",
                render: (r) =>
                  ["PENDING", "APPROVED"].includes(r.status) ? (
                    <CancelButton requestId={r.id} onDone={reloadAll} />
                  ) : r.completedAt ? (
                    <span className="text-xs text-muted-foreground">✓ {formatDate(r.completedAt, true)}</span>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {isMarketing && (
        <TopUpDialog
          open={topUpOpen}
          onOpenChange={setTopUpOpen}
          bankInfo={topUpsData?.bankInfo}
          onDone={reloadAll}
        />
      )}
      <WithdrawDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        available={wallet?.available ?? 0}
        hasBank={!!wallet?.bank?.bankAccountNumber}
        onDone={reloadAll}
      />
      <SubmitProofDialog
        topUp={submitProofFor}
        onOpenChange={(open) => !open && setSubmitProofFor(null)}
        onDone={reloadAll}
      />
    </div>
  );
}

export const TX_LABELS: Record<string, string> = {
  TOPUP: "Top Up",
  COMMISSION: "Komisi B2B",
  TRANSPORT_PROFIT_SHARE: "Profit Share Transport",
  REPAIR_DEDUCTION: "Deduction Repair",
  WITHDRAWAL: "Withdrawal",
  ADJUSTMENT: "Penyesuaian",
};

function StatCard({ label, value, icon, accent, hint }: { label: string; value: string; icon: React.ReactNode; accent?: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className={cn("mt-1 text-xl font-bold", accent)}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CancelButton({ requestId, onDone }: { requestId: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-destructive"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const ok = await runAction(() => apiPost(`/withdrawals/${requestId}/cancel`), { success: "Permintaan withdrawal dibatalkan — reserved dilepas." });
        if (ok) onDone();
        setBusy(false);
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Batal
    </Button>
  );
}

function TopUpDialog({
  open,
  onOpenChange,
  bankInfo,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankInfo?: { bankName: string; accountNumber: string; accountName: string };
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [amountError, setAmountError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt < MIN_TOP_UP_AMOUNT) {
      setAmountError(`Minimal top up adalah Rp${MIN_TOP_UP_AMOUNT.toLocaleString("id-ID")}.`);
      return;
    }
    setAmountError("");
    setBusy(true);
    const ok = await runAction(() => apiPost("/topups", { amount: amt, note: note || null }), {
      success: "Permintaan top up dibuat — transfer ke rekening perusahaan lalu submit bukti.",
    });
    if (ok) {
      setAmount("");
      setNote("");
      setAmountError("");
      onOpenChange(false);
      onDone();
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 px-7 pt-7 pb-5">
          <DialogTitle>Top Up Wallet</DialogTitle>
          <DialogDescription>
            Buat permintaan top up (PENDING_PAYMENT), transfer ke rekening perusahaan, lalu submit bukti transfer.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7">
          {bankInfo && (
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rekening Perusahaan</p>
              <p className="mt-1 font-semibold">{bankInfo.accountName}</p>
              <p className="font-mono">{bankInfo.accountNumber} · {bankInfo.bankName}</p>
            </div>
          )}
          <form id="top-up-form" onSubmit={onSubmit} className="pt-6 space-y-5">
            <Field label="Jumlah Top Up (Rupiah)" error={amountError}>
              <NumberInput
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (amountError) setAmountError("");
                }}
                placeholder="200000"
                min={MIN_TOP_UP_AMOUNT}
                step={1000}
                required
              />
            </Field>
            <Field label="Catatan (opsional)">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. transfer via BCA mobile jam 08:30" rows={3} />
            </Field>
          </form>
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 px-7 pt-5 pb-7 sm:mx-0 sm:mb-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <SubmitButton busy={busy} form="top-up-form">Buat Permintaan</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubmitProofDialog({
  topUp,
  onOpenChange,
  onDone,
}: {
  topUp: TopUpRequest | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!topUp) return;
    setBusy(true);
    const ok = await runAction(() => apiPost(`/topups/${topUp.id}/submit-proof`, { note }), {
      success: "Keterangan transfer dikirim — Admin Kantor akan mengunggah bukti resmi.",
    });
    if (ok) {
      setNote("");
      onOpenChange(false);
      onDone();
    }
    setBusy(false);
  }

  return (
    <Dialog open={!!topUp} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Submit Keterangan Transfer</DialogTitle>
          <DialogDescription>
            Top up {topUp?.requestCode} · {topUp ? formatRupiah(topUp.amount) : ""} — sampaikan keterangan transfer Anda untuk Admin Kantor.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Keterangan Transfer" hint="mis. jam transfer, nama pengirim, bank asal">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} required />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <SubmitButton busy={busy}>Kirim</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({
  open,
  onOpenChange,
  available,
  hasBank,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: number;
  hasBank: boolean;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    setBusy(true);
    const ok = await runAction(() => apiPost("/withdrawals", { amount: amt, note: note || null }), {
      success: "Permintaan withdrawal dibuat — jumlah langsung di-reserve sampai selesai/ditolak.",
    });
    if (ok) {
      setAmount("");
      setNote("");
      onOpenChange(false);
      onDone();
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw Wallet</DialogTitle>
          <DialogDescription>
            Saldo tersedia: <b>{formatRupiah(available)}</b>. Jumlah yang diminta di-reserve hingga withdrawal selesai atau ditolak (§27).
          </DialogDescription>
        </DialogHeader>
        {!hasBank && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            Lengkapi rekening bank terdaftar di halaman <a className="underline" href="#/profile">Profil</a> dulu sebelum withdrawal.
          </p>
        )}
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Jumlah Withdraw (Rupiah)">
            <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000" min={1} max={available} required />
          </Field>
          <Field label="Catatan (opsional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <SubmitButton busy={busy} disabled={!hasBank}>Ajukan Withdrawal</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
