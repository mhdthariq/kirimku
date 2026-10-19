import type { TransportDetail, TransportDropsBoard } from "@/infrastructure/http/client-api";
import { formatNumber, formatDate } from "@/components/app/form-parts";
import { cn } from "@/shared/utils";
export function TransportManifestTemplate({ transport, transportMode, displayCompanyName, printedBy, printedAt, ready }: { transport: TransportDetail | null; transportMode: TransportDropsBoard["transportMode"] | null; displayCompanyName: string; printedBy: string | null; printedAt: Date; ready: boolean }) {
    const cap = transport?.capacity;
    const capRows = cap
        ? [
              {
                  label: "Berat",
                  current: cap.weight.current,
                  max: cap.weight.maximum,
                  unit: "KG",
                  digits: 1,
                  state: cap.weight.status,
              },
              {
                  label: "Volume",
                  current: cap.volume.current,
                  max: cap.volume.maximum,
                  unit: "M³",
                  digits: 2,
                  state: cap.volume.status,
              },
              {
                  label: "Koli",
                  current: cap.koli.current,
                  max: cap.koli.maximum,
                  unit: "koli",
                  digits: 0,
                  state: cap.koli.status,
              },
          ]
        : [];

    const overallLabel =
        cap?.overallStatus === "OK"
            ? "AMAN"
            : cap?.overallStatus === "OVERLIMIT"
              ? "OVER KAPASITAS"
              : cap?.overallStatus === "PARTIALLY_CONFIGURED"
                ? "SEBAGIAN TERKONFIGURASI"
                : "BELUM DIKONFIGURASI";

    return (
                    <div className="a4-sheet manifest-sheet mx-auto rounded-xl bg-white text-black shadow-xl print:rounded-none print:shadow-none">
                        {!transport ? (
                            <p className="py-20 text-center text-gray-500">
                                {ready
                                    ? "Transport tidak ditemukan."
                                    : "Memuat…"}
                            </p>
                        ) : (
                            <div data-paper-flow className="manifest-flow space-y-5 text-[12px]">
                                {/* Header */}
                                <div className="flex items-start justify-between border-b border-gray-300 pb-3">
                                    <div>
                                        <p className="text-[18px] font-bold">
                                            {displayCompanyName}
                                        </p>
                                        <p className="text-[11px] text-gray-600">
                                            Manifest Transport / Surat Jalan
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-mono text-[14px] font-bold">
                                            {transport.transportCode}
                                        </p>
                                        <p className="text-[10px] text-gray-600">
                                            Dicetak:{" "}
                                            {formatDate(printedAt, true)}
                                        </p>
                                        {printedBy && (
                                            <p className="text-[10px] text-gray-600">
                                                Oleh: {printedBy}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Transport info grid */}
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                                    <Info
                                        label="Kendaraan"
                                        value={`${transport.vehicle.vehicleNumber}${transport.vehicle.name ? ` — ${transport.vehicle.name}` : ""}`}
                                    />
                                    <Info
                                        label="Status"
                                        value={transport.status}
                                    />
                                    <Info
                                        label="Rute"
                                        value={transport.routeName ?? "-"}
                                    />
                                    <Info
                                        label="Mode"
                                        value={transportMode ?? "—"}
                                    />
                                    <Info
                                        label="Koridor"
                                        value={`${transport.origin ?? "?"} → ${transport.destination ?? "?"}`}
                                    />
                                    <Info
                                        label="Driver"
                                        value={transport.driver?.name ?? "-"}
                                    />
                                    <Info
                                        label="Rencana Berangkat"
                                        value={
                                            transport.plannedDepartureAt
                                                ? formatDate(
                                                      transport.plannedDepartureAt,
                                                      true,
                                                  )
                                                : "-"
                                        }
                                    />
                                    <Info
                                        label="Rencana Tiba"
                                        value={
                                            transport.plannedArrivalAt
                                                ? formatDate(
                                                      transport.plannedArrivalAt,
                                                      true,
                                                  )
                                                : "-"
                                        }
                                    />
                                    {transport.kenek && (
                                        <Info
                                            label="Kenek"
                                            value={transport.kenek.name}
                                        />
                                    )}
                                </div>

                                {/* Capacity summary */}
                                {cap && (
                                    <div className="rounded-lg border border-gray-300 p-3">
                                        <div className="mb-2 flex items-center justify-between">
                                            <p className="text-[11px] font-bold uppercase tracking-wide">
                                                Kapasitas Kendaraan
                                            </p>
                                            <span
                                                className={cn(
                                                    "rounded px-2 py-0.5 text-[10px] font-bold",
                                                    cap.overallStatus === "OK"
                                                        ? "bg-emerald-100 text-emerald-800"
                                                        : cap.overallStatus ===
                                                            "OVERLIMIT"
                                                          ? "bg-rose-100 text-rose-800"
                                                          : "bg-amber-100 text-amber-800",
                                                )}
                                            >
                                                {overallLabel}
                                            </span>
                                        </div>
                                        <table className="w-full text-[11px]">
                                            <thead>
                                                <tr className="border-b border-gray-200 text-left text-[9px] uppercase text-gray-500">
                                                    <th className="py-1">
                                                        Dimensi
                                                    </th>
                                                    <th className="py-1 text-right">
                                                        Muatan
                                                    </th>
                                                    <th className="py-1 text-right">
                                                        Kapasitas
                                                    </th>
                                                    <th className="py-1 text-right">
                                                        Utilisasi
                                                    </th>
                                                    <th className="py-1 text-right">
                                                        Status
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {capRows.map((r) => (
                                                    <tr
                                                        key={r.label}
                                                        className="border-b border-gray-100"
                                                    >
                                                        <td className="py-1 font-medium">
                                                            {r.label}
                                                        </td>
                                                        <td className="py-1 text-right font-mono">
                                                            {formatNumber(
                                                                r.current,
                                                                r.digits,
                                                            )}{" "}
                                                            {r.unit}
                                                        </td>
                                                        <td className="py-1 text-right font-mono">
                                                            {r.max != null
                                                                ? `${formatNumber(r.max, r.digits)} ${r.unit}`
                                                                : "—"}
                                                        </td>
                                                        <td className="py-1 text-right font-mono">
                                                            {cap[
                                                                r.label.toLowerCase() ===
                                                                "berat"
                                                                    ? "weight"
                                                                    : r.label.toLowerCase() ===
                                                                        "volume"
                                                                      ? "volume"
                                                                      : "koli"
                                                            ]
                                                                .utilizationPercent !=
                                                            null
                                                                ? `${formatNumber(cap[r.label.toLowerCase() === "berat" ? "weight" : r.label.toLowerCase() === "volume" ? "volume" : "koli"].utilizationPercent, 1)}%`
                                                                : "—"}
                                                        </td>
                                                        <td className="py-1 text-right font-semibold">
                                                            {r.state}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <p className="mt-2 text-[9px] italic text-gray-500">
                                            Status kapasitas bersifat informatif
                                            — tidak memblokir operasi. Berat
                                            aktual (bukan chargeable).
                                        </p>
                                    </div>
                                )}

                                {/* Shipment list */}
                                <div>
                                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide">
                                        Daftar Shipment (
                                        {transport.shipmentCount})
                                    </p>
                                    <table className="w-full border-collapse text-[10px]">
                                        <thead>
                                            <tr className="border-b-2 border-gray-400 bg-gray-100 text-left text-[9px] uppercase">
                                                <th className="border border-gray-300 px-1.5 py-1">
                                                    #
                                                </th>
                                                <th className="border border-gray-300 px-1.5 py-1">
                                                    Master Resi
                                                </th>
                                                <th className="border border-gray-300 px-1.5 py-1">
                                                    Customer / Penerima
                                                </th>
                                                <th className="border border-gray-300 px-1.5 py-1">
                                                    Tujuan
                                                </th>
                                                <th className="border border-gray-300 px-1.5 py-1 text-right">
                                                    Koli
                                                </th>
                                                <th className="border border-gray-300 px-1.5 py-1 text-right">
                                                    Berat (KG)
                                                </th>
                                                <th className="border border-gray-300 px-1.5 py-1 text-right">
                                                    Volume (M³)
                                                </th>
                                                <th className="border border-gray-300 px-1.5 py-1">
                                                    Tanda Terima
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {transport.shipments.map((s, i) => (
                                                <tr
                                                    key={s.id}
                                                    className="border-b border-gray-200"
                                                >
                                                    <td className="border border-gray-300 px-1.5 py-1 text-center">
                                                        {i + 1}
                                                    </td>
                                                    <td className="border border-gray-300 px-1.5 py-1 font-mono font-semibold">
                                                        {s.masterCode}
                                                    </td>
                                                    <td className="border border-gray-300 px-1.5 py-1">
                                                        {s.customerName ?? "-"}
                                                        {s.penerimaName
                                                            ? ` → ${s.penerimaName}`
                                                            : ""}
                                                    </td>
                                                    <td className="border border-gray-300 px-1.5 py-1">
                                                        {s.destination}
                                                    </td>
                                                    <td className="border border-gray-300 px-1.5 py-1 text-right font-mono">
                                                        {formatNumber(
                                                            s.packages,
                                                            0,
                                                        )}
                                                    </td>
                                                    <td className="border border-gray-300 px-1.5 py-1 text-right font-mono">
                                                        {formatNumber(
                                                            s.weightKg,
                                                            1,
                                                        )}
                                                    </td>
                                                    <td className="border border-gray-300 px-1.5 py-1 text-right font-mono">
                                                        {formatNumber(
                                                            s.volumeM3,
                                                            3,
                                                        )}
                                                    </td>
                                                    <td
                                                        className="border border-gray-300 px-1.5 py-1"
                                                        style={{
                                                            height: 80,
                                                            width: 96,
                                                        }}
                                                    />
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr className="bg-gray-100 font-bold">
                                                <td
                                                    className="border border-gray-300 px-1.5 py-1"
                                                    colSpan={4}
                                                >
                                                    TOTAL (
                                                    {transport.shipmentCount}{" "}
                                                    shipment)
                                                </td>
                                                <td className="border border-gray-300 px-1.5 py-1 text-right font-mono">
                                                    {formatNumber(
                                                        transport.shipments.reduce(
                                                            (a, s) =>
                                                                a + s.packages,
                                                            0,
                                                        ),
                                                        0,
                                                    )}
                                                </td>
                                                <td className="border border-gray-300 px-1.5 py-1 text-right font-mono">
                                                    {formatNumber(
                                                        transport.totalWeightKg,
                                                        1,
                                                    )}
                                                </td>
                                                <td className="border border-gray-300 px-1.5 py-1 text-right font-mono">
                                                    {formatNumber(
                                                        transport.totalVolumeM3,
                                                        3,
                                                    )}
                                                </td>
                                                <td className="border border-gray-300 px-1.5 py-1" />
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                {/* Signatures */}
                                <div className="mt-6 grid break-inside-avoid grid-cols-3 gap-6 pt-20 text-center text-[10px]">
                                    <div>
                                        <div className="border-t border-gray-500 pt-1">
                                            Driver
                                        </div>
                                        <p className="text-[9px] text-gray-500">
                                            {transport.driver?.name ?? "-"}
                                        </p>
                                    </div>
                                    <div>
                                        <div className="border-t border-gray-500 pt-1">
                                            Kenek
                                        </div>
                                        <p className="text-[9px] text-gray-500">
                                            {transport.kenek?.name ?? "-"}
                                        </p>
                                    </div>
                                    <div>
                                        <div className="border-t border-gray-500 pt-1">
                                            Petugas Gudang
                                        </div>
                                    </div>
                                </div>
                                <footer className="manifest-print-footer pt-3 text-center text-[8px] text-gray-400">Dokumen ini dicetak dari sistem {displayCompanyName} — manifest transport {transport.transportCode}.</footer>
                            </div>
                        )}
                    </div>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex gap-2">
            <span className="w-32 shrink-0 text-[9px] font-semibold uppercase text-gray-500">
                {label}
            </span>
            <span className="font-medium">{value}</span>
        </div>
    );
}
