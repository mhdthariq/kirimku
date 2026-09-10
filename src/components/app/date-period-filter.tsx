"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Calendar / period filter (Revision Parts R & U): default start = TODAY,
 * custom period via the calendar (from → to). Mobile friendly.
 */
export function DatePeriodFilter({
  from,
  to,
  onChange,
  className,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pickingStart, setPickingStart] = useState(true);

  const days = Math.max(1, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1);

  function pick(date: string) {
    if (pickingStart) {
      // picking the start (or a fresh single day)
      if (date > to) {
        onChange(date, date); // single-day selection
      } else {
        setPickingStart(false); // now pick the end
        onChange(date, to < date ? date : to);
      }
    } else {
      const [f, t] = date >= from ? [from, date] : [date, from];
      onChange(f, t);
      setPickingStart(true);
      setOpen(false);
    }
  }

  // build a simple month grid
  const [cursor, setCursor] = useState(() => new Date(`${from}T00:00:00`));
  const monthName = cursor.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const isoOf = (day: number) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(day)}`;
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Button
        variant="outline"
        size="sm"
        className="h-8"
        onClick={() => {
          const t = todayStr();
          onChange(t, t);
        }}
      >
        <CalendarDays className="h-3.5 w-3.5" /> Hari Ini
      </Button>
      <Button variant="outline" size="sm" className="h-8" onClick={() => onChange(shiftDays(from, -7), to)}>
        <ChevronLeft className="h-3.5 w-3.5" /> 7 Hari
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            <CalendarDays className="h-3.5 w-3.5" />
            {from === to ? formatLabel(from) : `${formatLabel(from)} → ${formatLabel(to)}`}
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">{days}h</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-3">
          <div className="flex items-center justify-between gap-3 pb-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Bulan sebelumnya">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="text-sm font-semibold">{monthName}</p>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Bulan berikutnya">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <p className="pb-1.5 text-[11px] text-muted-foreground">
            {pickingStart ? "Pilih tanggal MULAI" : "Pilih tanggal SELESAI"}
          </p>
          <div className="grid grid-cols-7 gap-1 text-center">
            {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((d) => (
              <span key={d} className="w-9 text-[10px] font-semibold text-muted-foreground">{d}</span>
            ))}
            {Array.from({ length: startWeekday }).map((_, i) => (
              <span key={`e${i}`} className="w-9" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const iso = isoOf(day);
              const selected = iso === from || iso === to || (iso > from && iso < to);
              const edge = iso === from || iso === to;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pick(iso)}
                  className={cn(
                    "h-9 w-9 rounded-md text-sm transition",
                    edge
                      ? "bg-primary font-bold text-primary-foreground"
                      : selected
                        ? "bg-primary/15 font-medium text-foreground"
                        : "hover:bg-accent",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
