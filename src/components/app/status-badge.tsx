"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; pulse?: boolean }> = {
  // Shipment lifecycle
  CREATED: { label: "Created", variant: "outline" },
  READY_FOR_PICKUP: { label: "Ready for Pickup", variant: "secondary" },
  PICKED_UP: { label: "Picked Up", variant: "secondary" },
  RECEIVED_AT_GUDANG: { label: "At Gudang", variant: "secondary" },
  IN_TRANSPORT: { label: "In Transport", variant: "default", pulse: true },
  ARRIVED_AT_GUDANG: { label: "Arrived", variant: "secondary" },
  DELIVERED: { label: "Delivered", variant: "default" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
  // Tasks
  ASSIGNED: { label: "Assigned", variant: "secondary" },
  IN_PROGRESS: { label: "In Progress", variant: "default", pulse: true },
  PICKED_UP: { label: "Picked Up", variant: "default", pulse: true },
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
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = STATUS_MAP[status] ?? { label: status, variant: "outline" as const };
  return (
    <Badge variant={meta.variant} className={cn("whitespace-nowrap", className)}>
      <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current", meta.pulse && "pulse-dot")} />
      {meta.label}
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
