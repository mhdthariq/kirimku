"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/** Theme toggle — icons switch via CSS so there is no hydration flash. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Ganti tema terang/gelap"
      title={isDark ? "Ganti ke mode terang" : "Ganti ke mode gelap"}
      className={className}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <Sun className="hidden h-5 w-5 dark:block" />
      <Moon className="block h-5 w-5 dark:hidden" />
    </Button>
  );
}
