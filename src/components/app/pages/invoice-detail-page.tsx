"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiGet, type Invoice, type InvoiceLine } from "@/lib/client-api";
import { InvoicePrint } from "@/components/app/invoice-print";
import { Button } from "@/components/ui/button";

export function InvoiceDetailPage({ invoiceId }: { invoiceId: number }) {
  const [invoice, setInvoice] = useState<(Invoice & { lines: InvoiceLine[]; customer?: { companyName?: string | null; address?: string | null; email?: string | null; phone?: string | null } }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Invoice & { lines: InvoiceLine[] }>(`/invoices/${invoiceId}`)
      .then(setInvoice)
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat invoice."));
  }, [invoiceId]);

  if (error) {
    return <div className="space-y-4"><Button variant="ghost" onClick={() => (window.location.hash = "#/invoices")}><ArrowLeft className="h-4 w-4" /> Kembali ke Invoice</Button><p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive">{error}</p></div>;
  }

  if (!invoice) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return <InvoicePrint invoice={invoice} onClose={() => (window.location.hash = "#/invoices")} />;
}
