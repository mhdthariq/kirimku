"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useHashRoute } from "@/hooks/use-hash-route";
import { LoginScreen } from "@/components/app/login-screen";
import { AppShell } from "@/components/app/app-shell";
import { Loader2 } from "lucide-react";

import { DashboardPage } from "@/components/app/pages/dashboard-page";
import { KurirDashboard } from "@/components/app/pages/kurir-dashboard-page";
import { DriverDashboard } from "@/components/app/pages/driver-dashboard-page";
import { VehicleOwnerDashboard } from "@/components/app/pages/vo-dashboard-page";
import { PickupsPage } from "@/components/app/pages/pickups-page";
import { ShipmentsPage } from "@/components/app/pages/shipments-page";
import { DeliveriesPage } from "@/components/app/pages/deliveries-page";
import { TransportsPage } from "@/components/app/pages/transports-page";
import { TransportDetailPage } from "@/components/app/pages/transport-detail-page";
import { VehiclesPage } from "@/components/app/pages/vehicles-page";
import { GudangPage } from "@/components/app/pages/gudang-page";
import { RoutesPage } from "@/components/app/pages/routes-page";
import { CustomersPage } from "@/components/app/pages/customers-page";
import { TariffsPage } from "@/components/app/pages/tariffs-page";
import { InvoicesPage } from "@/components/app/pages/invoices-page";
import { AccessPage } from "@/components/app/pages/access-page";
import { AuditPage } from "@/components/app/pages/audit-page";
// Revise.md — partner wallet financial system pages
import { WalletPage } from "@/components/app/pages/wallet-page";
import { B2BCommissionsPage } from "@/components/app/pages/b2b-commissions-page";
import { MyVehiclesPage } from "@/components/app/pages/my-vehicles-page";
import { VOTransportHistoryPage } from "@/components/app/pages/vo-transport-history-page";
import { RepairsPage } from "@/components/app/pages/repairs-page";
import { FinancePage } from "@/components/app/pages/finance-page";
import { TopUpManagementPage } from "@/components/app/pages/topups-page";
import { WithdrawalManagementPage } from "@/components/app/pages/withdrawals-page";
import { SettlementsPage } from "@/components/app/pages/settlements-page";
import { PartnersPage } from "@/components/app/pages/partners-page";
import { ProfilePage } from "@/components/app/pages/profile-page";

function Router() {
  const { user, loading } = useAuth();
  const { segments, query } = useHashRoute();

  // Legacy redirect: the old "Gudang" operations menu (#/gudang-ops) was merged
  // into the Gudang master page (#/gudang) — arrival scanning now lives in
  // Shipments (Picked Up tab) and Isi Gudang is a tab of the Gudang page.
  useEffect(() => {
    if (segments[0] === "gudang-ops") {
      window.location.replace("#/gudang");
    }
  }, [segments]);

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

  const section = segments[0] ?? "dashboard";

  // Revision Part P — role-aware dashboard: kurir and driver/kenek get their
  // dedicated operational dashboards; Vehicle Owner gets the partner financial
  // dashboard (Revise.md §17); everyone else keeps the full dashboard.
  const roleSlugs = user.roles.map((r) => r.slug);
  const isKurir = roleSlugs.includes("kurir");
  const isDriverCrew = roleSlugs.includes("driver") || roleSlugs.includes("kenek");
  const isVehicleOwner = user.partnerType === "VEHICLE_OWNER";

  const page = (() => {
    switch (section) {
      case "pickups":
        return <PickupsPage />;
      case "shipments":
        return <ShipmentsPage shipmentId={segments[1] ? Number(segments[1]) : null} autoPrint={query.get("print") === "1"} />;
      case "deliveries":
        return <DeliveriesPage />;
      case "transports":
        // #/transports — list; #/transports/{id} — detail (Revision Part K)
        return segments[1] ? <TransportDetailPage transportId={Number(segments[1])} /> : <TransportsPage />;
      case "transport-history":
        // Revision Part V — driver/kenek transport history view
        return <TransportsPage historyMode />;
      case "vo-transport-history":
        // Revise.md §16 — Vehicle Owner transport history
        return <VOTransportHistoryPage />;
      case "earnings":
        // Revise.md §32 — Vehicle Owner earnings view (same page, earnings tab)
        return <VOTransportHistoryPage initialTab="earnings" />;
      case "vehicles":
        return <VehiclesPage />;
      case "my-vehicles":
        // Revise.md §13/§32 — Vehicle Owner's own vehicles
        return <MyVehiclesPage />;
      case "gudang":
        return <GudangPage />;
      case "routes":
        return <RoutesPage routeId={segments[1] ? Number(segments[1]) : null} />;
      case "customers":
        return <CustomersPage />;
      case "tariffs":
        return <TariffsPage />;
      case "invoices":
        return <InvoicesPage />;
      case "access":
        return <AccessPage />;
      case "audit":
        return <AuditPage />;
      // ----- Revise.md — partner wallet financial system -------------------
      case "wallet":
        return <WalletPage />;
      case "b2b":
        return <B2BCommissionsPage />;
      case "repairs":
        return <RepairsPage />;
      case "finance":
        return <FinancePage />;
      case "topups":
        return <TopUpManagementPage />;
      case "withdrawals":
        return <WithdrawalManagementPage />;
      case "settlements":
        return <SettlementsPage />;
      case "partners":
        return <PartnersPage />;
      case "profile":
        return <ProfilePage />;
      default:
        if (isKurir) return <KurirDashboard />;
        if (isDriverCrew) return <DriverDashboard />;
        if (isVehicleOwner) return <VehicleOwnerDashboard />;
        return <DashboardPage />;
    }
  })();

  return (
    <AppShell path={`/${segments.join("/")}`}>
      <AnimatePresence mode="wait">
        <motion.div
          key={section}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {page}
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
