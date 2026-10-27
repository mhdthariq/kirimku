"use client";

import { useRef, useState } from "react";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/shared/utils";

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
  form,
  disabled,
}: {
  busy?: boolean;
  children: React.ReactNode;
  className?: string;
  form?: string;
  disabled?: boolean;
}) {
  return (
    <Button type="submit" disabled={busy || disabled} className={className} form={form}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}

export function NumberInput({ onKeyDown, onPaste, ...props }: React.ComponentProps<typeof Input>) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "0" && event.currentTarget.value === "") {
      event.preventDefault();
      return;
    }
    onKeyDown?.(event);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    if (event.currentTarget.value === "" && event.clipboardData.getData("text").startsWith("0")) {
      event.preventDefault();
      return;
    }
    onPaste?.(event);
  }

  return <Input type="number" step="any" {...props} onKeyDown={handleKeyDown} onPaste={handlePaste} />;
}

export function FormSelect({
  value,
  onValueChange,
  placeholder,
  options,
  disabled,
  required,
  id,
  ariaLabel,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  required?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value);

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    setQuery("");
  }

  return (
    <Popover open={open && !disabled} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open && !disabled}
          aria-haspopup="dialog"
          aria-required={required}
          aria-label={ariaLabel}
          id={id}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              changeOpen(true);
            }
          }}
          className={cn("w-full min-w-0 max-w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate">{selected?.label ?? placeholder ?? "Pilih…"}</span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* Keep native required-field validation for forms using this control. */}
      {required && (
        <input
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          value={selected ? value : ""}
          onChange={() => {}}
          required
          disabled={disabled}
          onInvalid={(event) => {
            event.preventDefault();
            // A form may contain several empty required fields. Open only
            // the first invalid control instead of several popovers at once.
            const firstInvalid = event.currentTarget.form?.querySelector(":invalid");
            if (firstInvalid && firstInvalid !== event.currentTarget) return;
            triggerRef.current?.focus();
            changeOpen(true);
          }}
        />
      )}
      <PopoverContent aria-label={ariaLabel ?? placeholder ?? "Pilih opsi"} align="start" className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden p-0">
        <Command label="Cari opsi" className="flex max-h-[var(--radix-popover-content-available-height)] flex-col">
          <div className="flex items-center gap-2 border-b px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              aria-label="Cari opsi"
              placeholder="Cari opsi…"
              className="h-10 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List aria-label={ariaLabel ?? placeholder ?? "Pilihan"} className="min-h-0 max-h-72 overflow-y-auto overscroll-contain p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">Tidak ada opsi ditemukan.</Command.Empty>
            {options.map((option) => (
              <Command.Item
                key={option.value}
                value={option.value}
                keywords={[option.label]}
                onSelect={() => {
                  onValueChange(option.value);
                  changeOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
              >
                <span className="min-w-0 flex-1 whitespace-normal break-words">{option.label}</span>
                {value === option.value && <Check aria-hidden="true" className="size-4 shrink-0" />}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Input, Textarea };

/** Format helpers */
export function formatRupiah(value: number | null | undefined): string {
  if (value == null) return "-";
  return `Rp${value.toLocaleString("id-ID")}`;
}

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (value == null) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null) return "-";
  return value.toLocaleString("id-ID", { maximumFractionDigits: digits });
}
