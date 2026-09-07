"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Form field wrapper with label + error. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-[11px] font-medium text-destructive">{error}</p>}
    </div>
  );
}

export function SubmitButton({
  busy,
  children,
  className,
}: {
  busy?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button type="submit" disabled={busy} className={className}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}

export function NumberInput(props: React.ComponentProps<typeof Input>) {
  return <Input type="number" step="any" {...props} />;
}

export function FormSelect({
  value,
  onValueChange,
  placeholder,
  options,
  disabled,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder ?? "Pilih…"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { Input, Textarea };

/** Format helpers */
export function formatRupiah(value: number | null | undefined): string {
  if (value == null) return "—";
  return `Rp${value.toLocaleString("id-ID")}`;
}

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (value == null) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null) return "—";
  return value.toLocaleString("id-ID", { maximumFractionDigits: digits });
}
