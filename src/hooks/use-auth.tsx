"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, getCorpId, getToken, setCorpId, setToken, type SessionUser } from "@/lib/client-api";

interface CompanyInfo {
  name: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  /** Display name for the currently logged-in tenant (from the Corporate ID
   *  license lookup), or null when running without one (local/demo mode). */
  companyName: string | null;
  login: (corpId: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch the current user from /auth/me — call after the user edits
   *  their own profile (name, etc.) so the header/sidebar reflects the
   *  change without requiring a re-login. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await apiGet<SessionUser & { company?: CompanyInfo }>("/auth/me");
        if (!cancelled) {
          setUser(me);
          setCompanyName(me.company?.name ?? null);
        }
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (corpId: string, username: string, password: string) => {
    // Set the Corporate ID before the request so it goes out as the
    // `x-corp-id` header the backend uses to resolve the tenant database.
    const trimmedCorpId = corpId.trim();
    setCorpId(trimmedCorpId || null);
    try {
      const data = await apiPost<{ token: string; user: SessionUser; company?: CompanyInfo }>("/auth/login", {
        corpId: trimmedCorpId,
        username,
        password,
      });
      setToken(data.token);
      setUser(data.user);
      setCompanyName(data.company?.name ?? null);
    } catch (err) {
      // Bad corp id / credentials — don't leave a half-set session around.
      setCorpId(null);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost("/auth/logout");
    } catch {
      // token may already be invalid — proceed with local cleanup
    }
    setToken(null);
    setCorpId(null);
    setUser(null);
    setCompanyName(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!getToken()) return;
    try {
      const me = await apiGet<SessionUser & { company?: CompanyInfo }>("/auth/me");
      setUser(me);
      setCompanyName(me.company?.name ?? null);
    } catch {
      // keep the existing user object on refresh failure
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, companyName, login, logout, refreshUser }),
    [user, loading, companyName, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export { getCorpId };
