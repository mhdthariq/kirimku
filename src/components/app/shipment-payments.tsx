"use client";

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
    tracksShipmentPayments,
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
    if (
        !tracksShipmentPayments(shipment) ||
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
                    }),
                { success: "Pembayaran dicatat; menunggu verifikasi." },
            );
            if (saved) {
                setAmount("");
                setReference("");
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
                <CardTitle className="text-base">Pembayaran</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-4 text-sm">
                    <p>
                        Status: <strong>{totals.label}</strong>
                    </p>
                    <p>
                        Terverifikasi:{" "}
                        <strong>{formatRupiah(totals.paid)}</strong>
                    </p>
                    <p>
                        Sisa:{" "}
                        <strong>
                            {totals.total == null
                                ? "-"
                                : formatRupiah(totals.remaining)}
                        </strong>
                    </p>
                </div>
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
                                className="grid gap-3 sm:grid-cols-3"
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
                                <div>
                                    <SubmitButton busy={busy}>
                                        Catat Pembayaran
                                    </SubmitButton>
                                </div>
                            </form>
                        )
                    ))}
                <ul className="space-y-2" aria-label="Riwayat pembayaran">
                    {(shipment.payments ?? []).map((payment) => (
                        <li
                            key={payment.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                        >
                            <div>
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
                            {canVerify && payment.status === "RECORDED" && (
                                <div className="flex gap-2">
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
            </CardContent>
        </Card>
    );
}
