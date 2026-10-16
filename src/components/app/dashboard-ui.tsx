"use client";

import type { ReactNode } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { cn } from "@/shared/utils";
import { Button } from "@/components/ui/button";

export function DashboardHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="flex min-w-0 flex-col gap-4 sm:gap-5 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="min-w-0 max-w-full shrink-0">{actions}</div>}
    </header>
  );
}

export function DashboardMetric({ label, value, hint, icon, href, tone = "emerald" }: { label: string; value: ReactNode; hint?: string; icon: ReactNode; href?: string; tone?: "emerald" | "blue" | "amber" | "violet" }) {
  const tones = { emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", blue: "bg-sky-500/10 text-sky-600 dark:text-sky-400", amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400", violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400" };
  const content = <>
    <div className="flex items-start justify-between gap-3">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl [&>svg]:h-5 [&>svg]:w-5", tones[tone])}>{icon}</span>
      {href && <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />}
    </div>
    <p className="mt-4 text-xs font-medium text-muted-foreground">{label}</p>
    <p className="mt-1.5 break-words text-[clamp(1.25rem,2.2vw,1.875rem)] font-semibold leading-tight tracking-tight text-foreground tabular-nums">{value}</p>
    {hint && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
  </>;
  const className = "group min-w-0 rounded-2xl border border-border/80 bg-card p-4 shadow-sm transition-colors sm:p-5";
  return href ? <a href={href} className={cn(className, "hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary")}>{content}</a> : <div className={className}>{content}</div>;
}

export function DashboardSectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
    <div className="min-w-0"><h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">{title}</h2>{description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}</div>
    {action}
  </div>;
}

export function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="rounded-2xl border border-destructive/25 bg-card p-6"><h2 className="font-semibold">Dashboard belum dapat dimuat</h2><p className="mt-2 break-words text-sm text-muted-foreground">{message}</p><Button className="mt-4" variant="outline" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Coba lagi</Button></div>;
}
