"use client";

import { useState } from "react";
import { Briefcase, CarFront, CheckCircle2, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPut, hasPermission, type PartnerRow } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActiveBadge } from "@/components/app/status-badge";
import { Field, NumberInput, SubmitButton, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Partner management (Revise.md §4/§34 "Partner Wallets"): view all partners
 * with wallets & earnings; Owner Company (partner.update) configures each
 * partner's INDIVIDUAL profit sharing — company% + partner% must equal 100
 * (validated client + server). Historical settlements are untouched (§37).
 */
export function PartnersPage() {
  const { user } = useAuth();
  const canView = hasPermission(user, "partner.view");
  const canUpdate = hasPermission(user, "partner.update");
  const { data, loading, reload } = useApiData<PartnerRow[]>(() => apiGet<PartnerRow[]>("/partners"), []);
  const [editFor, setEditFor] = useState<PartnerRow | null>(null);

  if (!canView) {
    return <PageHeader title="Partners" subtitle="Anda tidak memiliki izin partner.view." icon={<Users className="h-5 w-5" />} />;
  }

  const rows = data ?? [];
  const totalBalance = rows.reduce((s, p) => s + p.wallet.balance, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Partner Wallets"
        subtitle={`${rows.length} partner · ${rows.filter((p) => p.type === "MARKETING").length} Marketing · ${rows.filter((p) => p.type === "VEHICLE_OWNER").length} Vehicle Owner`}
        icon={<Users className="h-5 w-5" />}
        actions={
          <div className="rounded-xl border bg-primary/10 px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Total saldo partner</p>
            <p className="text-base font-bold text-primary">{formatRupiah(totalBalance)}</p>
          </div>
        }
      />

      <DataTable
        rows={rows}
        loading={loading}
        emptyMessage="Belum ada partner terdaftar."
        columns={[
          {
            key: "name",
            header: "Partner",
            primary: true,
            render: (r) => (
              <div className="flex items-center gap-2.5">
                <span className={cn("rounded-md p-1.5", r.type === "MARKETING" ? "bg-primary/10 text-primary" : "bg-chart-5/10 text-chart-5")}>
                  {r.type === "MARKETING" ? <Briefcase className="h-4 w-4" /> : <CarFront className="h-4 w-4" />}
                </span>
                <div>
                  <p className="text-sm font-semibold">{r.name}</p>
                  <p className="text-xs text-muted-foreground">@{r.username}{r.type === "VEHICLE_OWNER" ? ` · ${r.counts.vehicles} kendaraan` : ""}</p>
                </div>
              </div>
            ),
          },
          {
            key: "share",
            header: "Profit Share",
            render: (r) => (
              <div className="text-xs">
                <p className="font-semibold">{r.profitShare.partner}% partner</p>
                <p className="text-muted-foreground">{r.profitShare.company}% perusahaan</p>
              </div>
            ),
          },
          {
            key: "wallet",
            header: "Wallet",
            render: (r) => (
              <div>
                <p className="text-sm font-bold">{formatRupiah(r.wallet.balance)}</p>
                {r.wallet.reserved > 0 && <p className="text-xs text-chart-4">reserved {formatRupiah(r.wallet.reserved)}</p>}
              </div>
            ),
          },
          {
            key: "earnings",
            header: "Earnings",
            hideOnMobile: true,
            render: (r) => (
              <div className="text-xs">
                {r.type === "VEHICLE_OWNER" ? (
                  <p>transport <b className="text-primary">{formatRupiah(r.totals.transportEarnings)}</b></p>
                ) : (
                  <p>komisi <b className="text-primary">{formatRupiah(r.totals.commissions)}</b></p>
                )}
                <p className="text-muted-foreground">repair {formatRupiah(r.totals.repairDeductions)} · wdr {formatRupiah(r.totals.withdrawals)}</p>
              </div>
            ),
          },
          {
            key: "bank",
            header: "Rekening",
            hideOnMobile: true,
            render: (r) =>
              r.bank.bankAccountNumber ? (
                <div className="text-xs">
                  <p className="font-medium">{r.bank.bankAccountName}</p>
                  <p className="font-mono text-muted-foreground">{r.bank.bankAccountNumber} · {r.bank.bankName}</p>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              ),
          },
          { key: "active", header: "Status", render: (r) => <ActiveBadge active={r.isActive} /> },
          {
            key: "actions",
            header: "Aksi",
            render: (r) =>
              canUpdate ? (
                <Button size="sm" variant="outline" className="h-7" onClick={() => setEditFor(r)}>
                  Atur Profit Share
                </Button>
              ) : (
                "—"
              ),
          },
        ]}
      />

      <EditProfitShareDialog partner={editFor} onOpenChange={(open) => !open && setEditFor(null)} onDone={reload} />
    </div>
  );
}

function EditProfitShareDialog({
  partner,
  onOpenChange,
  onDone,
}: {
  partner: PartnerRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [company, setCompany] = useState(String(partner?.profitShare.company ?? 80));
  const [partnerPct, setPartnerPct] = useState(String(partner?.profitShare.partner ?? 20));
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);

  // re-sync the form whenever a different partner is opened
  if (partner && key !== partner.id) {
    setKey(partner.id);
    setCompany(String(partner.profitShare.company));
    setPartnerPct(String(partner.profitShare.partner));
  }

  const sum = Number(company) + Number(partnerPct);
  const valid = Math.abs(sum - 100) < 0.001 && Number(company) > 0 && Number(partnerPct) > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partner || !valid) return;
    setBusy(true);
    const ok = await runAction(() =>
      apiPut(`/partners/${partner.id}`, {
        companyPercent: Number(company),
        partnerPercent: Number(partnerPct),
      }),
      { success: "Konfigurasi profit share diperbarui — berlaku untuk settlement berikutnya (settlement lama tetap)." },
    );
    if (ok) {
      onOpenChange(false);
      onDone();
    }
    setBusy(false);
  }

  return (
    <Dialog open={!!partner} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Profit Share — {partner?.name}</DialogTitle>
          <DialogDescription>
            Konfigurasi individual per partner (§4). Company% + Partner% harus tepat 100%. Settlement historis TIDAK berubah (§37).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company (%)">
              <NumberInput value={company} onChange={(e) => setCompany(e.target.value)} min={1} max={99} required />
            </Field>
            <Field label="Partner (%)">
              <NumberInput value={partnerPct} onChange={(e) => setPartnerPct(e.target.value)} min={1} max={99} required />
            </Field>
          </div>
          <div className={cn("rounded-lg border p-3 text-xs", valid ? "border-primary/30 bg-primary/5 text-primary" : "border-destructive/40 bg-destructive/10 text-destructive")}>
            <span className="flex items-center gap-2">
              {valid ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
              Total: {sum}% {valid ? "✓ valid (100%)" : "— harus tepat 100%" }
            </span>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <SubmitButton busy={busy} >Simpan</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
