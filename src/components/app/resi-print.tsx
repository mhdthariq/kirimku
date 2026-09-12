"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
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
}

function volumeOf(d: DetailShipment): number {
  return (
    Math.round(
      (((d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0)) / 1_000_000) * 1e6,
    ) / 1e6
  );
}

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    JsBarcode(ref.current, value, {
      format: "CODE128",
      width: 1.8,
      height: 42,
      margin: 0,
      displayValue: false,
      lineColor: "#000000",
      background: "#ffffff",
    });
  }, [value]);

  return (
    <svg
      ref={ref}
      className="h-11 w-full"
      role="img"
      aria-label={`Barcode ${value}`}
    />
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-[7px] font-bold uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </p>
      <div className="mt-1 text-[10px] font-semibold leading-tight text-neutral-950">
        {children}
      </div>
    </div>
  );
}

function SmallCaps({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[7px] font-bold uppercase tracking-[0.12em] text-neutral-500">
      {children}
    </span>
  );
}

/**
 * Print preview for:
 *  1. MASTER RESI / shipment receipt: customer-facing transport document.
 *  2. PACKAGE LABEL: one physical label per package.
 *
 * The visual design intentionally follows a practical courier/warehouse label:
 * strong scan targets, large destination + resi code, ruled sections, minimal
 * decorative UI, and information density suitable for thermal printing.
 */
export function ResiPrint({ shipment, onClose }: ResiPrintProps) {
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
    ];

    Promise.all(
      codes.map(async (code) => {
        const url = await QRCode.toDataURL(code, {
          margin: 1,
          width: 240,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        });
        return [code, url] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) setQrMap(Object.fromEntries(entries));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [shipment]);

  if (!shipment || typeof document === "undefined") return null;

  const company = options?.company?.name ?? COMPANY_NAME;
  const warehouses = options?.warehouses ?? [];

  const originGudang =
    warehouses.find((w) => w.id === shipment.originWarehouseId) ??
    warehouses.find(
      (w) => (w.city ?? "").toLowerCase() === shipment.origin.toLowerCase(),
    ) ??
    null;

  const destGudang =
    warehouses.find((w) => w.id === shipment.destinationWarehouseId) ??
    warehouses.find(
      (w) => (w.city ?? "").toLowerCase() === shipment.destination.toLowerCase(),
    ) ??
    null;

  const resiNumber = shipment.resi ?? shipment.masterCode;
  const totalPackages = shipment.details.length;
  const totalVolume = shipment.totals?.totalVolumeM3 ?? 0;
  const actualWeight = shipment.totals?.totalActualKg ?? 0;
  const chargeableWeight = shipment.chargeableWeightKg ?? actualWeight;

  const penerima = {
    name: shipment.penerimaName ?? "—",
    address: shipment.penerimaAddress ?? "—",
    contact: shipment.penerimaContact ?? "—",
  };

  const pengirim = {
    name: shipment.customer?.name ?? "—",
    phone: shipment.customer?.phone ?? "—",
  };

  const originName = shipment.origin;
  const destinationName = shipment.destination;
  const originSupport = originGudang?.customerSupportContact ?? "—";
  const destinationSupport = destGudang?.customerSupportContact ?? "—";

  const sheets = (
    <>
      {/* ==================== MASTER / CUSTOMER RESI ==================== */}
      <section className="resi-sheet thermal-sheet mx-auto overflow-hidden bg-white text-black">
        <header className="border-b-[2px] border-black px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-extrabold uppercase leading-none tracking-[0.08em]">
                {company}
              </p>
              <p className="mt-1 text-[7px] font-semibold uppercase tracking-[0.18em] text-neutral-600">
                Surat Pengiriman / Shipment Receipt
              </p>
            </div>
            <div className="shrink-0 border border-black px-2 py-1 text-right">
              <SmallCaps>Jenis</SmallCaps>
              <p className="mt-0.5 text-[10px] font-extrabold uppercase">MASTER RESI</p>
            </div>
          </div>
        </header>

        <div className="border-b border-black">
          <div className="grid grid-cols-[1fr_92px]">
            <div className="border-r border-black px-4 py-3">
              <SmallCaps>Nomor Resi</SmallCaps>
              <p className="mt-1 break-all font-mono text-[21px] font-extrabold leading-none tracking-[0.04em]">
                {resiNumber}
              </p>
              <div className="mt-3">
                <Barcode value={resiNumber} />
                <p className="mt-1 text-center font-mono text-[8px] font-bold tracking-[0.18em]">
                  {resiNumber}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-center p-3">
              {qrMap[resiNumber] ? (
                <img
                  src={qrMap[resiNumber]}
                  alt="QR code resi shipment"
                  className="h-[78px] w-[78px]"
                />
              ) : (
                <div className="h-[78px] w-[78px] border border-dashed border-neutral-400" />
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 border-b-[2px] border-black bg-neutral-50">
          <div className="border-r border-black px-4 py-3.5">
            <p className="text-[8px] font-extrabold uppercase tracking-[0.14em] text-neutral-500">Pengirim</p>
            <p className="mt-1 text-[14px] font-extrabold leading-tight">{pengirim.name}</p>
            <p className="mt-2 text-[7px] font-bold uppercase tracking-[0.1em] text-neutral-500">Kontak</p>
            <p className="mt-0.5 text-[10px] font-semibold leading-tight text-neutral-800">{pengirim.phone}</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-[8px] font-extrabold uppercase tracking-[0.14em] text-neutral-500">Penerima</p>
            <p className="mt-1 text-[14px] font-extrabold leading-tight">{penerima.name}</p>
            <p className="mt-2 text-[7px] font-bold uppercase tracking-[0.1em] text-neutral-500">Kontak</p>
            <p className="mt-0.5 text-[10px] font-semibold leading-tight text-neutral-800">{penerima.contact}</p>
            <p className="mt-2 text-[7px] font-bold uppercase tracking-[0.1em] text-neutral-500">Alamat</p>
            <p className="mt-0.5 text-[9px] leading-tight text-neutral-800">{penerima.address}</p>
          </div>
        </div>

        <div className="border-b border-black px-4 py-3">
          <div className="grid grid-cols-[1fr_28px_1fr] items-center gap-2">
            <div>
              <SmallCaps>Asal</SmallCaps>
              <p className="mt-1 text-[12px] font-extrabold uppercase leading-tight">{originName}</p>
            </div>
            <div className="text-center text-[18px] font-black">→</div>
            <div className="text-right">
              <SmallCaps>Tujuan</SmallCaps>
              <p className="mt-1 text-[12px] font-extrabold uppercase leading-tight">{destinationName}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 border-b border-black">
          <div className="border-r border-black px-3 py-2.5 text-center">
            <SmallCaps>Jumlah</SmallCaps>
            <p className="mt-1 text-[15px] font-extrabold leading-none">{totalPackages}</p>
            <p className="mt-1 text-[7px] uppercase text-neutral-500">Pcs</p>
          </div>
          <div className="border-r border-black px-3 py-2.5 text-center">
            <SmallCaps>Aktual</SmallCaps>
            <p className="mt-1 text-[15px] font-extrabold leading-none">{formatNumber(actualWeight)}</p>
            <p className="mt-1 text-[7px] uppercase text-neutral-500">Kg</p>
          </div>
          <div className="border-r border-black px-3 py-2.5 text-center">
            <SmallCaps>Chargeable</SmallCaps>
            <p className="mt-1 text-[15px] font-extrabold leading-none">{formatNumber(chargeableWeight)}</p>
            <p className="mt-1 text-[7px] uppercase text-neutral-500">Kg</p>
          </div>
          <div className="px-3 py-2.5 text-center">
            <SmallCaps>Volume</SmallCaps>
            <p className="mt-1 text-[15px] font-extrabold leading-none">{totalVolume.toFixed(3)}</p>
            <p className="mt-1 text-[7px] uppercase text-neutral-500">M³</p>
          </div>
        </div>

        {shipment.priceAmount != null && (
          <div className="flex items-center justify-between border-b border-black px-4 py-2.5">
            <div>
              <SmallCaps>Nilai Pengiriman</SmallCaps>
              <p className="mt-0.5 text-[8px] text-neutral-600">Tarif berdasarkan data transaksi</p>
            </div>
            <p className="text-[14px] font-extrabold">{formatRupiah(shipment.priceAmount)}</p>
          </div>
        )}

        {shipment.insuranceAmount > 0 && (
          <div className="flex items-center justify-between border-b border-black px-4 py-2.5">
            <SmallCaps>Asuransi</SmallCaps>
            <p className="text-[12px] font-extrabold">{formatRupiah(shipment.insuranceAmount)}</p>
          </div>
        )}

        <div className="grid grid-cols-2 border-b border-black">
          <Field label="Gudang asal / CS" className="border-r border-black px-4 py-2.5">
            <p>{originName}</p>
            <p className="mt-0.5 text-[9px] font-normal text-neutral-700">{originSupport}</p>
          </Field>
          <Field label="Gudang tujuan / CS" className="px-4 py-2.5">
            <p>{destinationName}</p>
            <p className="mt-0.5 text-[9px] font-normal text-neutral-700">{destinationSupport}</p>
          </Field>
        </div>

        <footer className="px-4 py-2.5 text-[7px] leading-tight text-neutral-600">
          <p className="font-bold uppercase tracking-[0.12em] text-neutral-700">Catatan</p>
          <p className="mt-1">
            Simpan resi ini untuk pengecekan status dan pencocokan paket. Scan QR/barcode dilakukan pada proses operasional gudang, pickup, transit, dan delivery.
          </p>
        </footer>
      </section>

      {/* ==================== PACKAGE LABEL ==================== */}
      {shipment.details.map((d, i) => {
        const pcs = `${String(i + 1).padStart(3, "0")}/${String(totalPackages).padStart(3, "0")}`;
        const volume = volumeOf(d);
        const actual = d.actualWeightKg ?? 0;
        const labelId = d.detailCode;

        return (
          <section
            key={d.id}
            className="resi-sheet thermal-sheet mx-auto overflow-hidden bg-white text-black"
          >
            <header className="border-b-[2px] border-black px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-extrabold uppercase leading-none tracking-[0.06em]">
                    {company}
                  </p>
                  <p className="mt-1 text-[7px] font-semibold uppercase tracking-[0.16em] text-neutral-600">
                    Package / Colly Label
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <SmallCaps>Isi shipment</SmallCaps>
                  <p className="mt-0.5 font-mono text-[11px] font-extrabold">{pcs}</p>
                </div>
              </div>
            </header>

            <div className="grid grid-cols-[1fr_86px] border-b border-black">
              <div className="border-r border-black px-4 py-3">
                <SmallCaps>Kode Paket</SmallCaps>
                <p className="mt-1 break-all font-mono text-[19px] font-extrabold leading-none tracking-[0.03em]">
                  {labelId}
                </p>
                <p className="mt-1 text-[7px] uppercase tracking-[0.1em] text-neutral-500">No. Master</p>
                <p className="mt-0.5 break-all font-mono text-[8px] font-bold">{resiNumber}</p>
              </div>
              <div className="flex items-center justify-center p-2.5">
                {qrMap[labelId] ? (
                  <img
                    src={qrMap[labelId]}
                    alt="QR code paket"
                    className="h-[70px] w-[70px]"
                  />
                ) : (
                  <div className="h-[70px] w-[70px] border border-dashed border-neutral-400" />
                )}
              </div>
            </div>

            <div className="border-b border-black px-4 py-2.5">
              <Barcode value={labelId} />
              <p className="mt-1 text-center font-mono text-[8px] font-bold tracking-[0.16em]">{labelId}</p>
            </div>

            <div className="border-b border-black px-4 py-3">
              <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                <Field label="Penerima">
                  <p className="text-[12px] font-extrabold">{penerima.name}</p>
                  <p className="mt-1 text-[9px] font-normal text-neutral-700">{penerima.contact}</p>
                </Field>
                <Field label="Tujuan">
                  <p className="text-[12px] font-extrabold uppercase">{destinationName}</p>
                </Field>
                <Field label="Alamat">
                  <p className="text-[9px] font-normal leading-snug text-neutral-800">{penerima.address}</p>
                </Field>
                <Field label="Pengirim">
                  <p>{pengirim.name}</p>
                  <p className="mt-0.5 text-[9px] font-normal text-neutral-700">{pengirim.phone}</p>
                </Field>
              </div>
            </div>

            <div className="grid grid-cols-4 border-b border-black">
              <div className="border-r border-black px-2 py-2 text-center">
                <SmallCaps>Berat</SmallCaps>
                <p className="mt-1 text-[14px] font-extrabold leading-none">{formatNumber(actual)}</p>
                <p className="mt-1 text-[7px] uppercase text-neutral-500">Kg</p>
              </div>
              <div className="border-r border-black px-2 py-2 text-center">
                <SmallCaps>Volume</SmallCaps>
                <p className="mt-1 text-[14px] font-extrabold leading-none">{volume.toFixed(3)}</p>
                <p className="mt-1 text-[7px] uppercase text-neutral-500">M³</p>
              </div>
              <div className="border-r border-black px-2 py-2 text-center">
                <SmallCaps>Dimensi</SmallCaps>
                <p className="mt-1 text-[10px] font-extrabold leading-none">
                  {d.lengthCm != null
                    ? `${formatNumber(d.lengthCm, 0)}×${formatNumber(d.widthCm ?? 0, 0)}×${formatNumber(d.heightCm ?? 0, 0)}`
                    : "—"}
                </p>
                <p className="mt-1 text-[7px] uppercase text-neutral-500">Cm</p>
              </div>
              <div className="px-2 py-2 text-center">
                <SmallCaps>Colly</SmallCaps>
                <p className="mt-1 font-mono text-[14px] font-extrabold leading-none">{pcs}</p>
                <p className="mt-1 text-[7px] uppercase text-neutral-500">Paket</p>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
              <div className="min-w-0">
                <SmallCaps>Isi / Keterangan</SmallCaps>
                <p className="mt-1 break-words text-[10px] font-semibold leading-tight">
                  {d.description || "—"}
                </p>
              </div>
              <div className="text-right">
                <SmallCaps>Rute</SmallCaps>
                <p className="mt-1 text-[9px] font-extrabold uppercase">{shipment.origin} → {shipment.destination}</p>
              </div>
            </div>

            <footer className="border-t border-dashed border-neutral-400 px-4 py-2 text-[7px] leading-tight text-neutral-500">
              <div className="flex justify-between gap-3">
                <span>MASTER: {resiNumber}</span>
                <span>PCS {pcs}</span>
                <span>SCAN AT OPERATION POINT</span>
              </div>
            </footer>
          </section>
        );
      })}
    </>
  );

  return createPortal(
    <div
      id="resi-print-portal"
      className="fixed inset-0 z-[80] overflow-y-auto bg-neutral-200 dark:bg-neutral-900"
    >
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-white px-4 py-3 shadow-sm dark:bg-neutral-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">Pratinjau Cetak Resi — {resiNumber}</p>
          <p className="text-xs text-muted-foreground">
            1 Master Resi + {totalPackages} Package Label. Layout dioptimalkan untuk cetak thermal.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
            <X className="h-4 w-4" /> Tutup
          </Button>
          <Button type="button" className="flex-1 sm:flex-none" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Cetak / Simpan PDF
          </Button>
        </div>
      </div>

      <div className="space-y-4 px-2 py-4 print:p-0">{sheets}</div>
    </div>,
    document.body,
  );
}
