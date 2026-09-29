"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { useHashRoute } from "@/hooks/use-hash-route";
import { AuthGate } from "@/components/app/auth-gate";
import { AppShell } from "@/components/app/app-shell";

import { DashboardPage } from "@/components/app/pages/dashboard-page";
import { KurirDashboard } from "@/components/app/pages/kurir-dashboard-page";
import { DriverDashboard } from "@/components/app/pages/driver-dashboard-page";
import { VehicleOwnerDashboard } from "@/components/app/pages/vo-dashboard-page";
import { ShipmentsPage } from "@/components/app/pages/shipments-page";
import { TransportsPage } from "@/components/app/pages/transports-page";
import { TransportDetailPage } from "@/components/app/pages/transport-detail-page";
import { VehiclesPage } from "@/components/app/pages/vehicles-page";
import { RoutesPage } from "@/components/app/pages/routes-page";
import { InvoicesPage } from "@/components/app/pages/invoices-page";
import { InvoiceDetailPage } from "@/components/app/pages/invoice-detail-page";
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

/**
 * Routing migration (docs/CLEAN_ARCHITECTURE_PLAN.md §3) — sections that
 * now have a real Next.js route under `app/(dashboard)/...`. Anyone who
 * still lands on the old `#/tariffs` etc. (an old bookmark, a link that
 * hasn't been updated yet) is bounced to the real route below. Add a
 * section here the same PR you delete its `case` from the switch and add
 * its `app/(dashboard)/<section>/page.tsx`.
 */
const MIGRATED_SECTIONS = new Set(["tariffs", "customers", "gudang", "pickups", "deliveries"]);

function Router() {
  const router = useRouter();
  const { segments, query } = useHashRoute();

  // Legacy redirect: the old "Gudang" operations menu (#/gudang-ops) was merged
  // into the Gudang master page (#/gudang) — arrival scanning now lives in
  // Shipments (Picked Up tab) and Isi Gudang is a tab of the Gudang page.
  useEffect(() => {
    if (segments[0] === "gudang-ops") {
      window.location.replace("#/gudang");
    }
  }, [segments]);

  // Routing migration redirect — send anyone still on a migrated section's
  // hash route to its real route instead (see MIGRATED_SECTIONS above).
  useEffect(() => {
    if (segments[0] && MIGRATED_SECTIONS.has(segments[0])) {
      router.replace(`/${segments[0]}`);
    }
  }, [segments, router]);

  return (
    <AuthGate>
      <RouterInner segments={segments} query={query} />
    </AuthGate>
  );
}

function RouterInner({ segments, query }: { segments: string[]; query: URLSearchParams }) {
  const { user } = useAuth();
  if (!user) return null;

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
        // Migrated to a real route (app/(dashboard)/pickups/page.tsx).
        return null;
      case "shipments":
        return <ShipmentsPage shipmentId={segments[1] ? Number(segments[1]) : null} autoPrint={query.get("print") === "1"} />;
      case "deliveries":
        // Migrated to a real route (app/(dashboard)/deliveries/page.tsx).
        return null;
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
      case "customers":
      case "tariffs":
        // Migrated to real routes (app/(dashboard)/<section>/page.tsx) —
        // the redirect effect above sends the browser to /<section>; render
        // nothing here for the one tick before that happens.
        return null;
      case "routes":
        return <RoutesPage routeId={segments[1] ? Number(segments[1]) : null} />;
      case "invoices":
        return segments[1] ? <InvoiceDetailPage invoiceId={Number(segments[1])} /> : <InvoicesPage />;
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
  return <Router />;
}
