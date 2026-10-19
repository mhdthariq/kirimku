# Paper templates

Paper layouts live in `src/components/app/print-templates/`:

- `InvoiceTemplate.tsx` — invoice paper.
- `TransportManifestTemplate.tsx` — manifest/surat jalan paper.
- `ResiTemplate.tsx` — 100 × 100 mm master/package labels.

Import templates as ordinary React components, rather than a `use.template` hook:

```tsx
import { InvoiceTemplate } from "@/components/app/print-templates/InvoiceTemplate";
import { PrintPreview } from "@/components/app/print-preview";

<PrintPreview paper="a4">
  <InvoiceTemplate
    invoice={invoice}
    displayCompanyName={companyName}
    printByLabel={accountName}
    printedAt={printedAt}
  />
</PrintPreview>
```

Controllers fetch data, capture a stable print timestamp, log print actions and call `printPaperDocument()`. Templates contain paper markup only. A4 templates have one sheet root, a header first and a footer; a nested manifest flow uses `data-paper-flow`. Pagination measures the original template at physical size in an isolated layout iframe. It repeats headers and footers, splits tables between rows, and includes totals only once. Preview scaling is applied outside the sheet. Printing uses those same pages, never a second responsive layout.

A4 is 210 × 297 mm with 12 mm internal padding and zero CSS page margins. Choose A4, scale 100%, no extra margins, and disable browser headers/footers in the print dialog. Label printing retains its separate 100 × 100 mm page size.
