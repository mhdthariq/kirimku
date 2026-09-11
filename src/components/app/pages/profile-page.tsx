"use client";

import { useState } from "react";
import { Building2, Landmark, UserCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPut, hasPermission, type ProfileData } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader } from "@/components/app/data-table";
import { Field, SubmitButton } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

/**
 * Profile (Revise.md §31/§32 menu "Profile") — every user sees their own
 * identity; partners (Marketing / Vehicle Owner) maintain their REGISTERED
 * BANK ACCOUNT used for withdrawals (§24).
 */
export function ProfilePage() {
  const { user } = useAuth();
  const { data, loading, reload } = useApiData<ProfileData>(() => apiGet<ProfileData>("/profile"), []);
  const [bank, setBank] = useState({ bankName: "", bankAccountName: "", bankAccountNumber: "" });
  const [busy, setBusy] = useState(false);
  // React-approved "adjust state when data arrives" pattern: reset the form
  // once per loaded profile id (no effect needed).
  const [syncedId, setSyncedId] = useState<number | null>(null);
  if (data && data.id !== syncedId) {
    setSyncedId(data.id);
    setBank({
      bankName: data.partner?.bank.bankName ?? "",
      bankAccountName: data.partner?.bank.bankAccountName ?? "",
      bankAccountNumber: data.partner?.bank.bankAccountNumber ?? "",
    });
  }

  async function onSaveBank(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await runAction(() =>
      apiPut("/profile", {
        bankName: bank.bankName || null,
        bankAccountName: bank.bankAccountName || null,
        bankAccountNumber: bank.bankAccountNumber || null,
      }),
      { success: "Rekening withdrawal tersimpan." },
    );
    if (ok) reload();
    setBusy(false);
  }

  const isPartner = !!data?.partner;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Profil"
        subtitle="Identitas akun Anda dan rekening withdrawal (untuk partner)."
        icon={<UserCircle2 className="h-5 w-5" />}
      />

      {loading || !data ? (
        <div className="h-40 animate-pulse rounded-xl border bg-muted/40" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Identity */}
          <section className="rounded-xl border bg-card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <UserCircle2 className="h-4 w-4" /> Identitas
            </p>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Nama</dt>
                <dd className="font-semibold">{data.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Username</dt>
                <dd className="font-mono">{data.username}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Role</dt>
                <dd className="flex flex-wrap justify-end gap-1">
                  {data.isOwner && <Badge>Owner</Badge>}
                  {data.roles.map((r) => (
                    <Badge key={r.slug} variant="secondary">{r.name}</Badge>
                  ))}
                </dd>
              </div>
              {data.warehouse && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Gudang</dt>
                  <dd>{data.warehouse.name}{data.warehouse.city ? ` · ${data.warehouse.city}` : ""}</dd>
                </div>
              )}
            </dl>
            {isPartner && data.partner && (
              <div className="mt-4 rounded-lg border bg-primary/5 p-3 text-xs">
                <p className="font-semibold text-primary">
                  {data.partner.type === "MARKETING" ? "Marketing Partner" : "Vehicle Owner Partner"}
                </p>
                <p className="text-muted-foreground">
                  Profit share Anda: <b>{data.partner.profitShare.partner}%</b> · Perusahaan: {data.partner.profitShare.company}%
                </p>
                <p className="mt-1 text-muted-foreground">
                  {hasPermission(user, "wallet.view_own") && (
                    <>Kelola saldo di <a className="text-primary underline" href="#/wallet">Wallet</a>.</>
                  )}
                </p>
              </div>
            )}
          </section>

          {/* Bank account (partners only) */}
          <section className="rounded-xl border bg-card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Landmark className="h-4 w-4" /> Rekening Withdrawal
            </p>
            {isPartner ? (
              <form onSubmit={onSaveBank} className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Rekening terdaftar dipakai untuk mencairkan saldo wallet (§24). Rekening di-snapshot pada setiap permintaan withdrawal.
                </p>
                <Field label="Nama Bank">
                  <Input value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} placeholder="Bank Mandiri" />
                </Field>
                <Field label="Nama Pemilik Rekening">
                  <Input value={bank.bankAccountName} onChange={(e) => setBank({ ...bank, bankAccountName: e.target.value })} placeholder="Nama sesuai buku tabungan" />
                </Field>
                <Field label="Nomor Rekening">
                  <Input value={bank.bankAccountNumber} onChange={(e) => setBank({ ...bank, bankAccountNumber: e.target.value })} placeholder="1234567890" />
                </Field>
                <SubmitButton busy={busy} className="w-full sm:w-auto">
                  <Building2 className="mr-1.5 h-4 w-4" /> Simpan Rekening
                </SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Rekening withdrawal hanya relevan untuk akun partner (Marketing / Vehicle Owner).
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
