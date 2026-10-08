"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Printer, X } from "lucide-react";
import { COMPANY_NAME } from "@/shared/company";
import {
  apiGet,
  apiPost,
  type DetailShipment,
  type Customer,
  type Options,
  type Shipment,
  type ShipmentTotals,
} from "@/infrastructure/http/client-api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { formatNumber, formatRupiah } from "@/components/app/form-parts";
import { cn } from "@/shared/utils";
import { resiPricingMethodLabel, resiStatVisibility } from "@/presentation/resi-display";
import type { PricingMethod } from "@/infrastructure/http/client-api";
import { customerPrimaryName } from "@/presentation/customer-display";

type ResiShipment = Shipment & {
  details: DetailShipment[];
  customer?: Customer | null;
  totals?: ShipmentTotals;
};

interface ResiPrintProps {
  shipment: ResiShipment | null;
  onClose: () => void;
};

function volumeOf(d: DetailShipment): number {
  return (
    Math.round(
      (((d.lengthCm ?? 0) *
        (d.widthCm ?? 0) *
        (d.heightCm ?? 0)) /
        1_000_000) *
        1e6,
    ) / 1e6
  );
}

/**
 * Thermal-printer-safe small caps label.
 *
 * Thermal heads (203–300 DPI) dither grays into noise or drop them, so
 * every label is pure black on white, weight-driven hierarchy only.
 * Min font size kept at 7px — anything smaller becomes unreadable dots
 * on a 203 DPI head after the paper has absorbed a little humidity.
 */
function SmallCaps({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[7px] font-bold uppercase tracking-[0.08em] text-black">
      {children}
    </span>
  );
}

/**
 * Build the "Dicetak oleh" label from the current session.
 *
 * Format: "<Account Name> (<Role1> / <Role2>)"
 * - Uses the user's display `name` (Account Name) — not the username — so
 *   the printed footer matches what staff see in the header/sidebar.
 * - Owner gets the literal "Owner" role; non-owner users list every role
 *   `name` attached to their account, joined by ` / ` for multi-role cases.
 * - Returns null when there is no session (e.g. deep-link opened before
 *   login completes) so the print layout never shows an empty "()" pair.
 */
function buildPrintByLabel(user: ReturnType<typeof useAuth>["user"]): string | null {
  if (!user) return null;
  const accountName = user.name?.trim() || user.username;
  let roleLabel: string;
  if (user.isOwner) {
    roleLabel = "Owner";
  } else if (user.roles.length > 0) {
    roleLabel = user.roles.map((r) => r.name).join(" / ");
  } else {
    roleLabel = "-";
  }
  return `${accountName} (${roleLabel})`;
}

/**
 * Print format:
 * - Exactly 100mm x 100mm per sheet, no more, no less
 * - QR Code only (no barcode — QR survives smudges better)
 * - One master resi per page
 * - One package label per page
 * - Pure black/white only (thermal-safe, no gray tints, no shadows)
 * - Pengirim (sender) shown on both the master resi AND every package label
 * - 2px solid black borders — survive 203 DPI thermal rendering
 * - Larger QR codes (~70px) — scan reliably even after paper crumples
 *
 * Height budget @ 96 CSS px/inch (100mm ≈ 378px):
 *
 *   MASTER RESI:
 *     36 (header) + 86 (resi+QR) + 32 (route) + 78 (sender/receiver)
 *     + 44 (stats) + 16 (B2B pricing-method mark, B2B only) + 24 (price,
 *     optional) + 24 (insurance, optional) + 34 (warehouse) + flex (footer)
 *     = 334px fixed without optionals (B2C, or B2B before pricing) →
 *       44px+ footer room
 *     = 350px fixed for B2B without price/insurance optionals →
 *       28px+ footer room
 *     = 398px fixed for a B2B shipment with BOTH price AND insurance shown
 *       → exceeds the 378px sheet height by ~20px in this one combination;
 *       the footer (flex-1, min-h-0) shrinks to absorb it, down to fully
 *       hidden in the worst case — the resi number/QR/route/stats/price,
 *       the parts that matter operationally, are never affected, only the
 *       "printed at/by" footer trivia in this specific worst case
 *
 *   PACKAGE LABEL:
 *     36 (header) + 86 (code+QR) + 24 (master ref)
 *     + 78 (sender/receiver, side by side — same layout as the Master Resi)
 *     + 40 (address) + 40 (stats)
 *     + 14 (B2B pricing-method mark, B2B only) + flex (description+footer)
 *     = 304px fixed (B2C, or B2B before pricing) → 74px+ for description/footer
 *     = 318px fixed for B2B → 60px+ for description/footer
 */
export function ResiPrint({
  shipment,
  onClose,
}: ResiPrintProps) {
  const { user } = useAuth();
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Options | null>(null);

  // Print-by label — resolved once per render from the session. Captured at
  // print time (not at component mount) so the footer reflects whoever is
  // actually logged in when the user hits "Cetak / Simpan PDF".
  const printByLabel = buildPrintByLabel(user);

  // Fire-and-forget audit log — called right before window.print() opens
  // the OS print dialog. The server records who printed which resi at
  // what time, so there's a permanent trail even if the printed paper
  // copy is lost or the PDF is deleted. Errors are swallowed on purpose:
  // a failed audit write must never block the actual print.
  const logPrint = () => {
    if (!shipment?.id) return;
    apiPost(`/shipments/${shipment.id}/print-log`).catch(() => undefined);
  };

  // Lock the page scroll behind the portal — exactly ONE scrollbar (the
  // portal's own) stays visible, matching the invoice detail print view.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    apiGet<Options>("/options")
      .then(setOptions)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!shipment) return;

    let cancelled = false;

    const codes = [
      shipment.resi ?? shipment.masterCode,
      ...shipment.details.map((d) => d.detailCode),
    ].filter(Boolean);

    Promise.all(
      codes.map(async (code) => {
        // Higher width + margin: gives the QR more quiet zone so a
        // thermal-printed copy scans even if the surrounding ink bleeds.
        const url = await QRCode.toDataURL(code, {
          margin: 2,
          width: 480,
          errorCorrectionLevel: "M",
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        });

        return [code, url] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) {
          setQrMap(Object.fromEntries(entries));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [shipment]);

  if (!shipment || typeof document === "undefined") {
    return null;
  }

  const company = options?.company?.name ?? COMPANY_NAME;
  const warehouses = options?.warehouses ?? [];

  const originGudang =
    warehouses.find(
      (w) => w.id === shipment.originWarehouseId,
    ) ??
    warehouses.find(
      (w) =>
        (w.city ?? "").toLowerCase() ===
        shipment.origin.toLowerCase(),
    ) ??
    null;

  const destGudang =
    warehouses.find(
      (w) => w.id === shipment.destinationWarehouseId,
    ) ??
    warehouses.find(
      (w) =>
        (w.city ?? "").toLowerCase() ===
        shipment.destination.toLowerCase(),
    ) ??
    null;

  const resiNumber =
    shipment.resi ?? shipment.masterCode;

  const totalPackages =
    shipment.details.length;

  const totalVolume =
    shipment.totals?.totalVolumeM3 ?? 0;

  const actualWeight =
    shipment.totals?.totalActualKg ?? 0;

  const chargeableWeight =
    shipment.chargeableWeightKg ?? actualWeight;

  const penerima = {
    name: shipment.penerimaName ?? "-",
    address: shipment.penerimaAddress ?? "-",
    contact: shipment.penerimaContact ?? "-",
  };

  // Pengirim (sender) — auto-filled from the Customer record at shipment
  // creation but editable per-shipment; fall back to the customer master
  // data when the per-shipment field is empty.
  const pengirim = {
    name: shipment.pengirimName ?? (shipment.customer ? customerPrimaryName(shipment.customer) : "-"),
    phone: shipment.pengirimPhone ?? shipment.customer?.phone ?? "-",
    email: shipment.pengirimEmail ?? shipment.customer?.email ?? null,
    address: shipment.pengirimAddress ?? shipment.customer?.address ?? null,
  };

  const originName =
    shipment.origin;

  const destinationName =
    shipment.destination;

  const originSupport =
    originGudang?.customerSupportContact ?? "-";

  const destinationSupport =
    destGudang?.customerSupportContact ?? "-";

  // Resi hanya menampilkan Nilai Pengiriman (+ No. Invoice untuk B2B).
  // Status pembayaran (UNPAID / DP / PAID) tidak lagi ditampilkan di resi
  // karena seluruh biaya B2C ditanggung Marketing dan B2B ditagihkan via Invoice.
  const finalPrice =
    shipment.finalPriceAmount ??
    shipment.priceAmount ??
    0;

  const isB2B = shipment.customer?.type === "b2b";
  const invoiceNumber =
    shipment.invoiceLines?.[0]?.invoice.invoiceNumber ?? null;

  // Fix, 2026-09-28 — B2B chooses ONE pricing method (/kg, /koli, /cubic)
  // per tariff; the Master Resi must mark which one and only show the
  // stat cells that are actually relevant to it (see resiStatVisibility's
  // doc comment for the exact rule). Prefer the snapshot taken when the
  // shipment was priced (`shipment.pricingMethod`); fall back to the
  // selected tariff's method for a B2B shipment printed before pricing
  // has run yet, so the mark is correct from the moment the resi exists,
  // not just after "Hitung Harga". B2C is always /kg and unaffected.
  const effectivePricingMethod: PricingMethod = isB2B
    ? shipment.pricingMethod ?? shipment.tariff?.pricingMethod ?? "PER_KG"
    : "PER_KG";
  const { showWeight: showWeightStats, showVolume: showVolumeStats } = isB2B
    ? resiStatVisibility(effectivePricingMethod)
    : { showWeight: true, showVolume: true };

  const statCells: { key: string; label: string; value: string; unit: string }[] = [
    { key: "jumlah", label: "Jumlah", value: String(totalPackages), unit: "pcs" },
  ];
  if (showWeightStats && isB2B && Math.abs(chargeableWeight - actualWeight) < 0.005) {
    // B2B /kg bills the weight as entered: Aktual and Chargeable are the same
    // number, so show a single Berat cell. (When the tariff's Min kg lifts the
    // billed weight above the entered weight, both cells show, below.)
    statCells.push({ key: "berat", label: "Berat", value: formatNumber(actualWeight, 2), unit: "kg" });
  } else if (showWeightStats) {
    statCells.push(
      { key: "aktual", label: "Aktual", value: formatNumber(actualWeight), unit: "kg" },
      { key: "chargeable", label: "Chargeable", value: formatNumber(chargeableWeight), unit: "kg" },
    );
  }
  if (showVolumeStats) {
    statCells.push({ key: "volume", label: "Volume", value: totalVolume.toFixed(3), unit: "m\u00b3" });
  }

  // Package label (Resi Detail) stats row — same visibility rule as the
  // Master Resi, just counted differently: Berat is 1 cell, Volume+Dimensi
  // are 2 cells together, Colly (+1) always shows.
  const packageStatCount = (showWeightStats ? 1 : 0) + (showVolumeStats ? 2 : 0) + 1;

  const sheets = (
    <>
      {/* ============================================================
          MASTER RESI - 100mm × 100mm
          Every section is flex-col with explicit fixed heights so the
          sheet always totals exactly 100mm regardless of how long the
          underlying data is. Long fields truncate (truncate class) to
          one line so a section's height never depends on content. The
          footer flex-1 absorbs whatever is left.
          ============================================================ */}

      <section className="resi-sheet mx-auto flex h-[100mm] w-[100mm] flex-col overflow-hidden bg-white text-black">
        {/* Header - fixed 36px. 2px bottom border so the header line
            survives 203 DPI thermal printing. */}
        <header className="flex h-9 flex-none items-center justify-between gap-2 border-b-2 border-black px-3">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-extrabold uppercase leading-none tracking-[0.04em]">
              {company}
            </p>

            <p className="mt-1 truncate text-[7px] font-bold uppercase tracking-[0.12em] text-black">
              Surat Pengiriman / Shipment Receipt
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-center justify-center border-[1.5px] border-black px-2 py-1">
            <SmallCaps>Jenis</SmallCaps>

            <p className="text-[8px] font-extrabold uppercase leading-tight">
              MASTER RESI
            </p>
          </div>
        </header>

        {/* Resi Number + QR - fixed 86px. QR is 70×70 so the thermal
            printer renders enough modules for reliable scanning. */}
        <div className="h-21.5 flex-none border-b border-black">
          <div className="grid h-full grid-cols-[1fr_78px]">
            <div className="flex min-w-0 flex-col justify-center overflow-hidden border-r border-black px-3">
              <SmallCaps>Nomor Resi</SmallCaps>

              <p className="mt-1 truncate font-mono text-[17px] font-extrabold leading-none tracking-[0.02em]">
                {resiNumber}
              </p>

              <p className="mt-1.5 truncate text-[7px] font-semibold uppercase tracking-[0.06em] text-black">
                Scan QR untuk identifikasi shipment
              </p>

              <p className="mt-0.5 truncate text-[7px] font-normal text-black">
                Dibuat: {new Date(shipment.createdAt).toLocaleDateString("id-ID", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>

            <div className="flex items-center justify-center p-1">
              {qrMap[resiNumber] ? (
                <img
                  src={qrMap[resiNumber]}
                  alt="QR code resi shipment"
                  className="h-17.5 w-17.5"
                />
              ) : (
                <div className="h-17.5 w-17.5 border border-dashed border-black" />
              )}
            </div>
          </div>
        </div>

        {/* Route - fixed 32px. Bigger font for the city names so
            handlers can read them at arm's length on the warehouse
            floor. */}
        <div className="h-8 flex-none border-b border-black px-3">
          <div className="grid h-full grid-cols-[1fr_22px_1fr] items-center gap-1">
            <div className="min-w-0 leading-none">
              <p className="text-[6.5px] font-bold uppercase tracking-widest text-black">
                Asal
              </p>
              <p className="mt-0.5 truncate text-[11px] font-extrabold uppercase leading-none">
                {originName}
              </p>
            </div>

            <div className="text-center text-[14px] font-black leading-none">
              →
            </div>

            <div className="min-w-0 text-right leading-none">
              <p className="text-[6.5px] font-bold uppercase tracking-widest text-black">
                Tujuan
              </p>
              <p className="mt-0.5 truncate text-[11px] font-extrabold uppercase leading-none">
                {destinationName}
              </p>
            </div>
          </div>
        </div>

        {/* Sender / Receiver - fixed 78px. Two equal columns with name,
            contact, and address. Address truncates to 2 lines. */}
        <div className="h-19.5 flex-none grid grid-cols-2 border-b border-black">
          <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden border-r border-black px-3">
            <SmallCaps>Pengirim</SmallCaps>

            <p className="truncate text-[10px] font-extrabold leading-tight">
              {pengirim.name}
            </p>

            <p className="truncate text-[8px] font-semibold leading-tight text-black">
              Telp: {pengirim.phone}
            </p>

            {pengirim.address && (
              <p className="line-clamp-2 text-[8px] font-normal leading-tight text-black">
                {pengirim.address}
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden px-3">
            <SmallCaps>Penerima</SmallCaps>

            <p className="truncate text-[10px] font-extrabold leading-tight">
              {penerima.name}
            </p>

            <p className="truncate text-[8px] font-semibold leading-tight text-black">
              Telp: {penerima.contact}
            </p>

            <p className="line-clamp-2 text-[8px] font-normal leading-tight text-black">
              {penerima.address}
            </p>
          </div>
        </div>

        {/* Shipment Stats - fixed 44px. Jumlah (colly count) always shows;
            weight/volume cells are shown only when relevant to how this
            B2B shipment is actually billed (resiStatVisibility) — B2C
            always shows all 4 cells, unchanged. Column count adapts to
            how many cells are visible so they stay evenly spaced. */}
        <div
          className={cn(
            "h-11 flex-none grid border-b border-black",
            statCells.length === 1 && "grid-cols-1",
            statCells.length === 2 && "grid-cols-2",
            statCells.length === 3 && "grid-cols-3",
            statCells.length === 4 && "grid-cols-4",
          )}
        >
          {statCells.map((cell, i) => (
            <div
              key={cell.key}
              className={cn(
                "flex flex-col items-center justify-center text-center leading-none",
                i < statCells.length - 1 && "border-r border-black",
              )}
            >
              <SmallCaps>{cell.label}</SmallCaps>
              <p className="mt-1 text-[13px] font-extrabold leading-none">{cell.value}</p>
              <p className="mt-0.5 text-[6px] font-normal uppercase text-black">{cell.unit}</p>
            </div>
          ))}
        </div>

        {/* B2B pricing-method mark - fixed 16px, B2B only. Inverted
            (black-bg/white-text) so it reads as a distinct mark rather
            than just another stat, telling handling/finance staff at a
            glance which of the 3 B2B pricing methods this shipment is
            billed by — directly explains why the stats row above shows
            (or hides) weight/volume. */}
        {isB2B && (
          <div className="flex h-4 flex-none items-center justify-between border-b border-black bg-black px-3">
            <span className="text-[7px] font-bold uppercase tracking-[0.1em] text-white">Metode Tarif B2B</span>
            <span className="text-[8px] font-extrabold uppercase tracking-[0.04em] text-white">
              {resiPricingMethodLabel(effectivePricingMethod)}
            </span>
          </div>
        )}

        {/* Nilai Pengiriman - fixed 24px. Untuk B2B, No. Invoice ditampilkan
            di samping harga karena penagihan ke perusahaan dilakukan via invoice,
            bukan via pembayaran per resi. Pembayaran B2C ditanggung Marketing. */}
        {shipment.priceAmount != null && (
          <div className="flex h-6 flex-none items-center justify-between border-b border-black px-3">
            <SmallCaps>Nilai Pengiriman</SmallCaps>
            <div className="flex items-baseline gap-2 min-w-0">
              {isB2B && invoiceNumber && (
                <span className="truncate text-[8px] font-semibold text-black">
                  Inv. {invoiceNumber}
                </span>
              )}
              <p className="text-[10px] font-extrabold leading-none">
                {formatRupiah(finalPrice || shipment.priceAmount)}
              </p>
            </div>
          </div>
        )}

        {shipment.insuranceAmount > 0 && (
          <div className="flex h-6 flex-none items-center justify-between border-b border-black px-3">
            <SmallCaps>Asuransi</SmallCaps>
            <p className="text-[9px] font-extrabold leading-none">
              {formatRupiah(shipment.insuranceAmount)}
            </p>
          </div>
        )}

        {/* Warehouse - fixed 34px. Origin + destination warehouse with
            customer-support contact. */}
        <div className="h-8.5 flex-none grid grid-cols-2 border-b border-black">
          <div className="flex min-w-0 flex-col justify-center overflow-hidden border-r border-black px-3 leading-none">
            <SmallCaps>Gudang Asal / CS</SmallCaps>
            <p className="mt-0.5 truncate text-[8px] font-semibold">
              {originName} · {originSupport}
            </p>
          </div>

          <div className="flex min-w-0 flex-col justify-center overflow-hidden px-3 leading-none">
            <SmallCaps>Gudang Tujuan / CS</SmallCaps>
            <p className="mt-0.5 truncate text-[8px] font-semibold">
              {destinationName} · {destinationSupport}
            </p>
          </div>
        </div>

        {/* Footer - flex-1, absorbs whatever height is left so the
            sheet always totals exactly 100mm. Includes handling
            instructions, signature lines, print timestamp, and the
            account name + role of the staff who triggered the print. */}
        <footer className="flex min-h-0 flex-1 flex-col justify-between gap-1 overflow-hidden px-3 py-2 text-[8px] leading-tight text-black">
          <div className="flex-1 min-h-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="shrink-0 tracking-widest">
                Dicetak: {new Date().toLocaleDateString("id-ID")}
              </p>
              {printByLabel && (
                <p className="min-w-0 truncate text-right tracking-wide">
                  <span className="font-bold uppercase tracking-[0.08em]">Dicetak oleh:</span>{" "}
                  {printByLabel}
                </p>
              )}
            </div>
          </div>
        </footer>
      </section>

      {/* ============================================================
          PACKAGE LABELS - 100mm × 100mm
          Same fixed-height-per-section approach as the master resi.
          QR is bumped to 70×70 too - package labels get scanned more
          often (at every checkpoint) so the larger module size pays
          off in scan reliability.
          ============================================================ */}

      {shipment.details.map((d, i) => {
        const pcs = `${String(i + 1).padStart(3, "0")}/${String(
          totalPackages,
        ).padStart(3, "0")}`;

        const volume = volumeOf(d);
        const actual = d.actualWeightKg ?? 0;
        const labelId = d.detailCode;

        return (
          <section
            key={d.id}
            className="resi-sheet mx-auto flex h-[100mm] w-[100mm] flex-col overflow-hidden bg-white text-black"
          >
            {/* Header - fixed 36px. Same 2px bottom border as the master
                resi so the visual style is consistent across all
                sheets in the print run. */}
            <header className="flex h-9 flex-none items-center justify-between gap-2 border-b-2 border-black px-3">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-extrabold uppercase leading-none tracking-[0.04em]">
                  {company}
                </p>

                <p className="mt-1 truncate text-[7px] font-bold uppercase tracking-widest text-black">
                  Package / Colly Label
                </p>
              </div>

              <div className="shrink-0 text-right leading-none">
                <SmallCaps>Isi Shipment</SmallCaps>

                <p className="mt-1 font-mono text-[10px] font-extrabold">
                  {pcs}
                </p>
              </div>
            </header>

            {/* Package Code + QR - fixed 86px. Larger QR (70px) for
                checkpoint scanning. */}
            <div className="h-21.5 flex-none border-b border-black">
              <div className="grid h-full grid-cols-[1fr_78px]">
                <div className="flex min-w-0 flex-col justify-center overflow-hidden border-r border-black px-3">
                  <SmallCaps>Kode Paket</SmallCaps>

                  <p className="mt-1 truncate font-mono text-[14px] font-extrabold leading-none tracking-[0.02em]">
                    {labelId}
                  </p>

                  <p className="mt-1.5 text-[7px] font-semibold uppercase tracking-[0.06em] text-black">
                    No. Master
                  </p>

                  <p className="truncate font-mono text-[8px] font-bold">
                    {resiNumber}
                  </p>
                </div>

                <div className="flex items-center justify-center p-1">
                  {qrMap[labelId] ? (
                    <img
                      src={qrMap[labelId]}
                      alt="QR code paket"
                      className="h-17.5 w-17.5"
                    />
                  ) : (
                    <div className="h-17.5 w-17.5 border border-dashed border-black" />
                  )}
                </div>
              </div>
            </div>

            {/* Route band - fixed 24px. Compact route strip so the
                handler knows where this colly needs to go without
                flipping back to the master resi. */}
            <div className="h-6 flex-none border-b border-black px-3">
              <div className="grid h-full grid-cols-[1fr_18px_1fr] items-center gap-1">
                <div className="min-w-0 leading-none">
                  <span className="text-[6.5px] font-bold uppercase tracking-widest text-black">
                    Asal:{" "}
                  </span>
                  <span className="truncate text-[9px] font-extrabold uppercase">
                    {originName}
                  </span>
                </div>

                <div className="text-center text-[11px] font-black leading-none">
                  →
                </div>

                <div className="min-w-0 text-right leading-none">
                  <span className="text-[6.5px] font-bold uppercase tracking-widest text-black">
                    Tujuan:{" "}
                  </span>
                  <span className="truncate text-[9px] font-extrabold uppercase">
                    {destinationName}
                  </span>
                </div>
              </div>
            </div>

            {/* Pengirim / Penerima - fixed 78px, side by side (same layout
                as the Master Resi) instead of two stacked blocks, so both
                are visible together without scrolling the eye down the
                label. */}
            <div className="h-19.5 flex-none grid grid-cols-2 border-b border-black">
              <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden border-r border-black px-3">
                <SmallCaps>Pengirim</SmallCaps>
                <p className="truncate text-[10px] font-extrabold leading-tight">
                  {pengirim.name}
                </p>
                <p className="truncate text-[8px] font-semibold leading-tight text-black">
                  Telp: {pengirim.phone}
                </p>
                {pengirim.address && (
                  <p className="line-clamp-2 text-[8px] font-normal leading-tight text-black">
                    {pengirim.address}
                  </p>
                )}
              </div>

              <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden px-3">
                <SmallCaps>Penerima</SmallCaps>
                <p className="truncate text-[10px] font-extrabold leading-tight">
                  {penerima.name}
                </p>
                <p className="truncate text-[8px] font-semibold leading-tight text-black">
                  Telp: {penerima.contact}
                </p>
                <p className="line-clamp-2 text-[8px] font-normal leading-tight text-black">
                  {penerima.address}
                </p>
              </div>
            </div>

            {/* Package Stats - fixed 40px. Colly always shows (same rule
                as the Master Resi — see resiStatVisibility); weight/volume
                +dimension are shown only when relevant to the B2B pricing
                method, B2C unaffected (all 4 cells, unchanged). Column
                count adapts to how many cells are visible. */}
            <div
              className={cn(
                "h-10 flex-none grid border-b border-black",
                packageStatCount === 1 && "grid-cols-1",
                packageStatCount === 2 && "grid-cols-2",
                packageStatCount === 3 && "grid-cols-3",
                packageStatCount === 4 && "grid-cols-4",
              )}
            >
              {showWeightStats && (
                <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
                  <SmallCaps>Berat</SmallCaps>
                  <p className="mt-1 text-[11px] font-extrabold leading-none">
                    {formatNumber(actual)}
                  </p>
                  <p className="mt-0.5 text-[6px] font-normal uppercase text-black">
                    kg
                  </p>
                </div>
              )}

              {showVolumeStats && (
                <>
                  <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
                    <SmallCaps>Volume</SmallCaps>
                    <p className="mt-1 text-[11px] font-extrabold leading-none">
                      {volume.toFixed(3)}
                    </p>
                    <p className="mt-0.5 text-[6px] font-normal uppercase text-black">
                      m³
                    </p>
                  </div>

                  <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
                    <SmallCaps>Dimensi</SmallCaps>
                    <p className="mt-1 text-[8px] font-extrabold leading-none">
                      {d.lengthCm != null
                        ? `${formatNumber(
                            d.lengthCm,
                            0,
                          )}×${formatNumber(
                            d.widthCm ?? 0,
                            0,
                          )}×${formatNumber(
                            d.heightCm ?? 0,
                            0,
                          )}`
                        : "-"}
                    </p>
                    <p className="mt-0.5 text-[6px] font-normal uppercase text-black">
                      cm
                    </p>
                  </div>
                </>
              )}

              {/* Colly always shows — this IS the billing unit for /koli,
                  and matters for handling no matter how it's billed. */}
              <div className="flex flex-col items-center justify-center text-center leading-none">
                <SmallCaps>Colly</SmallCaps>
                <p className="mt-1 font-mono text-[11px] font-extrabold leading-none">
                  {pcs}
                </p>
                <p className="mt-0.5 text-[6px] font-normal uppercase text-black">
                  of {totalPackages}
                </p>
              </div>
            </div>

            {/* B2B pricing-method mark - same treatment as the Master Resi
                (fixed ~14px, B2B only, inverted black-bg/white-text) so a
                package label handled on its own (e.g. at a checkpoint scan,
                away from the master resi) still tells staff which method
                this shipment is billed by. */}
            {isB2B && (
              <div className="flex h-3.5 flex-none items-center justify-between border-b border-black bg-black px-3">
                <span className="text-[6.5px] font-bold uppercase tracking-[0.08em] text-white">Tarif B2B</span>
                <span className="text-[7px] font-extrabold uppercase tracking-[0.04em] text-white">
                  {resiPricingMethodLabel(effectivePricingMethod)}
                </span>
              </div>
            )}

            {/* Description - flex-1, fills the remaining space so the
                sheet always totals exactly 100mm. Dashed rule on top
                is solid black (not gray) so it reproduces on thermal
                paper. Includes a "scan at operation point" reminder. */}
            <footer className="flex min-h-0 flex-1 flex-col justify-between gap-1 overflow-hidden border-t border-dashed border-black px-3 py-2 text-[7px] leading-tight text-black">
              <div className="flex-1 min-h-0">
                <SmallCaps>Isi / Keterangan</SmallCaps>
                <p className="mt-1 line-clamp-2 text-[8px] font-semibold leading-tight">
                  {d.description || "-"}
                </p>
              </div>

              <div className="flex items-end justify-between gap-2 border-t border-black pt-1">
                <div className="leading-none">
                  <p className="text-[6.5px] font-bold uppercase tracking-[0.06em]">
                    Master
                  </p>
                  <p className="mt-0.5 font-mono text-[8px] font-extrabold">
                    {resiNumber}
                  </p>
                </div>
                <div className="text-center leading-none">
                  <p className="text-[6.5px] font-bold uppercase tracking-[0.06em]">
                    Pcs
                  </p>
                  <p className="mt-0.5 font-mono text-[8px] font-extrabold">
                    {pcs}
                  </p>
                </div>
                <div className="text-right leading-none">
                  <p className="text-[6.5px] font-bold uppercase tracking-[0.06em]">
                    Scan
                  </p>
                  <p className="mt-0.5 text-[7px] font-semibold">
                    At Operation Point
                  </p>
                </div>
              </div>

              <p className="mt-1 text-[6px] font-normal text-black">
                Dicetak: {new Date().toLocaleString("id-ID")}
              </p>
              {printByLabel && (
                <p className="mt-0.5 truncate text-[6px] font-normal text-black">
                  <span className="font-bold uppercase tracking-[0.06em]">Oleh:</span>{" "}
                  {printByLabel}
                </p>
              )}
            </footer>
          </section>
        );
      })}
    </>
  );

  return createPortal(
    <>
      {/* ============================================================
          PRINT STYLES
          @page is set to exactly 100mm x 100mm with zero margin. The
          sheet itself carries its own w-[100mm]/h-[100mm] sizing via
          Tailwind so screen preview and print always agree - there is
          no separate "print-only" size rule left to drift out of sync.

          Thermal-printer compatibility:
          - All colors forced to pure black/white via filter:
            grayscale(1) contrast(100) - eliminates any anti-aliased
            gray edges the browser might produce.
          - print-color-adjust: exact on every element so Chrome's
            "save as PDF" and the OS print dialog both keep the
            borders and backgrounds.
          - No box-shadows or transparent overlays survive into print.
          ============================================================ */}

      <style jsx global>{`
        @page {
          size: 100mm 100mm;
          margin: 0;
        }

        @media print {
          html,
          body {
            width: 100mm;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }

          body * {
            visibility: hidden;
          }

          #resi-print-portal,
          #resi-print-portal * {
            visibility: visible;
          }

          #resi-print-portal {
            position: static !important;
            width: 100mm !important;
            min-width: 100mm !important;
            max-width: 100mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: white !important;
          }

          #resi-print-portal > .print-toolbar {
            display: none !important;
          }

          #resi-print-portal > .print-content {
            display: block !important;
            width: 100mm !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .resi-sheet {
            width: 100mm !important;
            height: 100mm !important;
            min-width: 100mm !important;
            max-width: 100mm !important;
            min-height: 100mm !important;
            max-height: 100mm !important;

            margin: 0 !important;
            padding: 0 !important;

            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;

            overflow: hidden !important;
            box-sizing: border-box !important;

            /* Force pure black/white — no anti-aliased gray edges from
               the browser's own rendering getting sent to the printer.
               Critical for thermal heads that dither grays into noise. */
            filter: grayscale(1) contrast(100);

            /* Ensure every border + background is preserved by Chrome's
               "Save as PDF" and by the OS print dialog. Without this,
               some browsers strip 1px borders when downscaling to the
               printer's DPI. */
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          .resi-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          .resi-sheet:last-child {
            page-break-after: auto;
            break-after: auto;
          }

          img {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
            /* Render QR codes crisply at the printer's native DPI
               instead of letting the browser smooth-scale them. */
            image-rendering: pixelated;
            image-rendering: crisp-edges;
          }
        }

        @media screen {
          .resi-sheet {
            box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
          }
        }
      `}</style>

      <div
        id="resi-print-portal"
        className="fixed inset-0 z-80 overflow-y-auto bg-neutral-200 dark:bg-neutral-900"
      >
        {/* Screen toolbar */}
        <div className="print-toolbar sticky top-0 z-10 flex flex-col gap-3 border-b bg-white px-4 py-3 shadow-sm dark:bg-neutral-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">
              Pratinjau Cetak Resi - {resiNumber}
            </p>

            <p className="text-xs text-muted-foreground">
              QR Code only • Ukuran 100 × 100 mm • Thermal printer ready • 1 Master Resi +{" "}
              {totalPackages} Package Label
            </p>

            {printByLabel && (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Akan dicetak oleh:</span>{" "}
                {printByLabel}
              </p>
            )}
          </div>

          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
              Tutup
            </Button>

            <Button
              type="button"
              className="flex-1 sm:flex-none"
              onClick={() => {
                logPrint();
                window.print();
              }}
            >
              <Printer className="h-4 w-4" />
              Cetak / Simpan PDF
            </Button>
          </div>
        </div>

        {/* Preview */}
        <div className="print-content space-y-4 px-2 py-4 print:p-0">
          {sheets}
        </div>
      </div>
    </>,
    document.body,
  );
}
