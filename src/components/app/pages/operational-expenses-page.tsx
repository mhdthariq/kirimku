"use client";

import { useAuth } from "@/hooks/use-auth";
import { hasPermission } from "@/infrastructure/http/client-api";
import { DashboardHeading } from "@/components/app/dashboard-ui";
import { OperationalExpensesPanel } from "@/components/app/operational-expense-report";

export function OperationalExpensesPage() {
  const { user } = useAuth();
  const canView = hasPermission(user, "financial.report.view");
  return <div className="dashboard-workspace mx-auto min-w-0 max-w-[1600px] space-y-6"><DashboardHeading eyebrow="Finance" title="Biaya Operasional" description={canView ? "Rincian pengeluaran transport berdasarkan kategori dan status persetujuan." : "Anda tidak memiliki izin melihat laporan biaya operasional."} />{canView && <OperationalExpensesPanel register />}</div>;
}
