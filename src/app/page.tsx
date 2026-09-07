"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useHashRoute } from "@/hooks/use-hash-route";
import { LoginScreen } from "@/components/app/login-screen";
import { AppShell } from "@/components/app/app-shell";
import { Loader2 } from "lucide-react";

import { DashboardPage } from "@/components/app/pages/dashboard-page";
import { PickupsPage } from "@/components/app/pages/pickups-page";
import { ShipmentsPage } from "@/components/app/pages/shipments-page";
import { DeliveriesPage } from "@/components/app/pages/deliveries-page";
import { TransportsPage } from "@/components/app/pages/transports-page";
import { VehiclesPage } from "@/components/app/pages/vehicles-page";
import { GudangPage } from "@/components/app/pages/gudang-page";
import { RoutesPage } from "@/components/app/pages/routes-page";
import { CustomersPage } from "@/components/app/pages/customers-page";
import { TariffsPage } from "@/components/app/pages/tariffs-page";
import { InvoicesPage } from "@/components/app/pages/invoices-page";
import { UnpaidPage } from "@/components/app/pages/unpaid-page";
import { AccessPage } from "@/components/app/pages/access-page";
import { AuditPage } from "@/components/app/pages/audit-page";

function Router() {
  const { user, loading } = useAuth();
  const { segments } = useHashRoute();

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

  const page = (() => {
    switch (section) {
      case "pickups":
        return <PickupsPage />;
      case "shipments":
        return <ShipmentsPage shipmentId={segments[1] ? Number(segments[1]) : null} />;
      case "deliveries":
        return <DeliveriesPage />;
      case "transports":
        return <TransportsPage />;
      case "vehicles":
        return <VehiclesPage />;
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
      case "unpaid":
        return <UnpaidPage />;
      case "access":
        return <AccessPage />;
      case "audit":
        return <AuditPage />;
      default:
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
