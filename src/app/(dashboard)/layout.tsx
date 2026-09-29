"use client";

import { usePathname } from "next/navigation";
import { AuthGate } from "@/components/app/auth-gate";
import { AppShell } from "@/components/app/app-shell";

/**
 * Layout for real Next.js routes (docs/CLEAN_ARCHITECTURE_PLAN.md §3).
 *
 * Mirrors what `src/app/page.tsx` (the legacy hash-router shell) does —
 * `AuthGate` then `AppShell` — but feeds `AppShell` the real pathname via
 * `usePathname()` instead of the hash-derived path, so nav active-states
 * and the page title work identically on both routing systems. Both share
 * one `AuthProvider` (mounted in the root layout), so moving between a
 * migrated route and a still-hash-routed one doesn't re-fetch the session.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AuthGate>
      <AppShell path={pathname}>{children}</AppShell>
    </AuthGate>
  );
}
