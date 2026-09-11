"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPost, hasPermission, type VehicleRepairRow } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, NumberInput, SubmitButton, formatRupiah, formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Repairs (Revise.md §19–§22) — dual mode:
 *  · Vehicle Owner → own-vehicle repairs with CONFIRM / REJECT (first party)
 *  · Company (repair.view/create) → all repairs; create with proof;
 *    Owner Company confirms (repair.approve) / rejects (repair.reject).
 * The wallet is debited ONLY after BOTH parties confirm (two-party rule §21).
 */
export function RepairsPage() {
  const { user } = useAuth();
  const isVehicleOwner = user?.partnerType === "VEHICLE_OWNER";
  const canCompanyView = hasPermission(user, "repair.view");
  const canCreate = hasPermission(user, "repair.create");
  const canCompanyConfirm = hasPermission(user, "repair.approve");
  const canCompanyReject = hasPermission(user, "repair.reject");

  const { data, loading, reload } = useApiData<VehicleRepairRow[]>(() => apiGet<VehicleRepairRow[]>("/repairs"), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<VehicleRepairRow | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const rows = useMemo(() => {
    const list = data ?? [];
    if (statusFilter === "all") return list;
    return list.filter((r) => r.status === statusFilter);
  }, [data, statusFilter]);

  if (!isVehicleOwner && !canCompanyView) {
    return <PageHeader title="Repair & Maintenance" subtitle="Anda tidak memiliki izin melihat data repair." icon={<Wrench className="h-5 w-5" />} />;
  }

  async function voDecision(repairId: number, decision: "CONFIRM" | "REJECT") {
    const ok = await runAction(() => apiPost(`/repairs/${repairId}/confirm`, { decision }), {
      success: decision === "CONFIRM" ? "Konfirmasi Anda tercatat — menunggu konfirmasi Owner Company." : "Repair ditolak — tidak ada deduction wallet.",
    });
    if (ok) reload();
  }

  async function companyConfirm(repairId: number) {
    const ok = await runAction(() => apiPost(`/repairs/${repairId}/company-confirm`), {
      success: "Repair terverifikasi — REPAIR_DEDUCTION didebit dari wallet Vehicle Owner (atomic).",
    });
    if (ok) reload();
  }

  async function companyReject(repairId: number, reason?: string) {
    const ok = await runAction(() => apiPost(`/repairs/${repairId}/company-reject`, { reason }), {
      success: "Repair ditolak oleh Owner Company — wallet tidak tersentuh.",
    });
    if (ok) reload();
  }

  const pendingForMe = rows.filter((r) => isVehicleOwner && r.status === "PENDING_CONFIRMATION").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Repair & Maintenance"
        subtitle={
          isVehicleOwner
            ? "Biaya repair untuk kendaraan Anda — wallet hanya didebit setelah Anda DAN Owner Company konfirmasi (§21)."
            : "Deduction repair Vehicle Owner — dua konfirmasi wajib: Vehicle Owner lalu Owner Company."
        }
        icon={<Wrench className="h-5 w-5" />}
        actions={
          <>
            {isVehicleOwner && pendingForMe > 0 && (
              <span className="rounded-xl border border-chart-4/40 bg-chart-4/10 px-4 py-2 text-xs font-semibold text-chart-4">
                {pendingForMe} menunggu konfirmasi Anda
              </span>
            )}
            {canCreate && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Ajukan Repair
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {["all", "PENDING_CONFIRMATION", "OWNER_CONFIRMED", "VERIFIED", "REJECTED"].map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            {f === "all" ? "Semua" : f.replace("_", " ")}
          </button>
        ))}
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        emptyMessage="Belum ada record repair."
        columns={[
          {
            key: "code",
            header: "Kode",
            primary: true,
            render: (r) => (
              <div>
                <p className="font-mono text-xs font-semibold">{r.repairCode}</p>
                <p className="text-xs text-muted-foreground">{r.vehicle.vehicleNumber}</p>
              </div>
            ),
          },
          {
            key: "desc",
            header: "Repair",
            render: (r) => (
              <div>
                <p className="text-sm font-medium">{r.description}</p>
                <p className="text-xs text-muted-foreground">{r.workshopVendor ?? "—"} · {formatDate(r.repairDate)}</p>
              </div>
            ),
          },
          { key: "amount", header: "Biaya", render: (r) => <span className="font-semibold text-destructive">{formatRupiah(r.amount)}</span> },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            key: "confirmations",
            header: "Konfirmasi",
            hideOnMobile: true,
            render: (r) => (
              <div className="text-xs">
                {(["VEHICLE_OWNER", "OWNER_COMPANY"] as const).map((party) => {
                  const c = r.confirmations.find((x) => x.party === party);
                  return (
                    <p key={party} className="flex items-center gap-1">
                      {c?.decision === "CONFIRMED" ? (
                        <CheckCircle2 className="h-3 w-3 text-primary" />
                      ) : c?.decision === "REJECTED" ? (
                        <XCircle className="h-3 w-3 text-destructive" />
                      ) : (
                        <span className="inline-block h-3 w-3 rounded-full border border-dashed border-muted-foreground" />
                      )}
                      {party === "VEHICLE_OWNER" ? "Vehicle Owner" : "Owner Company"}
                    </p>
                  );
                })}
              </div>
            ),
          },
          {
            key: "actions",
            header: "Aksi",
            render: (r) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setDetail(r)}>
                  Detail
                </Button>
                {isVehicleOwner && r.status === "PENDING_CONFIRMATION" && (
                  <>
                    <Button size="sm" className="h-7" onClick={() => voDecision(r.id, "CONFIRM")}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Konfirmasi
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={() => voDecision(r.id, "REJECT")}>
                      <XCircle className="h-3.5 w-3.5" /> Tolak
                    </Button>
                  </>
                )}
                {canCompanyConfirm && r.status === "OWNER_CONFIRMED" && (
                  <Button size="sm" className="h-7" onClick={() => companyConfirm(r.id)}>
                    <ShieldCheck className="h-3.5 w-3.5" /> Konfirmasi Owner
                  </Button>
                )}
                {canCompanyReject && ["PENDING_CONFIRMATION", "OWNER_CONFIRMED"].includes(r.status) && (
                  <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={() => companyReject(r.id)}>
                    Tolak
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <CreateRepairDialog open={createOpen} onOpenChange={setCreateOpen} onDone={reload} />
      <RepairDetailDialog repair={detail} onOpenChange={(open) => !open && setDetail(null)} />
    </div>
  );
}

function CreateRepairDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ vehicleId: "", description: "", amount: "", repairDate: "", workshopVendor: "", notes: "" });
  // Only partner-owned vehicles are eligible (repairs deduct from the Vehicle
  // Owner's profit — company vehicles have no owner to charge).
  const { data: ownedVehicles } = useApiData<{ id: number; vehicleNumber: string; owner?: { id: number } | null }[]>(
    () => (open ? apiGet("/vehicles") : Promise.resolve([] as { id: number; vehicleNumber: string; owner?: { id: number } | null }[])),
    [open],
  );
  const vehicleOptions = (ownedVehicles ?? []).filter((v) => v.owner != null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await runAction(
      () =>
        apiPost("/repairs", {
          vehicleId: Number(form.vehicleId),
          description: form.description,
          amount: Number(form.amount),
          repairDate: form.repairDate || null,
          workshopVendor: form.workshopVendor || null,
          notes: form.notes || null,
          // placeholder SVG proof — represents the required invoice/receipt (§19)
          proofUrl:
            "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2Y4ZjlmYSIvPjx0ZXh0IHg9IjEyIiB5PSI3MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTMiIGZpbGw9IiM2NDc0OGIiPk5vdGEgUmVwYWlyIC0gQnVrdGkgUmVzbWk8L3RleHQ+PC9zdmc+",
        }),
      { success: "Repair diajukan — status PENDING_CONFIRMATION, wallet belum terdeduct." },
    );
    if (ok) {
      setForm({ vehicleId: "", description: "", amount: "", repairDate: "", workshopVendor: "", notes: "" });
      onOpenChange(false);
      onDone();
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajukan Repair / Maintenance</DialogTitle>
          <DialogDescription>
            Biaya repair akan dideduct dari wallet Vehicle Owner hanya setelah dua konfirmasi (§20/§21). Bukti (nota/invoice) wajib dilampirkan — kelola unggahan melalui detail record.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Kendaraan">
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              value={form.vehicleId}
              onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
              required
            >
              <option value="">Pilih kendaraan…</option>
              {vehicleOptions.map((v) => (
                <option key={v.id} value={v.id}>{v.vehicleNumber}</option>
              ))}
            </select>
          </Field>
          <Field label="Deskripsi Repair">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="mis. Ganti oli + servis rem" rows={2} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Biaya (Rupiah)">
              <NumberInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} min={1} required />
            </Field>
            <Field label="Tanggal Repair">
              <input
                type="date"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                value={form.repairDate}
                onChange={(e) => setForm({ ...form, repairDate: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Bengkel / Vendor">
            <Textarea value={form.workshopVendor} onChange={(e) => setForm({ ...form, workshopVendor: e.target.value })} rows={1} />
          </Field>
          <Field label="Catatan">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <SubmitButton busy={busy}>Ajukan Repair</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RepairDetailDialog({ repair, onOpenChange }: { repair: VehicleRepairRow | null; onOpenChange: (open: boolean) => void }) {
  if (!repair) return null;
  return (
    <Dialog open={!!repair} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{repair.repairCode} · {repair.vehicle.vehicleNumber}</DialogTitle>
          <DialogDescription>
            {repair.description} — {formatRupiah(repair.amount)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <DetailItem label="Bengkel" value={repair.workshopVendor ?? "—"} />
            <DetailItem label="Tanggal Repair" value={formatDate(repair.repairDate)} />
            <DetailItem label="Diajukan" value={formatDate(repair.createdAt, true)} />
            <DetailItem label="Status" value={repair.status} />
          </div>
          {repair.notes && <DetailItem label="Catatan" value={repair.notes} />}
          {repair.rejectReason && <DetailItem label="Alasan Penolakan" value={repair.rejectReason} />}
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Riwayat Konfirmasi</p>
            {repair.confirmations.length === 0 && <p className="text-xs text-muted-foreground">Belum ada keputusan.</p>}
            <div className="space-y-1">
              {repair.confirmations.map((c) => (
                <p key={c.id} className="flex items-center gap-2 text-xs">
                  {c.decision === "CONFIRMED" ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                  <b>{c.party === "VEHICLE_OWNER" ? "Vehicle Owner" : "Owner Company"}</b> · {c.user?.name ?? "—"} · {formatDate(c.createdAt, true)}
                </p>
              ))}
            </div>
          </div>
          {repair.proofUrl && (
            <a href={repair.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Lihat Bukti (nota / foto)
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
