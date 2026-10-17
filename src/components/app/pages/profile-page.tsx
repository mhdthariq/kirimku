"use client";

import { useState } from "react";
import {
    ArrowUpRight,
    Building2,
    KeyRound,
    Landmark,
    Save,
    ShieldCheck,
    UserCircle2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
    apiGet,
    apiPut,
    hasPermission,
    type ProfileData,
} from "@/infrastructure/http/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader } from "@/components/app/data-table";
import { Field, SubmitButton } from "@/components/app/form-parts";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CapacitySettingsCard } from "@/components/app/capacity-settings-card";

/**
 * Profile (Revise.md §31/§32 menu "Profile") — every user sees their own
 * identity; partners (Marketing / Vehicle Owner) maintain their REGISTERED
 * BANK ACCOUNT used for withdrawals (§24). EVERY user — including the
 * Owner — can update their own name and password here.
 */
export function ProfilePage() {
    const { user, refreshUser } = useAuth();
    const { data, loading, reload } = useApiData<ProfileData>(
        () => apiGet<ProfileData>("/profile"),
        [],
    );
    const [bank, setBank] = useState({
        bankName: "",
        bankAccountName: "",
        bankAccountNumber: "",
    });
    const [name, setName] = useState("");
    const [username, setUsername] = useState("");
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
        setUsername(data.username);
    }

    async function onSaveBank(e: React.FormEvent) {
        e.preventDefault();
        setBusyBank(true);
        const ok = await runAction(
            () =>
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
        const ok = await runAction(
            () =>
                apiPut("/profile", {
                    name: name.trim(),
                    ...(user?.isOwner ? { username: username.trim() } : {}),
                }),
            {
                success: "Profil berhasil diperbarui.",
            },
        );
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
            {
                success:
                    "Password berhasil diubah. Silakan login ulang dengan password baru.",
            },
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
        <div className="mx-auto w-full max-w-6xl space-y-6 pb-4">
            <PageHeader
                title="Profil"
                subtitle="Kelola informasi pribadi, keamanan, dan preferensi akun Anda."
                icon={<UserCircle2 className="h-5 w-5" />}
            />

            {loading || !data ? (
                <div
                    role="status"
                    className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                >
                    <span className="sr-only">Memuat profil…</span>
                    <div className="h-80 animate-pulse rounded-2xl border bg-muted/40" />
                    <div className="h-96 animate-pulse rounded-2xl border bg-muted/40" />
                </div>
            ) : (
                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    {/* Identity (read-only summary) */}
                    <section
                        aria-labelledby="profile-summary-title"
                        className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm"
                    >
                        <div className="h-24 bg-gradient-to-br from-primary/25 via-primary/10 to-card sm:h-28" />
                        <div className="px-5 pb-6 sm:px-6">
                            <div
                                aria-hidden="true"
                                className="-mt-10 mb-4 flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-card bg-primary text-2xl font-semibold text-primary-foreground shadow-sm"
                            >
                                {data.name
                                    .trim()
                                    .split(/\s+/)
                                    .slice(0, 2)
                                    .map((part) => part[0])
                                    .join("")
                                    .toUpperCase() || (
                                    <UserCircle2 className="h-9 w-9" />
                                )}
                            </div>
                            <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                                Akun saya
                            </p>
                            <h2
                                id="profile-summary-title"
                                className="break-words text-xl font-semibold tracking-tight"
                            >
                                {data.name}
                            </h2>
                            <p className="mt-1 break-all text-sm text-muted-foreground">
                                @{data.username}
                            </p>
                            <dl className="mt-6 space-y-5 border-t pt-5 text-sm">
                                <div className="space-y-2">
                                    <dt className="text-xs font-medium text-muted-foreground">
                                        Peran & akses
                                    </dt>
                                    <dd className="flex flex-wrap gap-1.5 [&>*]:max-w-full [&>*]:whitespace-normal [&>*]:break-words">
                                        {data.isOwner && <Badge>Owner</Badge>}
                                        {data.roles.map((r) => (
                                            <Badge
                                                key={r.slug}
                                                variant="secondary"
                                            >
                                                {r.name}
                                            </Badge>
                                        ))}
                                    </dd>
                                </div>
                                {data.warehouse && (
                                    <div className="space-y-2">
                                        <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                            <Building2
                                                aria-hidden="true"
                                                className="h-4 w-4 shrink-0"
                                            />{" "}
                                            Gudang
                                        </dt>
                                        <dd className="break-words font-medium">
                                            {data.warehouse.name}
                                            {data.warehouse.city
                                                ? ` · ${data.warehouse.city}`
                                                : ""}
                                        </dd>
                                    </div>
                                )}
                            </dl>
                            {isPartner && data.partner && (
                                <div className="mt-6 space-y-2 rounded-xl border border-primary/15 bg-primary/5 p-4 text-xs">
                                    <p className="font-semibold text-primary">
                                        {data.partner.type === "MARKETING"
                                            ? "Marketing Partner"
                                            : "Vehicle Owner Partner"}
                                    </p>
                                    <p className="text-muted-foreground">
                                        Profit share Anda:{" "}
                                        <b>
                                            {data.partner.profitShare.partner}%
                                        </b>{" "}
                                        · Perusahaan:{" "}
                                        {data.partner.profitShare.company}%
                                    </p>
                                    <p className="mt-1 text-muted-foreground">
                                        {hasPermission(
                                            user,
                                            "wallet.view_own",
                                        ) && (
                                            <a
                                                className="inline-flex min-h-10 items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                                                href="#/wallet"
                                            >
                                                Buka Wallet{" "}
                                                <ArrowUpRight
                                                    aria-hidden="true"
                                                    className="h-3.5 w-3.5"
                                                />
                                            </a>
                                        )}
                                    </p>
                                </div>
                            )}
                        </div>
                    </section>

                    <div className="min-w-0 space-y-6">
                        {/* Edit name + password - every user, including Owner */}
                        <section
                            aria-labelledby="profile-details-title"
                            className="min-w-0 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
                        >
                            <div className="mb-6 flex items-start gap-3">
                                <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
                                    <UserCircle2
                                        aria-hidden="true"
                                        className="h-5 w-5"
                                    />
                                </span>
                                <div className="min-w-0">
                                    <h2
                                        id="profile-details-title"
                                        className="font-semibold tracking-tight"
                                    >
                                        Informasi Pribadi
                                    </h2>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Perbarui informasi yang digunakan untuk
                                        mengenali akun Anda.
                                    </p>
                                </div>
                            </div>
                            <form onSubmit={onSaveName} className="space-y-5">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <Field
                                        label="Nama Tampilan"
                                        htmlFor="pf-name"
                                    >
                                        <Input
                                            id="pf-name"
                                            className="h-11"
                                            value={name}
                                            onChange={(e) =>
                                                setName(e.target.value)
                                            }
                                            required
                                            minLength={2}
                                            disabled={busyName}
                                            autoComplete="name"
                                        />
                                    </Field>
                                    {user?.isOwner && (
                                        <Field
                                            label="Username"
                                            htmlFor="pf-username"
                                        >
                                            <Input
                                                id="pf-username"
                                                className="h-11"
                                                value={username}
                                                onChange={(e) =>
                                                    setUsername(e.target.value)
                                                }
                                                disabled={busyName}
                                                autoComplete="username"
                                            />
                                        </Field>
                                    )}
                                </div>
                                <div className="flex justify-end border-t pt-4">
                                    <SubmitButton
                                        busy={busyName}
                                        className="h-11 w-full sm:w-auto"
                                    >
                                        <Save
                                            aria-hidden="true"
                                            className="h-4 w-4"
                                        />{" "}
                                        Simpan Nama
                                    </SubmitButton>
                                </div>
                            </form>
                        </section>

                        <section
                            aria-labelledby="profile-security-title"
                            className="min-w-0 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
                        >
                            <div className="mb-6 flex items-start gap-3">
                                <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
                                    <ShieldCheck
                                        aria-hidden="true"
                                        className="h-5 w-5"
                                    />
                                </span>
                                <div className="min-w-0">
                                    <h2
                                        id="profile-security-title"
                                        className="font-semibold tracking-tight"
                                    >
                                        Keamanan Akun
                                    </h2>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Gunakan password yang kuat dan tidak
                                        digunakan di akun lain.
                                    </p>
                                </div>
                            </div>
                            <form
                                onSubmit={onSavePassword}
                                className="space-y-5"
                            >
                                <Field
                                    label="Password Saat Ini"
                                    htmlFor="pf-cur"
                                >
                                    <Input
                                        id="pf-cur"
                                        className="h-11"
                                        type="password"
                                        value={pwd.current}
                                        onChange={(e) =>
                                            setPwd({
                                                ...pwd,
                                                current: e.target.value,
                                            })
                                        }
                                        required
                                        disabled={busyPwd}
                                        autoComplete="current-password"
                                    />
                                </Field>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <Field
                                        label="Password Baru"
                                        htmlFor="pf-next"
                                        hint="Minimal 8 karakter."
                                    >
                                        <Input
                                            id="pf-next"
                                            className="h-11"
                                            minLength={8}
                                            aria-invalid={passwordTooShort}
                                            type="password"
                                            value={pwd.next}
                                            onChange={(e) =>
                                                setPwd({
                                                    ...pwd,
                                                    next: e.target.value,
                                                })
                                            }
                                            required
                                            disabled={busyPwd}
                                            autoComplete="new-password"
                                        />
                                    </Field>
                                    <Field
                                        label="Konfirmasi Password Baru"
                                        htmlFor="pf-conf"
                                        error={
                                            passwordMismatch
                                                ? "Konfirmasi tidak cocok."
                                                : undefined
                                        }
                                    >
                                        <Input
                                            id="pf-conf"
                                            className="h-11"
                                            aria-invalid={passwordMismatch}
                                            type="password"
                                            value={pwd.confirm}
                                            onChange={(e) =>
                                                setPwd({
                                                    ...pwd,
                                                    confirm: e.target.value,
                                                })
                                            }
                                            required
                                            disabled={busyPwd}
                                            autoComplete="new-password"
                                        />
                                    </Field>
                                </div>
                                <div className="flex justify-end border-t pt-4">
                                    <SubmitButton
                                        busy={busyPwd}
                                        disabled={
                                            passwordMismatch || passwordTooShort
                                        }
                                        className="h-11 w-full sm:w-auto"
                                    >
                                        <KeyRound
                                            aria-hidden="true"
                                            className="h-4 w-4"
                                        />{" "}
                                        Ubah Password
                                    </SubmitButton>
                                </div>
                            </form>
                        </section>

                        {/* Bank account (partners only) */}
                        <section
                            aria-labelledby="profile-bank-title"
                            className="min-w-0 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
                        >
                            <div className="mb-6 flex items-start gap-3">
                                <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
                                    <Landmark
                                        aria-hidden="true"
                                        className="h-5 w-5"
                                    />
                                </span>
                                <div className="min-w-0">
                                    <h2
                                        id="profile-bank-title"
                                        className="font-semibold tracking-tight"
                                    >
                                        Rekening Withdrawal
                                    </h2>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Rekening tujuan untuk pencairan saldo
                                        wallet Anda.
                                    </p>
                                </div>
                            </div>
                            {isPartner ? (
                                <form
                                    onSubmit={onSaveBank}
                                    className="space-y-5"
                                >
                                    <p className="text-xs text-muted-foreground">
                                        Pastikan data rekening sesuai dengan
                                        buku tabungan. Data rekening dicatat
                                        pada setiap permintaan withdrawal.
                                    </p>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <Field
                                            label="Nama Bank"
                                            htmlFor="pf-bank-name"
                                        >
                                            <Input
                                                id="pf-bank-name"
                                                className="h-11"
                                                disabled={busyBank}
                                                value={bank.bankName}
                                                onChange={(e) =>
                                                    setBank({
                                                        ...bank,
                                                        bankName:
                                                            e.target.value,
                                                    })
                                                }
                                                placeholder="Bank Mandiri"
                                            />
                                        </Field>
                                        <Field
                                            label="Nama Pemilik Rekening"
                                            htmlFor="pf-bank-holder"
                                        >
                                            <Input
                                                id="pf-bank-holder"
                                                className="h-11"
                                                disabled={busyBank}
                                                value={bank.bankAccountName}
                                                onChange={(e) =>
                                                    setBank({
                                                        ...bank,
                                                        bankAccountName:
                                                            e.target.value,
                                                    })
                                                }
                                                placeholder="Nama sesuai buku tabungan"
                                            />
                                        </Field>
                                        <Field
                                            label="Nomor Rekening"
                                            htmlFor="pf-bank-number"
                                            className="sm:col-span-2"
                                        >
                                            <Input
                                                id="pf-bank-number"
                                                className="h-11"
                                                inputMode="numeric"
                                                disabled={busyBank}
                                                value={bank.bankAccountNumber}
                                                onChange={(e) =>
                                                    setBank({
                                                        ...bank,
                                                        bankAccountNumber:
                                                            e.target.value,
                                                    })
                                                }
                                                placeholder="1234567890"
                                            />
                                        </Field>
                                    </div>
                                    <div className="flex justify-end border-t pt-4">
                                        <SubmitButton
                                            busy={busyBank}
                                            className="h-11 w-full sm:w-auto"
                                        >
                                            <Save
                                                aria-hidden="true"
                                                className="h-4 w-4"
                                            />{" "}
                                            Simpan Rekening
                                        </SubmitButton>
                                    </div>
                                </form>
                            ) : (
                                <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
                                    Rekening withdrawal tersedia untuk akun
                                    partner Marketing dan Vehicle Owner. Akun
                                    Anda tidak memerlukan pengaturan rekening.
                                </div>
                            )}
                        </section>
                        {user?.isOwner && <CapacitySettingsCard />}
                    </div>
                </div>
            )}
        </div>
    );
}
