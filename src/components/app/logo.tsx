"use client";

/** Mock-up brand logo (SVG box-truck mark). Replace public/logo.svg with the real asset later. */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
     
    <img src="/logo.svg" alt="Logo KirimKu" className={className} />
  );
}

export function Logo({ href = "#/dashboard", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <a href={href} className="flex items-center gap-2.5 group" aria-label="KirimKu — beranda">
      <div className="relative">
        <LogoMark className={compact ? "h-8 w-8" : "h-9 w-9 transition-transform group-hover:scale-105"} />
      </div>
      {!compact && (
        <div className="leading-none">
          <span className="block text-[17px] font-bold tracking-tight text-foreground">
            Kirim<span className="text-primary">Ku</span>
          </span>
          <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Shipment Management
          </span>
        </div>
      )}
    </a>
  );
}
