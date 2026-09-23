"use client";

import { useState } from "react";
import { Building2, KeyRound, Landmark, UserCircle2 } from "lucide-react";
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
 * BANK ACCOUNT used for withdrawals (§24). EVERY user — including the
 * Owner — can update their own name and password here.
 */
export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { data, loading, reload } = useApiData<ProfileData>(() => apiGet<ProfileData>("/profile"), []);
  const [bank, setBank] = useState({ bankName: "", bankAccountName: "", bankAccountNumber: "" });
  const [name, setName] = useState("");
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [busyBank, setBusyBank] = useState(false);
  const [busyName, setBusyName] = useState(false);
  const [busyPwd, setBusyPwd] = useState(false);
  // React-approved "adjust state when data arrives" pattern: reset the forms
  // once per loaded profile id (no effect needed).
  const [syncedId, setSyncedId] = useState<number | null>(null);
  if (data && data.id !== syncedId) {
    setSyncedId(data.id);
    setBank({
      bankName: data.partner?.bank.bankName ?? "",
      bankAccountName: data.partner?.bank.bankAccountName ?? "",
      bankAccountNumber: data.partner?.bank.bankAccountNumber ?? "",
    });
    setName(data.name);
  }

  async function onSaveBank(e: React.FormEvent) {
    e.preventDefault();
    setBusyBank(true);
    const ok = await runAction(() =>
      apiPut("/profile", {
        bankName: bank.bankName || null,
        bankAccountName: bank.bankAccountName || null,
        bankAccountNumber: bank.bankAccountNumber || null,
      }),
      { success: "Rekening withdrawal tersimpan." },
    );
    if (ok) reload();
    setBusyBank(false);
  }

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setBusyName(true);
    const ok = await runAction(() => apiPut("/profile", { name: name.trim() }), {
      success: "Nama berhasil diperbarui.",
    });
    if (ok) {
      reload();
      refreshUser?.();
    }
    setBusyName(false);
  }

  async function onSavePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwd.next !== pwd.confirm) {
      return;
    }
    if (pwd.next.length < 8) {
      return;
    }
    setBusyPwd(true);
    const ok = await runAction(
      () =>
        apiPut("/profile", {
          currentPassword: pwd.current || null,
          newPassword: pwd.next || null,
        }),
      { success: "Password berhasil diubah. Silakan login ulang dengan password baru." },
    );
    if (ok) {
      setPwd({ current: "", next: "", confirm: "" });
    }
    setBusyPwd(false);
  }

  const isPartner = !!data?.partner;
  const passwordMismatch = pwd.confirm.length > 0 && pwd.next !== pwd.confirm;
  const passwordTooShort = pwd.next.length > 0 && pwd.next.length < 8;

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
          {/* Identity (read-only summary) */}
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

          {/* Edit name + password - every user, including Owner */}
          <section className="rounded-xl border bg-card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4" /> Identitas & Keamanan
            </p>
            <p className="mb-3 text-xs text-muted-foreground">
              Ubah nama tampilan dan password Anda di sini. Saat mengganti password, masukkan password saat ini untuk verifikasi.
            </p>
            <form onSubmit={onSaveName} className="space-y-3">
              <Field label="Nama Tampilan" htmlFor="pf-name">
                <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busyName} />
              </Field>
              <SubmitButton busy={busyName} className="w-full sm:w-auto">
                Simpan Nama
              </SubmitButton>
            </form>

            <div className="my-4 border-t" />

            <form onSubmit={onSavePassword} className="space-y-3">
              <Field label="Password Saat Ini" htmlFor="pf-cur">
                <Input id="pf-cur" type="password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} required disabled={busyPwd} autoComplete="current-password" />
              </Field>
              <Field label="Password Baru" htmlFor="pf-next" hint={passwordTooShort ? "Minimal 8 karakter." : undefined}>
                <Input id="pf-next" type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} required disabled={busyPwd} autoComplete="new-password" />
              </Field>
              <Field label="Konfirmasi Password Baru" htmlFor="pf-conf" hint={passwordMismatch ? "Konfirmasi tidak cocok." : undefined}>
                <Input id="pf-conf" type="password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} required disabled={busyPwd} autoComplete="new-password" />
              </Field>
              <SubmitButton busy={busyPwd} disabled={passwordMismatch || passwordTooShort} className="w-full sm:w-auto">
                <KeyRound className="mr-1.5 h-4 w-4" /> Ubah Password
              </SubmitButton>
            </form>
          </section>

          {/* Bank account (partners only) */}
          <section className="rounded-xl border bg-card p-5 lg:col-span-2">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Landmark className="h-4 w-4" /> Rekening Withdrawal
            </p>
            {isPartner ? (
              <form onSubmit={onSaveBank} className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Rekening terdaftar dipakai untuk mencairkan saldo wallet (§24). Rekening di-snapshot pada setiap permintaan withdrawal.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Nama Bank">
                    <Input value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} placeholder="Bank Mandiri" />
                  </Field>
                  <Field label="Nama Pemilik Rekening">
                    <Input value={bank.bankAccountName} onChange={(e) => setBank({ ...bank, bankAccountName: e.target.value })} placeholder="Nama sesuai buku tabungan" />
                  </Field>
                  <Field label="Nomor Rekening">
                    <Input value={bank.bankAccountNumber} onChange={(e) => setBank({ ...bank, bankAccountNumber: e.target.value })} placeholder="1234567890" />
                  </Field>
                </div>
                <SubmitButton busy={busyBank} className="w-full sm:w-auto">
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
