import type { Invoice } from "@/infrastructure/http/client-api";

export function InvoicePaymentAccount({ invoice }: { invoice: Pick<Invoice, "paymentBankName" | "paymentAccountNumber" | "paymentAccountName"> }) {
  if (!invoice.paymentBankName || !invoice.paymentAccountNumber || !invoice.paymentAccountName) return null;
  return <section className="invoice-payment-account mt-6 rounded-xl border p-4" aria-label="Rekening pembayaran">
    <h3 className="text-xs font-semibold">Rekening pembayaran</h3>
    <dl className="mt-3 grid min-w-0 gap-4 text-xs sm:grid-cols-3">
      <div className="min-w-0"><dt className="text-neutral-500">Bank</dt><dd className="mt-1 break-words font-semibold">{invoice.paymentBankName}</dd></div>
      <div className="min-w-0"><dt className="text-neutral-500">No. Rekening</dt><dd className="mt-1 break-all font-mono font-semibold">{invoice.paymentAccountNumber}</dd></div>
      <div className="min-w-0"><dt className="text-neutral-500">Nama Rekening</dt><dd className="mt-1 break-words font-semibold">{invoice.paymentAccountName}</dd></div>
    </dl>
  </section>;
}
