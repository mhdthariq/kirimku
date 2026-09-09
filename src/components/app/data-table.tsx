"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// PageHeader — title + subtitle + action slot (the "Add" button lives here)
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
            {icon}
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResponsiveDataTable — table on ≥md, stacked cards on mobile
// ---------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: string;
  /** Render for table cells AND card values */
  render: (row: T) => React.ReactNode;
  /** Hide this column on small screens */
  hideOnMobile?: boolean;
  /** Card-only primary row (rendered as card title) */
  primary?: boolean;
  className?: string;
}

export function DataTable<T extends { id: number | string }>({
  columns,
  rows,
  loading,
  emptyMessage = "Belum ada data.",
  emptyAction,
  search,
  onSearchChange,
  searchPlaceholder = "Cari…",
  toolbar,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {(onSearchChange || toolbar) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {onSearchChange ? (
            <div className="relative w-full shrink-0 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search ?? ""}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9"
              />
            </div>
          ) : (
            <div />
          )}
          {toolbar && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          {emptyAction}
        </div>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={cn(
                        "whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                        c.className,
                      )}
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                    {columns.map((c) => (
                      <td key={c.key} className={cn("px-4 py-3 align-middle", c.className)}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="space-y-2.5 md:hidden">
            {rows.map((row) => {
              const primary = columns.find((c) => c.primary);
              const rest = columns.filter((c) => !c.primary && !c.hideOnMobile);
              return (
                <div key={row.id} className="rounded-xl border bg-card p-3.5">
                  {primary && (
                    <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
                      <span className="font-semibold text-foreground">{primary.render(row)}</span>
                    </div>
                  )}
                  <dl className="space-y-1.5">
                    {rest.map((c) => (
                      <div key={c.key} className="flex items-start justify-between gap-3 text-sm">
                        <dt className="shrink-0 text-xs text-muted-foreground">{c.header}</dt>
                        <dd className="text-right font-medium text-foreground">{c.render(row)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
