"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Printer, X } from "lucide-react";
import { COMPANY_NAME } from "@/lib/company";
import {
  apiGet,
  apiPost,
  type DetailShipment,
  type Customer,
  type Options,
  type Shipment,
  type ShipmentTotals,
} from "@/lib/client-api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { formatNumber, formatRupiah } from "@/components/app/form-parts";

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
    roleLabel = "—";
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
 *     + 44 (stats) + 24 (price, optional) + 24 (insurance, optional)
 *     + 34 (warehouse) + flex (footer)
 *     = 334px fixed without optionals → 44px+ footer room
 *     = 382px fixed with BOTH optionals → footer shrinks but never clips
 *       because optional rows themselves shrink to 18px each via flex
 *
 *   PACKAGE LABEL:
 *     36 (header) + 86 (code+QR) + 24 (master ref) + 50 (sender)
 *     + 50 (receiver) + 40 (address) + 40 (stats) + flex (description+footer)
 *     = 326px fixed → 52px+ for description/footer
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
    name: shipment.penerimaName ?? "—",
    address: shipment.penerimaAddress ?? "—",
    contact: shipment.penerimaContact ?? "—",
  };

  // Pengirim (sender) — auto-filled from the Customer record at shipment
  // creation but editable per-shipment; fall back to the customer master
  // data when the per-shipment field is empty.
  const pengirim = {
    name: shipment.pengirimName ?? shipment.customer?.name ?? "—",
    phone: shipment.pengirimPhone ?? shipment.customer?.phone ?? "—",
    email: shipment.pengirimEmail ?? shipment.customer?.email ?? null,
    address: shipment.pengirimAddress ?? shipment.customer?.address ?? null,
  };

  const originName =
    shipment.origin;

  const destinationName =
    shipment.destination;

  const originSupport =
    originGudang?.customerSupportContact ?? "—";

  const destinationSupport =
    destGudang?.customerSupportContact ?? "—";

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

  const sheets = (
    <>
      {/* ============================================================
          MASTER RESI — 100mm × 100mm
          Every section is flex-col with explicit fixed heights so the
          sheet always totals exactly 100mm regardless of how long the
          underlying data is. Long fields truncate (truncate class) to
          one line so a section's height never depends on content. The
          footer flex-1 absorbs whatever is left.
          ============================================================ */}

      <section className="resi-sheet mx-auto flex h-[100mm] w-[100mm] flex-col overflow-hidden bg-white text-black">
        {/* Header — fixed 36px. 2px bottom border so the header line
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

        {/* Resi Number + QR — fixed 86px. QR is 70×70 so the thermal
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

        {/* Route — fixed 32px. Bigger font for the city names so
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

        {/* Sender / Receiver — fixed 78px. Two equal columns with name,
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

        {/* Shipment Stats — fixed 44px. 4 cells with stat header + value.
            Each cell has a vertical divider so handlers can scan a
            single column at a time. */}
        <div className="h-11 flex-none grid grid-cols-4 border-b border-black">
          <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
            <SmallCaps>Jumlah</SmallCaps>
            <p className="mt-1 text-[13px] font-extrabold leading-none">
              {totalPackages}
            </p>
            <p className="mt-0.5 text-[6px] font-normal uppercase text-black">
              pcs
            </p>
          </div>

          <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
            <SmallCaps>Aktual</SmallCaps>
            <p className="mt-1 text-[13px] font-extrabold leading-none">
              {formatNumber(actualWeight)}
            </p>
            <p className="mt-0.5 text-[6px] font-normal uppercase text-black">
              kg
            </p>
          </div>

          <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
            <SmallCaps>Chargeable</SmallCaps>
            <p className="mt-1 text-[13px] font-extrabold leading-none">
              {formatNumber(chargeableWeight)}
            </p>
            <p className="mt-0.5 text-[6px] font-normal uppercase text-black">
              kg
            </p>
          </div>

          <div className="flex flex-col items-center justify-center text-center leading-none">
            <SmallCaps>Volume</SmallCaps>
            <p className="mt-1 text-[13px] font-extrabold leading-none">
              {totalVolume.toFixed(3)}
            </p>
            <p className="mt-0.5 text-[6px] font-normal uppercase text-black">
              m³
            </p>
          </div>
        </div>

        {/* Nilai Pengiriman — fixed 24px. Untuk B2B, No. Invoice ditampilkan
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

        {/* Warehouse — fixed 34px. Origin + destination warehouse with
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

        {/* Footer — flex-1, absorbs whatever height is left so the
            sheet always totals exactly 100mm. Includes handling
            instructions, signature lines, print timestamp, and the
            account name + role of the staff who triggered the print. */}
        <footer className="flex min-h-0 flex-1 flex-col justify-between gap-1 overflow-hidden px-3 py-2 text-[8px] leading-tight text-black">
          <div className="flex-1 min-h-0">
            <p className="tracking-widest">
              Dicetak: {new Date().toLocaleString("id-ID")}
            </p>
            {printByLabel && (
              <p className="mt-0.5 truncate tracking-wide">
                <span className="font-bold uppercase tracking-[0.08em]">Dicetak oleh:</span>{" "}
                {printByLabel}
              </p>
            )}
          </div>
        </footer>
      </section>

      {/* ============================================================
          PACKAGE LABELS — 100mm × 100mm
          Same fixed-height-per-section approach as the master resi.
          QR is bumped to 70×70 too — package labels get scanned more
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
            {/* Header — fixed 36px. Same 2px bottom border as the master
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

            {/* Package Code + QR — fixed 86px. Larger QR (70px) for
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

            {/* Route band — fixed 24px. Compact route strip so the
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

            {/* Pengirim — fixed 50px. Sender gets its own block (not
                squeezed into a 2-column row) so the destination
                handler can verify the shipper without ambiguity. */}
            <div className="h-12.5 flex-none border-b border-black px-3">
              <div className="flex h-full flex-col justify-center gap-0.5 overflow-hidden leading-none">
                <SmallCaps>Pengirim</SmallCaps>
                <p className="truncate text-[10px] font-extrabold leading-tight">
                  {pengirim.name}
                </p>
                <p className="truncate text-[8px] font-semibold text-black">
                  Telp: {pengirim.phone}
                </p>
                {pengirim.address && (
                  <p className="line-clamp-1 text-[7px] font-normal text-black">
                    {pengirim.address}
                  </p>
                )}
              </div>
            </div>

            {/* Penerima — fixed 50px. Same treatment as pengirim. */}
            <div className="h-12.5 flex-none border-b border-black px-3">
              <div className="flex h-full flex-col justify-center gap-0.5 overflow-hidden leading-none">
                <SmallCaps>Penerima</SmallCaps>
                <p className="truncate text-[10px] font-extrabold leading-tight">
                  {penerima.name}
                </p>
                <p className="truncate text-[8px] font-semibold text-black">
                  Telp: {penerima.contact}
                </p>
                <p className="line-clamp-1 text-[7px] font-normal text-black">
                  {penerima.address}
                </p>
              </div>
            </div>

            {/* Package Stats — fixed 40px. 4 cells: weight, volume,
                dimension, colly counter. */}
            <div className="h-10 flex-none grid grid-cols-4 border-b border-black">
              <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
                <SmallCaps>Berat</SmallCaps>
                <p className="mt-1 text-[11px] font-extrabold leading-none">
                  {formatNumber(actual)}
                </p>
                <p className="mt-0.5 text-[6px] font-normal uppercase text-black">
                  kg
                </p>
              </div>

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
                    : "—"}
                </p>
                <p className="mt-0.5 text-[6px] font-normal uppercase text-black">
                  cm
                </p>
              </div>

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

            {/* Description — flex-1, fills the remaining space so the
                sheet always totals exactly 100mm. Dashed rule on top
                is solid black (not gray) so it reproduces on thermal
                paper. Includes a "scan at operation point" reminder. */}
            <footer className="flex min-h-0 flex-1 flex-col justify-between gap-1 overflow-hidden border-t border-dashed border-black px-3 py-2 text-[7px] leading-tight text-black">
              <div className="flex-1 min-h-0">
                <SmallCaps>Isi / Keterangan</SmallCaps>
                <p className="mt-1 line-clamp-2 text-[8px] font-semibold leading-tight">
                  {d.description || "—"}
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
          Tailwind so screen preview and print always agree — there is
          no separate "print-only" size rule left to drift out of sync.

          Thermal-printer compatibility:
          - All colors forced to pure black/white via filter:
            grayscale(1) contrast(100) — eliminates any anti-aliased
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
              Pratinjau Cetak Resi — {resiNumber}
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
