"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, LockKeyhole, LogIn, MapPin, Package, ShieldCheck, Truck, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoMark } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";

const DEMO_ACCOUNTS = [
  { username: "owner", password: "ChangeMeOwner#2026", label: "Owner", hint: "Akses penuh, semua gudang" },
  { username: "budi", password: "Demo#Pass2026", label: "Budi", hint: "Marketing · Gudang Jakarta" },
  { username: "hendra", password: "Demo#Pass2026", label: "Hendra", hint: "Vehicle Owner · 2 kendaraan" },
  { username: "siti", password: "Demo#Pass2026", label: "Siti", hint: "Admin Kantor" },
  { username: "agus", password: "Demo#Pass2026", label: "Agus", hint: "Admin Gudang · Jakarta" },
  { username: "ratna", password: "Demo#Pass2026", label: "Ratna", hint: "Admin Gudang · Bandung" },
  { username: "wawan", password: "Demo#Pass2026", label: "Wawan", hint: "Staff Gudang · Jakarta" },
  { username: "dewi", password: "Demo#Pass2026", label: "Dewi", hint: "Kurir" },
];

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      // always land on the dashboard — the previous user's hash (e.g. a
      // transport detail the new user has no access to) must not leak
      window.location.hash = "#/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function quickFill(acc: (typeof DEMO_ACCOUNTS)[number]) {
    setUsername(acc.username);
    setPassword(acc.password);
    setBusy(true);
    setError(null);
    try {
      await login(acc.username, acc.password);
      window.location.hash = "#/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-primary dark:bg-[#075740] lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 20%, #ffffff 1.5px, transparent 1.5px), radial-gradient(circle at 75% 60%, #ffffff 1.5px, transparent 1.5px)",
            backgroundSize: "56px 56px, 84px 84px",
          }}
        />
        <div aria-hidden className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-black/15 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="rounded-2xl bg-white p-1.5 shadow-lg">
            <LogoMark className="h-10 w-10" />
          </div>
          <div className="leading-none">
            <p className="text-xl font-bold tracking-tight text-white">
              Kirim<span className="text-primary-foreground/90">Ku</span>
            </p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/80">
              Shipment Management
            </p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-[34px] font-bold leading-[1.15] tracking-tight text-white xl:text-[40px]">
            Kendalikan seluruh perjalanan kiriman Anda dari satu tempat.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/85">
            Dari pickup kurir, penyimpanan gudang, transport antar kota dengan checkpoint GPS,
            hingga delivery dan settlement — semuanya terlacak dan teraudit.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              { icon: Package, label: "End-to-end tracking" },
              { icon: MapPin, label: "GPS checkpoints" },
              { icon: ShieldCheck, label: "Audit trail penuh" },
            ].map((f) => (
              <div key={f.label} className="rounded-xl bg-white/10 p-3 backdrop-blur-sm">
                <f.icon className="h-5 w-5 text-white" />
                <p className="mt-2 text-[11px] font-semibold leading-tight text-white/90">{f.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex items-center gap-6 border-t border-white/15 pt-6">
            <div>
              <p className="text-2xl font-bold text-white">6</p>
              <p className="text-[11px] text-white/80">Status lifecycle</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">3+</p>
              <p className="text-[11px] text-white/80">Checkpoint per rute</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">24/7</p>
              <p className="text-[11px] text-white/80">Monitoring</p>
            </div>
          </div>
        </div>

        <p className="relative text-[11px] text-white/65">
          © 2026 KirimKu · Sistem manajemen pengiriman internal
        </p>
      </div>

      {/* Form panel */}
      <div className="relative flex min-h-screen flex-col bg-background">
        <div className="absolute right-4 top-4 lg:right-8 lg:top-8">
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="w-full max-w-sm"
          >
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <LogoMark className="h-11 w-11" />
              <div className="leading-none">
                <p className="text-lg font-bold tracking-tight text-foreground">
                  Kirim<span className="text-primary">Ku</span>
                </p>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Shipment Management
                </p>
              </div>
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-foreground">Masuk ke akun Anda</h2>
            <p className="mt-1.5 text-sm text-foreground/70">
              Gunakan username dan password Anda. Sesi berlaku 12 jam.
            </p>

            <form onSubmit={onSubmit} className="mt-7 space-y-4">
              {error && (
                <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/60" />
                  <Input
                    id="username"
                    className="pl-9"
                    placeholder="mis. owner"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/60" />
                  <Input
                    id="password"
                    type="password"
                    className="pl-9"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={busy}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                {busy ? "Memproses…" : "Masuk"}
              </Button>
            </form>

            <div className="mt-8">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-foreground/70">
                  Akun demo
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    onClick={() => quickFill(acc)}
                    disabled={busy}
                    className="group rounded-xl border bg-card px-3 py-2.5 text-left transition hover:border-primary/50 hover:bg-accent disabled:opacity-50"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      {acc.username === "owner" ? (
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                      ) : acc.label === "Dewi" ? (
                        <Truck className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <User className="h-3.5 w-3.5 text-primary" />
                      )}
                      {acc.label}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-foreground/70">{acc.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
