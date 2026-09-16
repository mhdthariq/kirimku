"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; pulse?: boolean }> = {
  // Shipment lifecycle
  CREATED: { label: "Created", variant: "outline" },
  READY_FOR_PICKUP: { label: "Ready for Pickup", variant: "secondary" },
  PICKED_UP: { label: "Picked Up", variant: "secondary" },
  // Origin-side intake (kurir drop-off scan / walk-in at the journey's first gudang)
  RECEIVED_AT_GUDANG: { label: "Arrived at Origin Gudang", variant: "secondary" },
  IN_TRANSPORT: { label: "In Transport", variant: "default", pulse: true },
  // The transport driver checked in at the LAST checkpoint (Gudang Tujuan) —
  // packages are physically at the destination branch but Admin Gudang has
  // NOT scan-verified them yet (awaiting the reception scan).
  AT_DEST_GUDANG: { label: "Tiba di Gudang Tujuan", variant: "secondary", pulse: true },
  // Packages scan-verified & received by Admin Gudang of the destination
  // gudang. Pages that know the destination gudang pass a dynamic label such
  // as "Arrived at Gudang Jakarta Pusat" via the `label` prop.
  ARRIVED_AT_GUDANG: { label: "Arrived at Gudang Tujuan", variant: "default" },
  DELIVERED: { label: "Delivered", variant: "default" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
  // Tasks (PICKED_UP is already defined above — one badge style for both the
  // shipment status and the pickup task state)
  ASSIGNED: { label: "Assigned", variant: "secondary" },
  IN_PROGRESS: { label: "In Progress", variant: "default", pulse: true },
  COMPLETED: { label: "Completed", variant: "default" },
  FAILED: { label: "Failed", variant: "destructive" },
  // Transport
  PLANNED: { label: "Planned", variant: "outline" },
  DEPARTED: { label: "Departed", variant: "default", pulse: true },
  ARRIVED: { label: "Arrived", variant: "default" },
  // Payment
  RECORDED: { label: "Recorded", variant: "secondary" },
  VERIFIED: { label: "Verified", variant: "default" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  // Invoice
  DRAFT: { label: "Draft", variant: "outline" },
  SENT: { label: "Sent", variant: "default" },
  PARTIALLY_SETTLED: { label: "Partial", variant: "secondary" },
  SETTLED: { label: "Settled", variant: "default" },
  // Vehicle
  ACTIVE: { label: "Active", variant: "default" },
  MAINTENANCE: { label: "Maintenance", variant: "secondary" },
  INACTIVE: { label: "Inactive", variant: "destructive" },
  // Revise.md — partner wallet financial statuses
  PENDING_VERIFICATION: { label: "Menunggu Verifikasi", variant: "default", pulse: true },
  PENDING: { label: "Pending", variant: "secondary" },
  APPROVED: { label: "Disetujui", variant: "default" },
  PROCESSING: { label: "Diproses", variant: "default", pulse: true },
  RELEASED: { label: "Dirilis", variant: "default" },
  FINALIZED: { label: "Final", variant: "default" },
};

export function StatusBadge({ status, className, label }: { status: string; className?: string; label?: string }) {
  const meta = STATUS_MAP[status] ?? { label: status, variant: "outline" as const };
  return (
    <Badge variant={meta.variant} className={cn("whitespace-nowrap", className)}>
      <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current", meta.pulse && "pulse-dot")} />
      {label ?? meta.label}
    </Badge>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant={type === "b2b" ? "default" : "outline"} className="uppercase">
      {type}
    </Badge>
  );
}

export function ActiveBadge({ active, activeText = "Aktif", inactiveText = "Nonaktif" }: { active: boolean; activeText?: string; inactiveText?: string }) {
  return (
    <Badge variant={active ? "default" : "outline"}>
      {active ? activeText : inactiveText}
    </Badge>
  );
}
