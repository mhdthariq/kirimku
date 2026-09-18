"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Box,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  Package,
  PackageCheck,
  Phone,
  Search,
  Truck,
  User,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/components/app/form-parts";
import { cn } from "@/lib/utils";

/**
 * Public tracking page at /tracking-paket.
 *
 * Customers enter their Master Resi number (the `masterCode` printed on the
 * receipt — e.g. MKT-000001) and immediately see:
 *   1. The shipment's current status (with a friendly label)
 *   2. Origin → destination, sender / recipient (phone masked for privacy)
 *   3. The full list of packages tied to that Master Resi (description,
 *      dimensions, weight — but NOT the secret detailCode scan values)
 *   4. The tracking timeline (newest first)
 *
 * No login required — the page talks to the public /api/v1/public/track
 * endpoint. Financial details (price, payment, invoice) are intentionally NOT
 * shown — customers see shipment status + packages only.
 */

interface TrackingPackage {
  id: number;
  description: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  actualWeightKg: number;
}

interface TrackingEventRow {
  id: number;
  event: string;
  description: string | null;
  occurredAt: string;
  actorName: string | null;
}

interface TrackingResponse {
  masterCode: string;
  resi: string | null;
  status: string;
  statusLabel: string;
  origin: string;
  destination: string;
  originWarehouse: { name: string; city: string | null } | null;
  destinationWarehouse: { name: string; city: string | null; customerSupportContact: string | null } | null;
  arrivedWarehouse: { name: string; city: string | null } | null;
  sender: { name: string; phone: string | null };
  recipient: { name: string | null; address: string | null; phone: string | null };
  customerType: "b2b" | "b2c";
  createdAt: string;
  updatedAt: string;
  packages: TrackingPackage[];
  totals: { totalPackages: number; totalActualKg: number; totalVolumeM3: number };
  trackingEvents: TrackingEventRow[];
}

// Visual progress steps — the customer-facing journey has 6 milestones.
// Each status maps to one of these steps so we can render a progress bar.
const PROGRESS_STEPS = [
  { key: "CREATED", label: "Dibuat", icon: ClipboardList },
  { key: "PICKED_UP", label: "Diambil", icon: Package },
  { key: "RECEIVED_AT_GUDANG", label: "Tiba di Gudang Asal", icon: Warehouse },
  { key: "IN_TRANSPORT", label: "Dalam Pengiriman", icon: Truck },
  { key: "ARRIVED_AT_GUDANG", label: "Tiba di Gudang Tujuan", icon: Warehouse },
  { key: "DELIVERED", label: "Terkirim", icon: PackageCheck },
];

function progressIndex(status: string): number {
  const order = ["CREATED", "READY_FOR_PICKUP", "PICKED_UP", "RECEIVED_AT_GUDANG", "IN_TRANSPORT", "AT_DEST_GUDANG", "ARRIVED_AT_GUDANG", "DELIVERED"];
  const idx = order.indexOf(status);
  if (idx < 0) return 0;
  // Map the granular internal statuses onto the 6 customer-facing steps.
  if (status === "READY_FOR_PICKUP") return 0;
  if (status === "AT_DEST_GUDANG") return 4;
  return Math.min(idx, PROGRESS_STEPS.length - 1);
}

function eventIcon(event: string) {
  switch (event) {
    case "CREATED":
      return <ClipboardList className="h-4 w-4" />;
    case "READY_FOR_PICKUP":
      return <Package className="h-4 w-4" />;
    case "PICKED_UP":
      return <Package className="h-4 w-4" />;
    case "RECEIVED_AT_GUDANG":
      return <Warehouse className="h-4 w-4" />;
    case "IN_TRANSPORT":
      return <Truck className="h-4 w-4" />;
    case "AT_DEST_GUDANG":
      return <MapPin className="h-4 w-4" />;
    case "ARRIVED_AT_GUDANG":
      return <Warehouse className="h-4 w-4" />;
    case "DELIVERED":
      return <PackageCheck className="h-4 w-4" />;
    default:
      return <CheckCircle2 className="h-4 w-4" />;
  }
}

export default function TrackingPaketPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const code = query.trim();
    if (!code) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const response = await fetch(`/api/v1/public/track/${encodeURIComponent(code)}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as { data?: TrackingResponse; message?: string } | null;
      if (!response.ok) {
        setError(payload?.message ?? `Resi tidak ditemukan (${response.status}).`);
        return;
      }
      setData(payload?.data ?? null);
    } catch {
      setError("Terjadi kesalahan jaringan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  const progress = data ? progressIndex(data.status) : -1;

  return (
    <main className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <a href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Truck className="h-5 w-5" />
            </span>
            <span className="text-base font-bold tracking-tight">KirimKu</span>
          </a>
          <a
            href="/"
            className="text-xs font-semibold text-primary hover:underline"
          >
            Login Staff →
          </a>
        </div>
      </header>

      {/* Search hero */}
      <section className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">Lacak Paket Anda</h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Masukkan <b>No. Master Resi</b> (mis. <span className="font-mono">MKT-000001</span>) untuk melihat status pengiriman dan daftar paket.
          </p>
        </div>

        <form onSubmit={onSearch} className="mt-6 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Contoh: MKT-000001"
              className="h-12 pl-10 text-base"
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" size="lg" className="h-12 px-8" disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Lacak
          </Button>
        </form>

        {/* Helper chip row */}
        {!data && !error && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border bg-card px-3 py-1">No login required</span>
            <span className="rounded-full border bg-card px-3 py-1">Real-time status</span>
            <span className="rounded-full border bg-card px-3 py-1">Lihat semua paket</span>
          </div>
        )}
      </section>

      {/* Error state */}
      {error && (
        <section className="mx-auto max-w-4xl px-4 pb-8">
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="flex items-start gap-3 py-6">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-semibold text-destructive">Resi tidak ditemukan</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Pastikan nomor yang Anda masukkan benar. Master Resi tertera pada resi / receipt pengiriman Anda, formatnya biasanya <span className="font-mono">MKT-XXXXXX</span>.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Result */}
      {data && (
        <section className="mx-auto max-w-4xl space-y-4 px-4 pb-16">
          {/* Summary card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Master Resi</p>
                  <CardTitle className="font-mono text-xl">{data.masterCode}</CardTitle>
                  {data.resi && data.resi !== data.masterCode && (
                    <p className="mt-0.5 text-xs text-muted-foreground">Resi: <span className="font-mono">{data.resi}</span></p>
                  )}
                </div>
                <Badge variant={data.status === "DELIVERED" ? "default" : data.status === "CANCELLED" ? "destructive" : "secondary"} className="text-sm">
                  {data.statusLabel}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Progress steps */}
              <ol className="flex items-center justify-between gap-1 overflow-x-auto pb-1">
                {PROGRESS_STEPS.map((step, idx) => {
                  const Icon = step.icon;
                  const done = idx <= progress;
                  const current = idx === progress;
                  return (
                    <li key={step.key} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                      <div className="flex w-full items-center" aria-hidden>
                        <span className={cn("h-0.5 flex-1", idx === 0 ? "bg-transparent" : done ? "bg-primary" : "bg-border")} />
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs",
                            done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
                            current && "ring-2 ring-primary/30 ring-offset-2 ring-offset-background",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className={cn("h-0.5 flex-1", idx === PROGRESS_STEPS.length - 1 ? "bg-transparent" : idx < progress ? "bg-primary" : "bg-border")} />
                      </div>
                      <span className={cn("max-w-[80px] text-[10px] leading-tight", done ? "font-semibold text-foreground" : "text-muted-foreground")}>
                        {step.label}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {/* Route info */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-card p-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Navigation className="h-3 w-3" /> Rute Pengiriman
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                    <span>{data.origin}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{data.destination}</span>
                  </p>
                  {data.destinationWarehouse && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <Warehouse className="mr-1 inline h-3 w-3" />
                      Gudang Tujuan: {data.destinationWarehouse.name}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <CalendarClock className="h-3 w-3" /> Dibuat
                  </p>
                  <p className="mt-1 text-sm font-semibold">{formatDate(data.createdAt, true)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Update terakhir: {formatDate(data.updatedAt, true)}</p>
                </div>
              </div>

              {/* Sender / Recipient */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-card p-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <User className="h-3 w-3" /> Pengirim
                  </p>
                  <p className="mt-1 text-sm font-semibold">{data.sender.name}</p>
                  {data.sender.phone && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" /> {data.sender.phone}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <User className="h-3 w-3" /> Penerima
                  </p>
                  <p className="mt-1 text-sm font-semibold">{data.recipient.name ?? "—"}</p>
                  {data.recipient.address && (
                    <p className="text-xs text-muted-foreground">{data.recipient.address}</p>
                  )}
                  {data.recipient.phone && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" /> {data.recipient.phone}
                    </p>
                  )}
                </div>
              </div>

              {/* Customer support contact */}
              {data.destinationWarehouse?.customerSupportContact && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-primary/5 p-3 text-xs">
                  <Phone className="h-3.5 w-3.5 text-primary" />
                  <span className="font-semibold text-primary">Butuh bantuan?</span>
                  <span className="text-muted-foreground">Hubungi gudang tujuan:</span>
                  <span className="font-mono font-semibold">{data.destinationWarehouse.customerSupportContact}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Packages list — what's tied to this Master Resi */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Box className="h-4 w-4 text-primary" /> Daftar Paket
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {data.totals.totalPackages} paket · {formatNumber(data.totals.totalActualKg, 2)} kg · {formatNumber(data.totals.totalVolumeM3, 3)} m³
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {data.packages.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Belum ada paket terdaftar pada Master Resi ini.</p>
              ) : (
                <ul className="divide-y">
                  {data.packages.map((p, i) => {
                    const volume = (p.lengthCm && p.widthCm && p.heightCm)
                      ? Math.round(((p.lengthCm * p.widthCm * p.heightCm) / 1_000_000) * 1_000_000) / 1_000_000
                      : null;
                    return (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                            {i + 1}
                          </span>
                          <div>
                            <p className="text-sm font-semibold">{p.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.lengthCm && p.widthCm && p.heightCm
                                ? `${p.lengthCm} × ${p.widthCm} × ${p.heightCm} cm`
                                : "Dimensi tidak tersedia"}
                              {volume != null && ` · ${formatNumber(volume, 3)} m³`}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold">{formatNumber(p.actualWeightKg, 2)} kg</p>
                          <p className="text-[10px] text-muted-foreground">berat aktual</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Tracking timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-primary" /> Riwayat Perjalanan
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.trackingEvents.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Belum ada riwayat perjalanan.</p>
              ) : (
                <ol className="relative border-l border-border pl-6">
                  {data.trackingEvents.map((ev) => (
                    <li key={ev.id} className="mb-5 last:mb-0">
                      <span className="absolute -left-[14px] flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-primary/10 text-primary">
                        {eventIcon(ev.event)}
                      </span>
                      <div className="rounded-lg border bg-card p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{ev.description ?? ev.event}</p>
                          <span className="text-[10px] text-muted-foreground">{formatDate(ev.occurredAt, true)}</span>
                        </div>
                        {ev.actorName && (
                          <p className="mt-1 text-xs text-muted-foreground">oleh {ev.actorName}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Back to search */}
          <div className="flex justify-center pt-2">
            <Button variant="outline" onClick={() => { setData(null); setError(null); setQuery(""); }} className="gap-2">
              <Search className="h-4 w-4" /> Lacak resi lain
            </Button>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t bg-background/80 py-6 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} KirimKu — Layanan Lacak Paket Publik</p>
      </footer>
    </main>
  );
}
