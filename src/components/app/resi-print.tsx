"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Printer, X } from "lucide-react";
import { COMPANY_NAME } from "@/lib/company";
import {
  apiGet,
  type DetailShipment,
  type Customer,
  type Options,
  type Shipment,
  type ShipmentTotals,
} from "@/lib/client-api";
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
 * Small uppercase label used above every value. Everything on the sheet
 * is pure black on white — no gray tints — because thermal printers
 * either dither grays into noise or drop them entirely. Hierarchy comes
 * from size, weight and letter-spacing only.
 */
function SmallCaps({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[6px] font-bold uppercase tracking-[0.1em] text-black">
      {children}
    </span>
  );
}

/**
 * Print format:
 * - Exactly 100mm x 100mm per sheet, no more, no less
 * - QR Code only
 * - One master resi per page
 * - One package label per page
 * - Pure black/white only (thermal-safe, no gray tints)
 * - Pengirim (sender) shown on both the master resi AND every package label
 */
export function ResiPrint({
  shipment,
  onClose,
}: ResiPrintProps) {
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Options | null>(null);

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
        const url = await QRCode.toDataURL(code, {
          margin: 1,
          width: 320,
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
  // data when the per-shipment field is empty (covers legacy shipments
  // created before the editable Pengirim feature shipped).
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

  const sheets = (
    <>
      {/* ============================================================
          MASTER RESI
          Every section below has a FIXED pixel height (not a height
          driven by its content). That's the actual fix: at 96 CSS
          px/inch, 100mm ≈ 378px total, and the old version sized each
          block by its natural content height — which meant a longer
          address or an extra optional row (price/insurance) could push
          the total past 378px and get silently clipped by
          overflow-hidden. Long fields now truncate to one line instead
          of wrapping, so a section's height never depends on how long
          the underlying data happens to be. The footer is the only
          flexible piece and simply absorbs whatever is left over.
          Fixed budget used below (both optional rows shown): 30 + 62 +
          48 + 20 + 28 + 16 + 14 + 22 = 240px, leaving ~130px+ for the
          footer inside the ~372px safe budget — comfortable margin
          under the 378px ceiling.
          ============================================================ */}

      <section className="resi-sheet mx-auto flex h-[100mm] w-[100mm] flex-col overflow-hidden bg-white text-black">
        {/* Header — fixed 30px */}
        <header className="flex h-[30px] flex-none items-center justify-between gap-2 border-b-2 border-black px-3">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-extrabold uppercase leading-none tracking-[0.05em]">
              {company}
            </p>

            <p className="mt-0.5 truncate text-[5px] font-semibold uppercase tracking-[0.12em] text-black">
              Surat Pengiriman / Shipment Receipt
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end justify-center border border-black px-1.5 py-0.5">
            <SmallCaps>Jenis</SmallCaps>

            <p className="text-[6.5px] font-extrabold uppercase leading-tight">
              MASTER RESI
            </p>
          </div>
        </header>

        {/* Resi Number + QR — fixed 62px */}
        <div className="h-[62px] flex-none border-b border-black">
          <div className="grid h-full grid-cols-[1fr_62px]">
            <div className="flex min-w-0 flex-col justify-center overflow-hidden border-r border-black px-3">
              <SmallCaps>Nomor Resi</SmallCaps>

              <p className="mt-0.5 truncate font-mono text-[15px] font-extrabold leading-none tracking-[0.02em]">
                {resiNumber}
              </p>

              <p className="mt-1 truncate text-[5px] uppercase tracking-[0.08em] text-black">
                Scan QR untuk identifikasi shipment
              </p>
            </div>

            <div className="flex items-center justify-center p-1.5">
              {qrMap[resiNumber] ? (
                <img
                  src={qrMap[resiNumber]}
                  alt="QR code resi shipment"
                  className="h-[52px] w-[52px]"
                />
              ) : (
                <div className="h-[52px] w-[52px] border border-dashed border-black" />
              )}
            </div>
          </div>
        </div>

        {/* Sender / Receiver — fixed 48px */}
        <div className="h-[48px] flex-none grid grid-cols-2 border-b border-black">
          <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden border-r border-black px-3">
            <SmallCaps>Pengirim</SmallCaps>

            <p className="truncate text-[8px] font-extrabold leading-tight">
              {pengirim.name}
            </p>

            <p className="truncate text-[6px] font-semibold leading-tight text-black">
              Kontak: {pengirim.phone}
            </p>
          </div>

          <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden px-3">
            <SmallCaps>Penerima</SmallCaps>

            <p className="truncate text-[8px] font-extrabold leading-tight">
              {penerima.name}
            </p>

            <p className="truncate text-[6px] font-semibold leading-tight text-black">
              Kontak: {penerima.contact}
            </p>

            <p className="truncate text-[6px] leading-tight text-black">
              Alamat: {penerima.address}
            </p>
          </div>
        </div>

        {/* Route — fixed 20px */}
        <div className="h-[20px] flex-none border-b border-black px-3">
          <div className="grid h-full grid-cols-[1fr_18px_1fr] items-center gap-1">
            <div className="min-w-0 leading-none">
              <span className="text-[5px] font-bold uppercase tracking-[0.1em] text-black">
                Asal:{" "}
              </span>
              <span className="truncate text-[8px] font-extrabold uppercase">
                {originName}
              </span>
            </div>

            <div className="text-center text-[11px] font-black leading-none">
              →
            </div>

            <div className="min-w-0 text-right leading-none">
              <span className="text-[5px] font-bold uppercase tracking-[0.1em] text-black">
                Tujuan:{" "}
              </span>
              <span className="truncate text-[8px] font-extrabold uppercase">
                {destinationName}
              </span>
            </div>
          </div>
        </div>

        {/* Shipment Stats — fixed 28px */}
        <div className="h-[28px] flex-none grid grid-cols-4 border-b border-black">
          <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
            <SmallCaps>Jumlah</SmallCaps>
            <p className="mt-0.5 text-[10px] font-extrabold leading-none">
              {totalPackages}
              <span className="ml-0.5 text-[5px] font-normal uppercase text-black">
                pcs
              </span>
            </p>
          </div>

          <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
            <SmallCaps>Aktual</SmallCaps>
            <p className="mt-0.5 text-[10px] font-extrabold leading-none">
              {formatNumber(actualWeight)}
              <span className="ml-0.5 text-[5px] font-normal uppercase text-black">
                kg
              </span>
            </p>
          </div>

          <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
            <SmallCaps>Chargeable</SmallCaps>
            <p className="mt-0.5 text-[10px] font-extrabold leading-none">
              {formatNumber(chargeableWeight)}
              <span className="ml-0.5 text-[5px] font-normal uppercase text-black">
                kg
              </span>
            </p>
          </div>

          <div className="flex flex-col items-center justify-center text-center leading-none">
            <SmallCaps>Volume</SmallCaps>
            <p className="mt-0.5 text-[10px] font-extrabold leading-none">
              {totalVolume.toFixed(3)}
              <span className="ml-0.5 text-[5px] font-normal uppercase text-black">
                m³
              </span>
            </p>
          </div>
        </div>

        {/* Price — fixed 16px, only rendered when present */}
        {shipment.priceAmount != null && (
          <div className="flex h-[16px] flex-none items-center justify-between border-b border-black px-3">
            <SmallCaps>Nilai Pengiriman</SmallCaps>
            <p className="text-[8px] font-extrabold leading-none">
              {formatRupiah(shipment.priceAmount)}
            </p>
          </div>
        )}

        {/* Insurance — fixed 14px, only rendered when present */}
        {shipment.insuranceAmount > 0 && (
          <div className="flex h-[14px] flex-none items-center justify-between border-b border-black px-3">
            <SmallCaps>Asuransi</SmallCaps>
            <p className="text-[7px] font-extrabold leading-none">
              {formatRupiah(shipment.insuranceAmount)}
            </p>
          </div>
        )}

        {/* Warehouse — fixed 22px */}
        <div className="h-[22px] flex-none grid grid-cols-2 border-b border-black">
          <div className="flex min-w-0 flex-col justify-center overflow-hidden border-r border-black px-3 leading-none">
            <SmallCaps>Gudang asal / CS</SmallCaps>
            <p className="truncate text-[6.5px] font-semibold">
              {originName} · {originSupport}
            </p>
          </div>

          <div className="flex min-w-0 flex-col justify-center overflow-hidden px-3 leading-none">
            <SmallCaps>Gudang tujuan / CS</SmallCaps>
            <p className="truncate text-[6.5px] font-semibold">
              {destinationName} · {destinationSupport}
            </p>
          </div>
        </div>

        {/* Footer — flex-1, absorbs whatever height is left over so the
            sheet always totals exactly 100mm regardless of which
            optional rows above were rendered */}
        <footer className="flex min-h-0 flex-1 flex-col justify-center gap-1 overflow-hidden px-3 py-1 text-[5.5px] leading-tight text-black">
          <div>
            <p className="font-bold uppercase tracking-[0.1em]">
              Catatan
            </p>
            <p className="mt-0.5 line-clamp-2">
              Simpan resi untuk pengecekan status dan pencocokan
              paket. QR digunakan untuk identifikasi shipment pada
              proses operasional.
            </p>
          </div>

          <p className="text-[5px] text-black">
            Dicetak: {new Date().toLocaleString("id-ID")}
          </p>
        </footer>
      </section>

      {/* ============================================================
          PACKAGE LABELS
          Same fixed-height flex approach. Pengirim now sits alongside
          Penerima as its own bordered block, not squeezed into a corner.
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
            {/* Same fixed-height-per-section approach as the master
                resi above: 28 + 58 + 44 + 26 + 28 + 22 = 206px fixed,
                footer takes the rest. Nothing here can push past
                100mm regardless of how long the description or
                address text is. */}

            {/* Header — fixed 28px */}
            <header className="flex h-[28px] flex-none items-center justify-between gap-2 border-b-2 border-black px-3">
              <div className="min-w-0">
                <p className="truncate text-[9px] font-extrabold uppercase leading-none tracking-[0.04em]">
                  {company}
                </p>

                <p className="mt-0.5 truncate text-[5px] font-semibold uppercase tracking-[0.1em] text-black">
                  Package / Colly Label
                </p>
              </div>

              <div className="shrink-0 text-right leading-none">
                <SmallCaps>Isi Shipment</SmallCaps>

                <p className="mt-0.5 font-mono text-[8px] font-extrabold">
                  {pcs}
                </p>
              </div>
            </header>

            {/* Package Code + QR — fixed 58px */}
            <div className="h-[58px] flex-none border-b border-black">
              <div className="grid h-full grid-cols-[1fr_54px]">
                <div className="flex min-w-0 flex-col justify-center overflow-hidden border-r border-black px-3">
                  <SmallCaps>Kode Paket</SmallCaps>

                  <p className="mt-0.5 truncate font-mono text-[12px] font-extrabold leading-none tracking-[0.02em]">
                    {labelId}
                  </p>

                  <p className="mt-1 text-[5px] uppercase tracking-[0.08em] text-black">
                    No. Master
                  </p>

                  <p className="truncate font-mono text-[6px] font-bold">
                    {resiNumber}
                  </p>
                </div>

                <div className="flex items-center justify-center p-1">
                  {qrMap[labelId] ? (
                    <img
                      src={qrMap[labelId]}
                      alt="QR code paket"
                      className="h-[48px] w-[48px]"
                    />
                  ) : (
                    <div className="h-[48px] w-[48px] border border-dashed border-black" />
                  )}
                </div>
              </div>
            </div>

            {/* Pengirim / Penerima — fixed 44px. Side by side, same
                treatment as the master resi, so the sender is never
                lost on the package label */}
            <div className="h-[44px] flex-none grid grid-cols-2 border-b border-black">
              <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden border-r border-black px-3">
                <SmallCaps>Pengirim</SmallCaps>

                <p className="truncate text-[7.5px] font-extrabold leading-tight">
                  {pengirim.name}
                </p>

                <p className="truncate text-[5.5px] font-normal text-black">
                  {pengirim.phone}
                </p>
              </div>

              <div className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden px-3">
                <SmallCaps>Penerima</SmallCaps>

                <p className="truncate text-[7.5px] font-extrabold leading-tight">
                  {penerima.name}
                </p>

                <p className="truncate text-[5.5px] font-normal text-black">
                  {penerima.contact}
                </p>
              </div>
            </div>

            {/* Destination + Address — fixed 26px */}
            <div className="h-[26px] flex-none border-b border-black px-3">
              <div className="grid h-full grid-cols-[1fr_auto] items-center gap-3">
                <div className="min-w-0 overflow-hidden leading-none">
                  <SmallCaps>Alamat Penerima</SmallCaps>
                  <p className="truncate text-[6.5px] font-normal leading-snug">
                    {penerima.address}
                  </p>
                </div>

                <div className="shrink-0 text-right leading-none">
                  <SmallCaps>Tujuan</SmallCaps>
                  <p className="truncate text-[8px] font-extrabold uppercase">
                    {destinationName}
                  </p>
                </div>
              </div>
            </div>

            {/* Package Stats — fixed 28px */}
            <div className="h-[28px] flex-none grid grid-cols-4 border-b border-black">
              <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
                <SmallCaps>Berat</SmallCaps>
                <p className="mt-0.5 text-[9px] font-extrabold leading-none">
                  {formatNumber(actual)}
                  <span className="ml-0.5 text-[5px] font-normal uppercase text-black">
                    kg
                  </span>
                </p>
              </div>

              <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
                <SmallCaps>Volume</SmallCaps>
                <p className="mt-0.5 text-[9px] font-extrabold leading-none">
                  {volume.toFixed(3)}
                  <span className="ml-0.5 text-[5px] font-normal uppercase text-black">
                    m³
                  </span>
                </p>
              </div>

              <div className="flex flex-col items-center justify-center border-r border-black text-center leading-none">
                <SmallCaps>Dimensi</SmallCaps>
                <p className="mt-0.5 text-[6.5px] font-extrabold leading-none">
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
                  <span className="ml-0.5 text-[5px] font-normal uppercase text-black">
                    cm
                  </span>
                </p>
              </div>

              <div className="flex flex-col items-center justify-center text-center leading-none">
                <SmallCaps>Colly</SmallCaps>
                <p className="mt-0.5 font-mono text-[9px] font-extrabold leading-none">
                  {pcs}
                </p>
              </div>
            </div>

            {/* Description — fixed 22px */}
            <div className="h-[22px] flex-none overflow-hidden px-3 py-1 leading-none">
              <SmallCaps>Isi / Keterangan</SmallCaps>
              <p className="truncate text-[6.5px] font-semibold leading-tight">
                {d.description || "—"}
              </p>
            </div>

            {/* Footer — flex-1, absorbs whatever height is left so the
                sheet always totals exactly 100mm. Dashed rule is solid
                black (not gray) so it reproduces on thermal paper. */}
            <footer className="flex min-h-0 flex-1 flex-col justify-end gap-0.5 overflow-hidden border-t border-dashed border-black px-3 py-1 text-[5px] leading-tight text-black">
              <div className="flex justify-between gap-2">
                <span>MASTER: {resiNumber}</span>
                <span>PCS {pcs}</span>
                <span>SCAN AT OPERATION POINT</span>
              </div>
              <p className="text-[4.5px] text-black">
                Dicetak: {new Date().toLocaleString("id-ID")}
              </p>
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
               the browser's own rendering getting sent to the printer */
            filter: grayscale(1) contrast(100);
          }

          .resi-sheet:last-child {
            page-break-after: auto;
            break-after: auto;
          }

          img {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
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
        className="fixed inset-0 z-[80] overflow-y-auto bg-neutral-200 dark:bg-neutral-900"
      >
        {/* Screen toolbar */}
        <div className="print-toolbar sticky top-0 z-10 flex flex-col gap-3 border-b bg-white px-4 py-3 shadow-sm dark:bg-neutral-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">
              Pratinjau Cetak Resi — {resiNumber}
            </p>

            <p className="text-xs text-muted-foreground">
              QR Code only • Ukuran 100 × 100 mm • 1 Master Resi +{" "}
              {totalPackages} Package Label
            </p>
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
              onClick={() => window.print()}
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