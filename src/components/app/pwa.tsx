"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import {
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

/**
 * PWA registration + install entry point.
 * - registers /sw.js (icons cached offline; UI stays network-first so dev
 *   iterations are never stale)
 * - surfaces "Install App" when the browser fires beforeinstallprompt
 * - iOS Safari has no prompt: shows "Add to Home Screen" instructions
 */
const PwaContext = createContext<{ promptInstall: () => void }>({ promptInstall: () => undefined });

type InstallPromptEvent = Event & { prompt: () => Promise<void> };

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isSecure = window.location.protocol === "https:" || window.location.hostname === "localhost";
    if ("serviceWorker" in navigator && isSecure) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => undefined);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop the mini-infobar; we show our own menu item
      setInstallEvent(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  return (
    <PwaContext.Provider value={{ promptInstall: () => void installEvent?.prompt() }}>{children}</PwaContext.Provider>
  );
}

export function usePwa() {
  return useContext(PwaContext);
}

/** Dropdown item injected into the account menu: Install App / iOS hint. */
export function InstallAppMenuItem() {
  const { promptInstall } = usePwa();
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(display-mode: standalone)").matches : false,
  );
  const [isIos] = useState(() =>
    typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent),
  );

  useEffect(() => {
    const onPrompt = () => setCanInstall(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (isInstalled) return null;

  if (canInstall) {
    return (
      <button
        className="relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
        onClick={promptInstall}
      >
        <Download className="h-4 w-4" /> Install App di Perangkat Ini
      </button>
    );
  }

  if (isIos) {
    return (
      <DropdownMenuLabel className="text-xs font-normal leading-relaxed text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <SquarePlus className="h-3.5 w-3.5" /> Instal di iOS:
        </span>
        ketuk Share <Share className="inline h-3 w-3" /> → <b>Add to Home Screen</b>
      </DropdownMenuLabel>
    );
  }

  return null;
}
