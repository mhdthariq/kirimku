"use client";

import type { ReactNode } from "react";
import { Activity } from "lucide-react";
import { DataTable, type Column } from "@/components/app/data-table";
import { cn } from "@/shared/utils";

/** The shared operational masthead, including screens reached from task details. */
export function OperationalHeader({ eyebrow, title, subtitle, description, icon, actions, note }: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <header className="min-w-0 rounded-2xl border bg-linear-to-br from-primary/10 via-card to-card p-4 sm:p-6">
      <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-primary sm:text-xs">
        <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">{icon ?? <Activity />}</span>{eyebrow}
      </p>
      <div className="flex min-w-0 flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&>svg]:size-5">{icon ?? <Activity />}</div>
          <div className="min-w-0">
            <h1 className="break-words text-xl font-bold tracking-tight sm:text-2xl [overflow-wrap:anywhere]">{title}</h1>
            {(subtitle || description) && <p className="mt-1 max-w-3xl break-words text-sm leading-relaxed text-muted-foreground">{subtitle ?? description}</p>}
          </div>
        </div>
        {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 xl:max-w-[55%] xl:justify-end [&_button]:min-h-11 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:rounded-xl">{actions}</div>}
      </div>
      {note && <div className="mt-5 border-t border-primary/10 pt-4 text-xs leading-relaxed text-muted-foreground">{note}</div>}
    </header>
  );
}

export function OperationalSummary({ items, loading }: {
  items: { label: string; value: number; hint?: string }[];
  loading?: boolean;
}) {
  return (
    <section aria-label="Ringkasan operasional" className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => <div key={item.label} className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
        <p className="mt-3 break-words text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">{loading ? "–" : item.value.toLocaleString("id-ID")}</p>
        {item.hint && <p className="mt-2 text-xs text-muted-foreground">{item.hint}</p>}
      </div>)}
    </section>
  );
}

/** Keep existing column renderers and their permission gates in both presentations. */
export function OperationalTable<T extends { id: number | string }>({ columns, ...props }: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
}) {
  return <div className="min-w-0 space-y-3 rounded-2xl border bg-card p-3 shadow-sm sm:p-5 [&_input]:min-h-11 [&_input]:rounded-xl">
    <DataTable {...props} columns={columns} desktopBreakpoint="xl" renderCard={(row) => {
      const primary = columns.find((column) => column.primary);
      const status = columns.find((column) => column.key === "status");
      const actions = columns.find((column) => column.key === "actions");
      return <article className="flex h-full min-w-0 flex-col rounded-2xl border bg-background shadow-sm">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b p-4">
          {primary && <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{primary.render(row)}</div>}
          {status && <div className="min-w-0 max-w-full">{status.render(row)}</div>}
        </div>
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-4 p-4">
          {columns.filter((column) => !column.primary && column.key !== "status" && column.key !== "actions").map((column) => (
            <div key={column.key} className={cn("min-w-0", ["customer", "pod", "desc", "from", "return"].includes(column.key) && "col-span-2")}>
              <dt className="mb-1.5 text-[11px] font-medium text-muted-foreground">{column.header}</dt>
              <dd className="min-w-0 break-words text-sm [overflow-wrap:anywhere] [&_p]:break-words [&_a]:break-words">{column.render(row)}</dd>
            </div>
          ))}
        </dl>
        {actions && <div className="min-w-0 rounded-b-2xl border-t bg-muted/20 p-3 [&_button]:min-h-10 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:rounded-lg">{actions.render(row)}</div>}
      </article>;
    }} />
  </div>;
}

export const operationalTabsClass = "h-auto min-h-11 max-w-full flex-wrap justify-start gap-1 rounded-xl p-1.5 sm:justify-start [&_button]:min-h-9 [&_button]:rounded-lg";
