"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Printer, X } from "lucide-react";
import { COMPANY_NAME } from "@/lib/company";
import { apiGet, type DetailShipment, type Customer, type Options, type Shipment, type ShipmentTotals } from "@/lib/client-api";
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
  return Math.round((((d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0)) / 1_000_000) * 1e6) / 1e6;
}

/**
 * Full-screen print preview overlay (portal → direct body child) rendering:
 *  1. RESI SHIPMENT — one sheet given to the customer: resi number + QR +
 *     code below, Penerima, Berat, Volume, Detail (package count)
 *  2. RESI DETAIL — one sticker per package: QR + code below, Penerima,
 *     individual Berat & Volume, pcs 001/004, Pengirim + phone
 * Company name is printed at the top of BOTH resi types; the gudang customer
 * support contact is printed on both as well.
 * In print mode every other body child is hidden (see globals.css).
 */
export function ResiPrint({ shipment, onClose }: ResiPrintProps) {
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Options | null>(null);

  useEffect(() => {
    apiGet<Options>("/options")
      .then(setOptions)
      .catch(() => undefined);
  }, []);

  // Render QR codes for the master resi + every detail package
  useEffect(() => {
    if (!shipment) return;
    let cancelled = false;
    const codes = [shipment.resi ?? shipment.masterCode, ...shipment.details.map((d) => d.detailCode)];
    Promise.all(
      codes.map(async (code) => {
        const url = await QRCode.toDataURL(code, { margin: 1, width: 220, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
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
    warehouses.find((w) => (w.city ?? "").toLowerCase() === shipment.origin.toLowerCase()) ?? null;
  const destGudang =
    warehouses.find((w) => w.id === shipment.destinationWarehouseId) ??
    warehouses.find((w) => (w.city ?? "").toLowerCase() === shipment.destination.toLowerCase()) ?? null;

  const resiNumber = shipment.resi ?? shipment.masterCode;
  const totalPackages = shipment.details.length;
  const totalVolume = shipment.totals?.totalVolumeM3 ?? 0;
  const beratTotal = shipment.chargeableWeightKg ?? shipment.totals?.totalActualKg ?? 0;
  const penerima = {
    name: shipment.penerimaName ?? "—",
    address: shipment.penerimaAddress ?? "—",
    contact: shipment.penerimaContact ?? "—",
  };
  const pengirim = {
    name: shipment.customer?.name ?? "—",
    phone: shipment.customer?.phone ?? "—",
  };

  const sheets = (
    <>
      {/* ============ RESI SHIPMENT (given to the customer) ============ */}
      <div className="resi-sheet mx-auto w-full max-w-[480px] bg-white p-5 text-black">
        <div className="text-center">
          <p className="text-lg font-extrabold uppercase tracking-[0.18em]">{company}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.3em] text-neutral-600">Resi Shipment</p>
        </div>
        <div className="my-3 border-t-2 border-dashed border-neutral-400" />

        <div className="flex flex-col items-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">No. Resi Shipment</p>
          <p className="mt-0.5 font-mono text-xl font-bold tracking-widest">{resiNumber}</p>
          <img src={qrMap[resiNumber]} alt="" className="mt-2 h-28 w-28" />
          <p className="mt-1 font-mono text-xs font-semibold tracking-[0.25em]">{resiNumber}</p>
        </div>

        <div className="my-3 border-t-2 border-dashed border-neutral-400" />

        <dl className="space-y-1.5 text-[13px] leading-snug">
          <div className="grid grid-cols-[92px_1fr]">
            <dt className="font-bold uppercase text-neutral-700">Penerima</dt>
            <dd>
              <p className="font-semibold">{penerima.name}</p>
              <p className="text-[11px] text-neutral-700">{penerima.address}</p>
              <p className="text-[11px] text-neutral-700">{penerima.contact}</p>
            </dd>
          </div>
          <div className="grid grid-cols-[92px_1fr]">
            <dt className="font-bold uppercase text-neutral-700">Pengirim</dt>
            <dd>
              {pengirim.name} · <span className="text-neutral-700">{pengirim.phone}</span>
            </dd>
          </div>
          <div className="grid grid-cols-[92px_1fr]">
            <dt className="font-bold uppercase text-neutral-700">Rute</dt>
            <dd>
              {shipment.origin} → {shipment.destination}
            </dd>
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-neutral-300 pt-2 text-center">
            <div>
              <p className="text-[10px] font-bold uppercase text-neutral-600">Berat</p>
              <p className="text-base font-bold">{formatNumber(beratTotal)} kg</p>
              <p className="text-[9px] text-neutral-600">chargeable</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-neutral-600">Volume</p>
              <p className="text-base font-bold">{totalVolume.toFixed(3)} m³</p>
              <p className="text-[9px] text-neutral-600">{formatNumber(shipment.totals?.totalActualKg ?? 0)} kg aktual</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-neutral-600">Detail</p>
              <p className="text-base font-bold">{totalPackages} paket</p>
              <p className="text-[9px] text-neutral-600">resi detail</p>
            </div>
          </div>
          {shipment.priceAmount != null && (
            <div className="grid grid-cols-[92px_1fr] border-t border-neutral-300 pt-1.5">
              <dt className="font-bold uppercase text-neutral-700">Harga</dt>
              <dd className="font-bold">{formatRupiah(shipment.priceAmount)}</dd>
            </div>
          )}
        </dl>

        <div className="my-3 border-t-2 border-dashed border-neutral-400" />
        <div className="space-y-0.5 text-[10px] text-neutral-700">
          <p className="font-bold uppercase tracking-wider text-neutral-600">Customer Support</p>
          <p>Gudang Asal ({originGudang?.name ?? shipment.origin}): {originGudang?.customerSupportContact ?? "—"}</p>
          <p>Gudang Tujuan ({destGudang?.name ?? shipment.destination}): {destGudang?.customerSupportContact ?? "—"}</p>
        </div>
      </div>

      {/* ============ RESI DETAIL (one sticker per package) ============ */}
      {shipment.details.map((d, i) => {
        const pcs = `${String(i + 1).padStart(3, "0")}/${String(totalPackages).padStart(3, "0")}`;
        return (
          <div key={d.id} className="resi-sheet mx-auto w-full max-w-[420px] bg-white p-5 text-black">
            <div className="text-center">
              <p className="text-base font-extrabold uppercase tracking-[0.18em]">{company}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.3em] text-neutral-600">Resi Detail</p>
            </div>
            <div className="my-2.5 border-t-2 border-dashed border-neutral-400" />

            <div className="flex gap-4">
              <div className="flex w-[128px] shrink-0 flex-col items-center">
                <img src={qrMap[d.detailCode]} alt="" className="h-28 w-28" />
                <p className="mt-1 font-mono text-[11px] font-bold tracking-[0.2em]">{d.detailCode}</p>
              </div>
              <div className="min-w-0 flex-1 space-y-1 text-[12px] leading-snug">
                <div>
                  <p className="text-[9px] font-bold uppercase text-neutral-600">Penerima</p>
                  <p className="font-semibold leading-tight">{penerima.name}</p>
                  <p className="text-[10px] leading-tight text-neutral-700">{penerima.contact}</p>
                  <p className="text-[10px] leading-tight text-neutral-700">{penerima.address}</p>
                </div>
                <div className="flex gap-3 pt-1">
                  <div>
                    <p className="text-[9px] font-bold uppercase text-neutral-600">Berat</p>
                    <p className="text-sm font-bold leading-none">{formatNumber(d.actualWeightKg)} kg</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase text-neutral-600">Volume</p>
                    <p className="text-sm font-bold leading-none">{volumeOf(d).toFixed(3)} m³</p>
                  </div>
                </div>
                {d.lengthCm != null && (
                  <p className="text-[10px] text-neutral-700">
                    {formatNumber(d.lengthCm, 0)}×{formatNumber(d.widthCm ?? 0, 0)}×{formatNumber(d.heightCm ?? 0, 0)} cm
                  </p>
                )}
              </div>
            </div>

            <div className="my-2.5 border-t-2 border-dashed border-neutral-400" />

            <div className="flex items-end justify-between text-[11px]">
              <div>
                <p className="text-[9px] font-bold uppercase text-neutral-600">Pengirim</p>
                <p className="font-semibold leading-tight">{pengirim.name}</p>
                <p className="leading-tight text-neutral-700">{pengirim.phone}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase text-neutral-600">Pcs</p>
                <p className="font-mono text-lg font-extrabold leading-none tracking-widest">{pcs}</p>
              </div>
            </div>
            <p className="mt-2 text-[9px] text-neutral-600">
              No. Resi {resiNumber} · {d.description}
              {destGudang?.customerSupportContact ? ` · CS Tujuan: ${destGudang.customerSupportContact}` : ""}
            </p>
          </div>
        );
      })}
    </>
  );

  return createPortal(
    <div id="resi-print-portal" className="fixed inset-0 z-[80] overflow-y-auto bg-neutral-200 dark:bg-neutral-900">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white px-4 py-3 shadow-sm dark:bg-neutral-800">
        <div>
          <p className="text-sm font-bold text-foreground">Pratinjau Cetak Resi — {resiNumber}</p>
          <p className="text-xs text-muted-foreground">
            1 Resi Shipment (untuk customer) + {totalPackages} Resi Detail (tempel di tiap paket)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4" /> Tutup
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Cetak / Simpan PDF
          </Button>
        </div>
      </div>
      <div className="space-y-4 px-2 py-4 print:p-0">{sheets}</div>
    </div>,
    document.body,
  );
}
