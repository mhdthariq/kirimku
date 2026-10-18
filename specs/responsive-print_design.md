# Responsive print documents

## Scope and acceptance
- All three printouts (invoice, transport manifest/surat jalan, shipment/package resi) fit narrow screen previews without clipping paper columns.
- Screen scaling must not affect print geometry, page breaks, or label count.
- A4 pages use real repeating page margins, not a 297mm minimum-height element with repeated padding (a WebKit overflow risk). Long documents may legitimately span pages.
- Manifest contains no prices; receipt and crew signatures have blank signing space; the tenant company name follows session branding rather than an arbitrary customer from a mixed-customer transport.
- The manifest document identification is a fixed print footer in the reserved bottom margin, repeated by paged browsers.

## Implementation
`PrintPreview` measures available width and paper content with ResizeObserver. It scales a screen-only wrapper and reserves its scaled height, also handling asynchronously loaded data and rotation. Print CSS removes every scaling wrapper and uses normal document flow. The resi also supplies an unnamed custom-size @page declaration for browsers without reliable named-page support, legacy page-break properties, and a fractional millimetre height allowance for WebKit rounding.

No new network services or dependencies. Preview only renders React-escaped existing document data; authorization, document loading and print audit paths remain unchanged. Payment changes have their own design note.

## Validation
Component tests cover 320/375/390/430px widths, desktop no-upscaling, rotation/content updates, all template wrappers, paper/page CSS, manifest contents and footer placement. API/component regression tests cover payment eligibility and verified-only balances. Physical Safari print/PDF rendering cannot be exercised in this Linux environment; device retesting is required. Browser/OS paper size support and user print settings can still override CSS, particularly custom 100mm thermal stock on AirPrint.
