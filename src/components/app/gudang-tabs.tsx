"use client";

import { useMemo } from "react";
import { Warehouse as WarehouseIcon } from "lucide-react";
import { TabsTrigger } from "@/components/ui/tabs";
import type { Options } from "@/lib/client-api";

// ---------------------------------------------------------------------------
// Per-gudang tabs (owner view) + gudang scope badge (staff view)
//
// Owner layout on Shipments / Pickups / Deliveries / Transports:
//   Daftar | Gudang A | Gudang B | Gudang C | … | Log Aktivitas
// Every other role keeps  Daftar | Log Aktivitas  and only sees the data of
// the gudang they belong to (filtered server-side).
// ---------------------------------------------------------------------------

export const GUDANG_TAB_PREFIX = "wh-";

export function gudangTabValue(id: number): string {
  return `${GUDANG_TAB_PREFIX}${id}`;
}

export function parseGudangTabValue(value: string): number | null {
  if (!value.startsWith(GUDANG_TAB_PREFIX)) return null;
  const id = Number(value.slice(GUDANG_TAB_PREFIX.length));
  return Number.isFinite(id) ? id : null;
}

/** Short tab label: "Gudang Jakarta Pusat" → "Jakarta Pusat". */
export function gudangTabLabel(name: string): string {
  const prefix = "gudang ";
  return name.toLowerCase().startsWith(prefix) ? name.slice(prefix.length) : name;
}

/** One TabsTrigger per active gudang — rendered only for the owner. */
export function GudangTabsTriggers({ warehouses }: { warehouses: Options["warehouses"] }) {
  return (
    <>
      {(warehouses ?? []).map((w) => (
        <TabsTrigger key={w.id} value={gudangTabValue(w.id)} title={w.name}>
          {gudangTabLabel(w.name)}
        </TabsTrigger>
      ))}
    </>
  );
}

/**
 * Filter rows to the gudang of the active tab (owner only — staff rows are
 * already scoped server-side). Rows without gudangIds never match a gudang tab.
 */
export function useGudangTabFilter<T extends { gudangIds?: number[] }>(rows: T[], tab: string): T[] {
  const gudangId = parseGudangTabValue(tab);
  return useMemo(
    () => (gudangId == null ? rows : rows.filter((r) => (r.gudangIds ?? []).includes(gudangId))),
    [rows, gudangId],
  );
}

/** Small banner shown above the table while a gudang tab is active. */
export function GudangTabBanner({ gudangName, count }: { gudangName: string; count: number }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground/80">
      <WarehouseIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span>
        Menampilkan data <b>{gudangName}</b> saja — {count} entri. Pindah ke tab <b>Daftar</b> untuk melihat semua gudang.
      </span>
    </p>
  );
}

/** Badge for non-owner users showing which gudang's data they see. */
export function GudangScopeBadge({ gudangName }: { gudangName: string | null }) {
  if (!gudangName) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
      <WarehouseIcon className="h-3.5 w-3.5" />
      Data gudang Anda: {gudangName}
    </span>
  );
}
