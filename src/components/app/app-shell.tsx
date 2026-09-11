"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Coins,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  Receipt,
  Route,
  ShieldCheck,
  Tag,
  TrendingUp,
  Truck,
  UserCircle2,
  Users,
  Wallet,
  Wrench,
  CarFront,
  Warehouse,
  Briefcase,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasAnyPermission } from "@/lib/client-api";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { InstallAppMenuItem } from "@/components/app/pwa";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  anyPermissions?: string[];
  /** visible only to the owner (e.g. the Gudang master-data menu) */
  ownerOnly?: boolean;
  mobile?: boolean;
}

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Operasional",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true },
      { href: "/pickups", label: "Pickups", icon: Truck, anyPermissions: ["pickup.view", "pickup.assign_kurir"], mobile: true },
      { href: "/shipments", label: "Shipments", icon: Package, anyPermissions: ["shipment.view"], mobile: true },
      { href: "/deliveries", label: "Deliveries", icon: ClipboardList, anyPermissions: ["delivery.view", "delivery.assign_kurir"], mobile: true },
      // Revision Part I — transport = road linehaul between gudang → road Route icon
      { href: "/transports", label: "Transports", icon: Route, anyPermissions: ["transport.view"], mobile: true },
    ],
  },
  {
    title: "Gudang & Armada",
    items: [
      // Gudang master data is owner-only — staff gudang reach their gudang
      // workspace through Shipments (arrival scanning) instead.
      { href: "/gudang", label: "Gudang", icon: Warehouse, ownerOnly: true, mobile: false },
      { href: "/vehicles", label: "Kendaraan", icon: CarFront, anyPermissions: ["vehicle.view"] },
      { href: "/routes", label: "Rute & Checkpoint", icon: MapPin, anyPermissions: ["checkpoint.view"] },
    ],
  },
  {
    title: "Kantor",
    items: [
      { href: "/customers", label: "Customers", icon: Users, anyPermissions: ["customer.view"] },
      { href: "/tariffs", label: "Tarif", icon: Tag, anyPermissions: ["tariff.view"] },
      { href: "/invoices", label: "Invoice", icon: Receipt, anyPermissions: ["invoice.view"] },
      { href: "/unpaid", label: "B2C Belum Bayar", icon: Coins, anyPermissions: ["payment.unpaid.view"] },
    ],
  },
  {
    title: "Finance Partner",
    items: [
      // Revise.md §33/§34 — company-side financial management (permission-based)
      { href: "/finance", label: "Finance Dashboard", icon: Landmark, anyPermissions: ["financial.report.view"] },
      { href: "/topups", label: "Top Up Requests", icon: Receipt, anyPermissions: ["wallet.topup.view"] },
      { href: "/withdrawals", label: "Withdrawal Requests", icon: Landmark, anyPermissions: ["wallet.withdrawal.view"] },
      { href: "/settlements", label: "Partner Settlements", icon: TrendingUp, anyPermissions: ["transport.settle", "invoice.view"] },
      { href: "/repairs", label: "Repair Verification", icon: Wrench, anyPermissions: ["repair.view", "repair.create"] },
      { href: "/partners", label: "Partner Wallets", icon: Briefcase, anyPermissions: ["partner.view"] },
    ],
  },
  {
    title: "Administrasi",
    items: [
      { href: "/access", label: "Access Control", icon: ShieldCheck, anyPermissions: ["user.view", "role.view", "employee.view"] },
      { href: "/audit", label: "Audit Timeline", icon: History, anyPermissions: ["audit_log.view"] },
      { href: "/profile", label: "Profil", icon: UserCircle2 },
    ],
  },
];

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <a
      href={`#${item.href}`}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary-foreground" : "text-muted-foreground group-hover:text-accent-foreground")} />
      {item.label}
    </a>
  );
}

export function AppShell({
  path,
  children,
}: {
  path: string;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user) return null;

  // -----------------------------------------------------------------------
  // Revision Parts S/V/W/X — simplified navigation for operational roles:
  //   Kurir          → Dashboard, Pickups, Delivery
  //   Driver / Kenek → Dashboard, Transport, Transport History
  // Revise.md §31/§32 — partner navigation:
  //   Marketing      → Dashboard, Shipments, Customers, B2B, Wallet, Profile
  //   Vehicle Owner  → Dashboard, My Vehicles, Transport History, Earnings,
  //                     Repairs, Wallet, Profile
  // These roles use a simple bottom navigation on mobile (NO hamburger menu)
  // and a slim sidebar on desktop. Everyone else keeps the full menu.
  // -----------------------------------------------------------------------
  const roleSlugs = user.roles.map((r) => r.slug);
  const isKurir = roleSlugs.includes("kurir");
  const isDriverCrew = roleSlugs.includes("driver") || roleSlugs.includes("kenek");
  const isVehicleOwner = user.partnerType === "VEHICLE_OWNER";
  const isMarketingPartner = user.partnerType === "MARKETING" && roleSlugs.includes("marketing");
  const simplifiedOperational = isKurir || isDriverCrew || isVehicleOwner || isMarketingPartner;

  const OPERATIONAL_GROUPS: { title: string; items: NavItem[] }[] = isKurir
    ? [
        {
          title: "Operasional Kurir",
          items: [
            { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true },
            { href: "/pickups", label: "Pickups", icon: Truck, mobile: true },
            { href: "/deliveries", label: "Delivery", icon: ClipboardList, mobile: true },
          ],
        },
      ]
    : isVehicleOwner
      ? [
          {
            title: "Vehicle Owner",
            items: [
              { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true },
              { href: "/my-vehicles", label: "My Vehicles", icon: CarFront, mobile: true },
              { href: "/vo-transport-history", label: "Transport History", icon: History, mobile: true },
              { href: "/earnings", label: "Earnings", icon: TrendingUp },
            ],
          },
          {
            title: "Keuangan",
            items: [
              { href: "/repairs", label: "Repairs", icon: Wrench, mobile: true },
              { href: "/wallet", label: "Wallet", icon: Wallet, mobile: true },
              { href: "/profile", label: "Profil", icon: UserCircle2 },
            ],
          },
        ]
      : isMarketingPartner
        ? [
            {
              title: "Marketing",
              items: [
                { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true },
                { href: "/shipments", label: "Shipments", icon: Package, mobile: true },
                { href: "/customers", label: "Customers", icon: Users, mobile: true },
                { href: "/b2b", label: "B2B", icon: Briefcase, mobile: true },
              ],
            },
            {
              title: "Keuangan",
              items: [
                { href: "/wallet", label: "Wallet", icon: Wallet, mobile: true },
                { href: "/profile", label: "Profil", icon: UserCircle2 },
              ],
            },
          ]
        : [
            {
              title: "Operasional Driver",
              items: [
                { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true },
                { href: "/transports", label: "Transport", icon: Route, mobile: true },
                { href: "/transport-history", label: "Transport History", icon: History, mobile: true },
              ],
            },
          ];

  const groups = simplifiedOperational ? OPERATIONAL_GROUPS : NAV_GROUPS;

  const visibleGroups = groups.map((g) => ({
    ...g,
    items: g.items.filter(
      (item) =>
        (!item.ownerOnly || user.isOwner) &&
        (!item.anyPermissions || hasAnyPermission(user, item.anyPermissions)),
    ),
  })).filter((g) => g.items.length > 0);

  // bottom navigation = the operational roles' primary destinations;
  // everyone else keeps the ≤5 item mobile strip
  const mobileItems = simplifiedOperational
    ? visibleGroups
        .flatMap((g) => g.items)
        .filter((item, idx, arr) => item.mobile && arr.findIndex((x) => x.href === item.href) === idx)
        .slice(0, 5)
    : visibleGroups
        .flatMap((g) => g.items)
        .filter((item) => item.mobile)
        .slice(0, 5);

  const roleLabel = user.isOwner
    ? "Owner"
    : user.roles.map((r) => r.name).join(", ") || "Staff";

  async function handleLogout() {
    await logout();
    router.refresh();
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b px-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Navigasi utama">
          {visibleGroups.map((group) => (
            <div key={group.title}>
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={`${item.href}:${item.label}`}
                    item={item}
                    active={path.startsWith(item.href)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-2.5 py-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/15 text-[11px] font-bold text-primary">
                {user.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">{user.name}</p>
              <p className="truncate text-[10px] text-muted-foreground">{roleLabel}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={handleLogout}
              aria-label="Keluar"
              title="Keluar"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b bg-background/80 px-3 backdrop-blur-md sm:px-5">
          <div className="flex items-center gap-2">
            {/* Mobile: sheet menu — hidden for simplified operational roles
                (Revision Part X: they use the bottom navigation only) */}
            {!simplifiedOperational && (
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Buka menu navigasi">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="flex w-72 flex-col p-0">
                  <SheetTitle className="sr-only">Menu navigasi</SheetTitle>
                  <div className="flex h-16 items-center border-b px-5">
                    <Logo />
                  </div>
                  <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Navigasi utama (mobile)">
                    {visibleGroups.map((group) => (
                      <div key={group.title}>
                        <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                          {group.title}
                        </p>
                        <div className="space-y-0.5">
                          {group.items.map((item) => (
                            <NavLink
                              key={`${item.href}:${item.label}`}
                              item={item}
                              active={path.startsWith(item.href)}
                              onNavigate={() => setMenuOpen(false)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </nav>
                  <div className="shrink-0 border-t p-3">
                    <Button variant="outline" className="w-full" onClick={handleLogout}>
                      <LogOut className="h-4 w-4" /> Keluar
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            )}

            {/* Tablet/mobile: logo */}
            <div className="lg:hidden">
              <Logo compact />
            </div>
            <p className="hidden text-sm font-semibold text-foreground lg:block">
              {visibleGroups
                .flatMap((g) => g.items)
                .find((i) => path.startsWith(i.href))?.label ?? "Dashboard"}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-2.5 transition hover:bg-accent sm:pr-3"
                  aria-label="Menu akun"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary/15 text-[10px] font-bold text-primary">
                      {user.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[120px] truncate text-xs font-semibold text-foreground sm:block">
                    {user.name}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="text-xs font-normal text-muted-foreground">@{user.username}</p>
                </DropdownMenuLabel>
                <InstallAppMenuItem />
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" /> Keluar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="min-w-0 flex-1 px-3 pb-24 pt-4 sm:px-5 sm:pb-8 sm:pt-6 lg:px-7">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation — for operational roles this is THE
          navigation (no hamburger); persistent, safe-area aware, content
          padded via main's pb-24 (Revision Part X). */}
      {mobileItems.length > 0 && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-background/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
          aria-label="Navigasi bawah"
        >
          {mobileItems.map((item) => {
            const active = path.startsWith(item.href);
            return (
              <a
                key={`${item.href}:${item.label}`}
                href={`#${item.href}`}
                className={cn(
                  "flex min-w-[64px] flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </a>
            );
          })}
        </nav>
      )}
    </div>
  );
}
