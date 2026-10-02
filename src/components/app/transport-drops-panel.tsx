"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, MapPin, PackageCheck, PackageMinus, Undo2 } from "lucide-react";
import { apiGet, apiPost, type TransportDropsBoard } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { StatusBadge } from "@/components/app/status-badge";
import { FormSelect } from "@/components/app/form-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Multi Drop board + Delivery Approval + Resi Tugas Balik entry point.
 *
 * Three separate concepts (kept apart on purpose):
 *   check-in  = the vehicle arrived (Check-in Checkpoint card)
 *   drop      = a resi was unloaded here  ("Turunkan")
 *   approval  = the receiving side accepted it ("Setujui")
 * When every resi is approved the transport can be approved as a whole; the
 * vehicle is then empty and a Resi Tugas Balik can be created.
 */
export function TransportDropsPanel({
  transportId,
  isCrew,
  can,
  onChanged,
}: {
  transportId: number;
  isCrew: boolean;
  can: { assign: boolean; drop: boolean; approve: boolean; createReturn: boolean };
  onChanged?: () => void;
}) {
  const { data: board, loading, reload } = useApiData<TransportDropsBoard>(() => apiGet<TransportDropsBoard>(`/transports/${transportId}/drops`), [transportId]);
  const [busyId, setBusyId] = useState<number | "transport" | "return" | null>(null);

  const byId = useMemo(() => new Map((board?.shipments ?? []).map((s) => [s.shipmentId, s])), [board]);
  const cpName = useMemo(() => new Map((board?.checkpoints ?? []).map((c) => [c.id, c.name])), [board]);

  if (loading && !board) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (!board || board.shipments.length === 0) return null;

  const multi = board.transportMode === "MULTI_DROP";
  const active = board.transportStatus === "PLANNED" || board.transportStatus === "DEPARTED";
  const firstSeq = Math.min(...board.checkpoints.map((c) => c.sequence));
  const assignable = board.checkpoints.filter((c) => c.sequence !== firstSeq);

  async function act(key: number | "transport" | "return", fn: () => Promise<unknown>, success: string) {
    setBusyId(key);
    const ok = await runAction(fn, { success });
    setBusyId(null);
    if (ok) {
      reload();
      onChanged?.();
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <PackageMinus className="h-4 w-4 text-primary" /> {multi ? "Multi Drop" : "Penurunan & Approval Resi"}
            <Badge variant={multi ? "default" : "outline"}>{multi ? "MULTI DROP" : "DIRECT"}</Badge>
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {board.progress.dropped}/{board.progress.total} diturunkan · {board.progress.approved}/{board.progress.total} disetujui
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {board.groups.map((g) => {
          const cp = board.checkpoints.find((c) => c.id === g.checkpointId);
          return (
            <div key={g.checkpointId ?? "none"} className="rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <MapPin className="h-3.5 w-3.5 text-primary" />
                  {cp ? `CP${cp.sequence} · ${cp.name}` : "Tujuan akhir"}
                  {cp?.isFinal && <span className="text-[11px] font-normal text-muted-foreground">(tujuan akhir)</span>}
                </p>
                {cp && <span className={cp.checkedIn ? "text-xs text-emerald-600" : "text-xs text-muted-foreground"}>{cp.checkedIn ? "kendaraan sudah check-in" : "belum check-in"}</span>}
              </div>
              <div className="divide-y">
                {g.shipmentIds.map((sid) => {
                  const s = byId.get(sid);
                  if (!s) return null;
                  const canAssignNow = multi && can.assign && active && (s.dropStatus === "LOADED" || s.dropStatus === "AT_DROP_POINT");
                  const canDropNow = multi && (isCrew || can.drop) && board.transportStatus === "DEPARTED" && s.dropStatus === "AT_DROP_POINT";
                  const canApproveNow = can.approve && (s.dropStatus === "DROPPED" || s.dropStatus === "DELIVERY_PENDING");
                  return (
                    <div key={sid} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <a href={`/#/shipments/${s.shipmentId}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                          {s.masterCode}
                        </a>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.customerName}
                          {s.penerimaName ? ` → ${s.penerimaName}` : ""}
                        </p>
                      </div>
                      {canAssignNow && (
                        <div className="w-44">
                          <FormSelect
                            value={s.dropCheckpointId ? String(s.dropCheckpointId) : ""}
                            onValueChange={(v) =>
                              act(sid, () => apiPost(`/transports/${transportId}/drops/${sid}`, { action: "ASSIGN", dropCheckpointId: Number(v) }), "Titik drop disimpan.")
                            }
                            placeholder="Titik drop…"
                            options={assignable.map((c) => ({ value: String(c.id), label: `CP${c.sequence} · ${c.name}` }))}
                            disabled={busyId === sid}
                          />
                        </div>
                      )}
                      <StatusBadge status={s.dropStatus} />
                      {canDropNow && (
                        <Button size="sm" variant="outline" disabled={busyId === sid} onClick={() => act(sid, () => apiPost(`/transports/${transportId}/drops/${sid}`, { action: "DROP" }), `${s.masterCode} diturunkan.`)}>
                          <PackageMinus className="h-3.5 w-3.5" /> Turunkan
                        </Button>
                      )}
                      {canApproveNow && (
                        <Button size="sm" disabled={busyId === sid} onClick={() => act(sid, () => apiPost(`/transports/${transportId}/drops/${sid}/approve`, {}), `${s.masterCode} disetujui.`)}>
                          <PackageCheck className="h-3.5 w-3.5" /> Setujui
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {multi && active && assignable.length > 0 && can.assign && board.shipments.some((s) => !s.dropCheckpointId && s.dropStatus === "LOADED") && (
          <p className="text-xs text-muted-foreground">Resi tanpa titik drop akan turun di tujuan akhir ({cpName.get(board.checkpoints.find((c) => c.isFinal)?.id ?? -1) ?? "-"}).</p>
        )}

        {/* Transport-level approval + return task */}
        {board.deliveryApprovedAt ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/40">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Delivery transport disetujui - kendaraan kosong
            </p>
            {can.createReturn && (
              <Button
                size="sm"
                disabled={busyId === "return"}
                onClick={() => act("return", () => apiPost(`/transports/${transportId}/return-task`, {}), "Resi tugas balik dibuat - lihat di menu Tugas Balik.")}
              >
                <Undo2 className="h-3.5 w-3.5" /> Buat Resi Tugas Balik
              </Button>
            )}
          </div>
        ) : (
          board.progress.allApproved &&
          can.approve && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
              <p className="text-sm">Semua resi sudah disetujui. Setujui transport untuk menandai kendaraan kosong.</p>
              <Button size="sm" disabled={busyId === "transport"} onClick={() => act("transport", () => apiPost(`/transports/${transportId}/delivery-approval`, {}), "Delivery transport disetujui.")}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Setujui Delivery Transport
              </Button>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
