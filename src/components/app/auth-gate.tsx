"use client";

import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { LoginScreen } from "@/components/app/login-screen";

/**
 * Shared "wait for session, then show login or content" guard.
 *
 * Extracted 2026-09-27 (Phase 2 of docs/CLEAN_ARCHITECTURE_PLAN.md) so the
 * legacy hash-router shell (`src/app/page.tsx`) and the new real-route
 * layout (`src/app/(dashboard)/layout.tsx`) show identical loading/login
 * states without duplicating the JSX — both routing systems share one
 * `AuthProvider` (mounted in the root layout), so a session started on one
 * carries over to the other with no extra fetch.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Memuat sesi…</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return <>{children}</>;
}
