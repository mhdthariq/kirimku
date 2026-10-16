"use client";

import Image from "next/image";
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
    return (
        <span className={`relative inline-block shrink-0 ${className}`}>
            <Image
                src="/nova-icon-light.png"
                alt="Logo NovaLogistik"
                fill
                sizes="40px"
                className="object-contain dark:hidden"
            />
            <Image
                src="/nova-icon-dark.png"
                alt="Logo NovaLogistik"
                fill
                sizes="40px"
                className="hidden object-contain dark:block"
            />
        </span>
    );
}

export function Logo({
    href = "#/dashboard",
    compact = false,
}: {
    href?: string;
    compact?: boolean;
}) {
    return (
        <a
            href={href}
            className="flex items-center gap-2.5 group"
            aria-label="NovaLogistik - beranda"
        >
            <div className="relative">
                <LogoMark
                    className={
                        compact
                            ? "h-8 w-8"
                            : "h-9 w-9 transition-transform group-hover:scale-105"
                    }
                />
            </div>
            {!compact && (
                <div className="leading-none">
                    <span className="block text-[17px] font-bold tracking-tight text-foreground">
                        Nova<span className="text-primary">Logistik</span>
                    </span>
                    <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Shipment Management
                    </span>
                </div>
            )}
        </a>
    );
}
