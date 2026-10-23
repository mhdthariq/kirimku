"use client";
import { PasteFileInput } from "@/components/ui/paste-file-input";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { runAction } from "@/hooks/use-api-data";
import {
    apiPost,
    hasPermission,
    type Shipment,
} from "@/infrastructure/http/client-api";
import {
    shipmentPaymentTotals,
} from "@/domain/shipment-payment";
import {
    Field,
    FormSelect,
    Input,
    NumberInput,
    SubmitButton,
    formatRupiah,
    formatDate,
} from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fileToCompressedJpeg } from "@/presentation/image-file";

export function CustomerPriceStatus({ shipment, detailed = false }: { shipment: Shipment; detailed?: boolean }) {
    const price = shipment.finalPriceAmount ?? shipment.paymentSummary?.finalPriceAmount ?? shipment.priceAmount;
    const paid = shipment.paymentSummary?.paidAmount ?? shipmentPaymentTotals(shipment).paid;
    const remaining = price == null ? null : Math.max(0, price - paid);
    const label = price == null ? "Belum dihitung" : remaining === 0 ? "Lunas" : paid > 0 ? "Sebagian" : "Belum Lunas";
    return <div className="min-w-0 space-y-2">
        <span className={`inline-flex max-w-full whitespace-normal rounded-full border px-2 py-1 text-xs font-semibold ${label === "Lunas" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{label}</span>
        {detailed && <dl className="grid min-w-0 gap-3 sm:grid-cols-3">{[["Harga customer", price], ["Sudah dibayar (terverifikasi)", paid], ["Sisa pembayaran", remaining]].map(([title, amount]) => <div key={String(title)} className="min-w-0 rounded-lg bg-muted/30 p-3"><dt className="text-xs text-muted-foreground">{title}</dt><dd className="mt-1 break-all text-base font-semibold">{typeof amount === "number" ? formatRupiah(amount) : "—"}</dd></div>)}</dl>}
    </div>;
}

export function ShipmentPayments({
    shipment,
    onChanged,
}: {
    shipment: Shipment;
    onChanged: () => Promise<void>;
}) {
    const { user } = useAuth();
    const [method, setMethod] = useState("CASH");
    const [amount, setAmount] = useState("");
    const [reference, setReference] = useState("");
    const [busy, setBusy] = useState(false);
    const [proof, setProof] = useState("");
    const [proofBusy, setProofBusy] = useState(false);
    const [proofError, setProofError] = useState("");
    const [viewProof, setViewProof] = useState<string | null>(null);
    if (
        shipment.customer?.type !== "b2c" ||
        !hasPermission(user, "payment.view")
    )
        return null;
    const totals = shipmentPaymentTotals(shipment);
    const canRecord =
        hasPermission(user, "payment.record") ||
        (user?.partnerType !== "MARKETING" &&
            user?.roles?.some((role) => role.slug === "admin-gudang"));
    const canVerify = hasPermission(user, "payment.verify");
    const active = shipment.status !== "CANCELLED";

    async function record(event: React.FormEvent) {
        event.preventDefault();
        if (
            !Number.isFinite(Number(amount)) ||
            Number(amount) < 1 ||
            Number(amount) > totals.remaining
        )
            return;
        setBusy(true);
        try {
            const saved = await runAction(
                () =>
                    apiPost(`/shipments/${shipment.id}/payments`, {
                        method,
                        amount: Number(amount),
                        reference: reference.trim() || null,
                        ...(proof ? { proof } : {}),
                    }),
                { success: "Pembayaran dicatat; menunggu verifikasi." },
            );
            if (saved) {
                setAmount("");
                setReference("");
                setProof("");
                await onChanged();
            }
        } finally {
            setBusy(false);
        }
    }

    async function decide(id: number, action: "verify" | "reject") {
        setBusy(true);
        try {
            const saved = await runAction(
                () => apiPost(`/payments/${id}/${action}`),
                {
                    success:
                        action === "verify"
                            ? "Pembayaran diverifikasi."
                            : "Pembayaran ditolak.",
                },
            );
            if (saved) await onChanged();
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card className="min-w-0 rounded-2xl shadow-sm">
            <CardHeader>
                <CardTitle className="text-base">Pembayaran Customer B2C</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <CustomerPriceStatus shipment={shipment} detailed />
                <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <section className="min-w-0 space-y-4 rounded-xl border bg-muted/15 p-4 sm:p-5" aria-label="Catat pembayaran customer">
                <h3 className="text-sm font-semibold">Catat pembayaran</h3>
                <p className="text-xs text-muted-foreground">
                    Hanya pembayaran terverifikasi yang dihitung sebagai lunas
                    dan ditampilkan pada resi. Pembayaran tercatat masih
                    menunggu verifikasi Admin Kantor / pemegang izin verifikasi.
                </p>
                {active &&
                    canRecord &&
                    (totals.total == null ? (
                        <p className="text-sm">
                            Hitung harga shipment sebelum mencatat pembayaran.
                        </p>
                    ) : (
                        totals.remaining > 0 && (
                            <form
                                onSubmit={record}
                                className="grid min-w-0 gap-4 sm:grid-cols-2"
                            >
                                <Field label="Metode pembayaran">
                                    <FormSelect
                                        value={method}
                                        onValueChange={setMethod}
                                        options={[
                                            { value: "CASH", label: "Tunai" },
                                            {
                                                value: "TRANSFER",
                                                label: "Transfer",
                                            },
                                        ]}
                                    />
                                </Field>
                                <Field label="Nominal pembayaran">
                                    <NumberInput
                                        aria-label="Nominal pembayaran"
                                        required
                                        min={1}
                                        max={totals.remaining}
                                        step="any"
                                        value={amount}
                                        onChange={(e) =>
                                            setAmount(e.target.value)
                                        }
                                    />
                                </Field>
                                <Field label="Referensi pembayaran (opsional)">
                                    <Input
                                        aria-label="Referensi pembayaran (opsional)"
                                        value={reference}
                                        onChange={(e) =>
                                            setReference(e.target.value)
                                        }
                                    />
                                </Field>
                                <Field label="Bukti pembayaran (opsional)">
                                    <PasteFileInput aria-label="Bukti pembayaran (opsional)" type="file" accept="image/jpeg,image/png" disabled={busy || proofBusy} onChange={async event => {
                                        const file = event.target.files?.[0]; event.target.value = "";
                                        if (!file) return;
                                        setProofBusy(true); setProofError("");
                                        try { setProof(await fileToCompressedJpeg(file)); }
                                        catch (error) { setProofError(error instanceof Error ? error.message : "Bukti gagal dibaca."); }
                                        finally { setProofBusy(false); }
                                    }} />
                                    {proofError && <p role="alert" className="text-xs text-destructive">{proofError}</p>}
                                    {proof && <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setViewProof(proof)}>Periksa bukti</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setProof("")}>Hapus bukti</Button></div>}
                                </Field>
                                <div className="flex justify-end border-t pt-4 sm:col-span-2">
                                    <SubmitButton busy={busy || proofBusy}>
                                        Catat Pembayaran
                                    </SubmitButton>
                                </div>
                            </form>
                        )
                    ))}
                </section>
                <section className="min-w-0 space-y-4 rounded-xl border p-4 sm:p-5" aria-label="Riwayat pembayaran customer"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Riwayat pembayaran</h3><span className="text-xs text-muted-foreground">{shipment.payments?.length ?? 0} transaksi</span></div>
                {!(shipment.payments?.length) && <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Belum ada pembayaran tercatat.</p>}
                <ul className="space-y-2" aria-label="Riwayat pembayaran">
                    {(shipment.payments ?? []).map((payment) => (
                        <li
                            key={payment.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                        >
                            <div className="min-w-0 break-words">
                                <p className="font-medium">
                                    {formatRupiah(payment.amount)} ·{" "}
                                    {payment.method === "TRANSFER"
                                        ? "Transfer"
                                        : "Tunai"}{" "}
                                    ·{" "}
                                    {payment.status === "VERIFIED"
                                        ? "Terverifikasi"
                                        : payment.status === "REJECTED"
                                          ? "Ditolak"
                                          : "Menunggu verifikasi"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {formatDate(payment.createdAt, true)} ·{" "}
                                    {payment.recordedBy?.name ?? "-"}
                                    {payment.reference
                                        ? ` · ${payment.reference}`
                                        : ""}
                                </p>
                            </div>
                            {payment.proofUrl && <Button type="button" variant="outline" size="sm" onClick={() => setViewProof(payment.proofUrl!)}>Lihat bukti pembayaran</Button>}
                            {canVerify && payment.status === "RECORDED" && (
                                <div className="flex flex-wrap gap-2">
                                    {active && (
                                        <Button
                                            size="sm"
                                            disabled={busy}
                                            onClick={() =>
                                                decide(payment.id, "verify")
                                            }
                                        >
                                            Verifikasi
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={busy}
                                        onClick={() =>
                                            decide(payment.id, "reject")
                                        }
                                    >
                                        Tolak
                                    </Button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
                </section>
                </div>
                <Dialog open={!!viewProof} onOpenChange={open => { if (!open) setViewProof(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Bukti pembayaran</DialogTitle><DialogDescription>Foto bukti pembayaran customer. Verifikasi pembayaran dilakukan secara terpisah.</DialogDescription></DialogHeader>{viewProof && <img src={viewProof} alt="Bukti pembayaran customer" className="max-h-[65dvh] w-full rounded-lg object-contain" />}</DialogContent></Dialog>
            </CardContent>
        </Card>
    );
}
