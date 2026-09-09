# Changes — Responsive layout, camera scan fix, Gudang scan shortcut, PWA review

## 1. Responsive layout (Desktop / Laptop / Tablet / Handphone)

- **`src/components/ui/dialog.tsx`** and **`src/components/ui/alert-dialog.tsx`**:
  dialogs previously had no max-height, so any form taller than the phone's
  viewport (e.g. the "Buat Shipment" or "Tambah Paket" dialogs) got cut off
  with no way to scroll to the submit button. Added
  `max-h-[calc(100dvh-2rem)]` + `overflow-y-auto`, tightened side margins on
  small screens (`max-w-[calc(100%-1.5rem)]`), and reduced padding on mobile
  (`p-4` → `sm:p-6`). This fixes every dialog in the app at once.
- **`access-page.tsx`, `tariffs-page.tsx`, `vehicles-page.tsx`,
  `invoices-page.tsx`, `shipments-page.tsx`**: several dialog forms used
  `grid-cols-2` / `grid-cols-3` with no responsive breakpoint, forcing two
  fields side-by-side even on a 360px phone screen. Changed to
  `grid-cols-1 … sm:grid-cols-2` so fields stack on phones and pair up from
  tablet width (640px) up.
- **`invoices-page.tsx`**: the invoice line-items table inside the detail
  dialog was wrapped in `overflow-hidden`, which clipped columns instead of
  letting them scroll on narrow screens. Changed to `overflow-x-auto` with a
  `min-w` on the table.
- Audited the rest of the app (dashboard, data table, app shell, checkpoint
  map editor, login screen, resi print) — these already had solid responsive
  patterns (table → card on mobile, sidebar → sheet + bottom nav, etc.), so
  I left them as-is rather than rewriting working code.

## 2. Camera scan fix

- **`src/components/app/scan-console.tsx`**: the root cause — `getUserMedia()`
  resolved, then the code immediately tried `videoRef.current.srcObject = stream`
  in the same synchronous block. But the `<video>` element only renders once
  `cameraOn` becomes `true`, and React hadn't committed that DOM update yet,
  so `videoRef.current` was still `null`. The permission prompt worked (camera
  light turned on) but no frame was ever attached to the video element, so
  jsQR never received image data — the scanner looked "broken" with no
  preview and no scans.
  Fix: moved the stream attachment into a `useEffect` keyed on `cameraOn`,
  which runs after the `<video>` element is actually mounted, so
  `videoRef.current` is guaranteed to be valid before `srcObject` is set and
  `.play()` is called.

## 3. "Scan Kedatangan" button beside "Buat Shipment"

The scan-to-arrive workflow (PICKED_UP → scan every package → RECEIVED_AT_GUDANG,
shown in the UI as "Arrive at Gudang") already existed in the Gudang menu. I
extracted it into a shared component and added a quick-access entry point:

- **`src/components/app/arrival-scan-dialog.tsx`** (new): the camera / reader /
  manual scan dialog + "Scan Semua Paket" + confirm, extracted from
  `gudang-ops-page.tsx` so it can be reused without duplicating ~200 lines.
- **`src/components/app/pages/gudang-ops-page.tsx`**: now imports
  `ArrivalScanDialog` from the shared file instead of defining it locally.
  No behavior change here — the Gudang → Kedatangan tab works exactly as
  before.
- **`src/components/app/pages/shipments-page.tsx`**: added a **"Scan
  Kedatangan"** button next to **"Buat Shipment"**, visible only to users
  with the `shipment.confirm_arrival` permission (Admin Gudang and anyone
  else granted it). Clicking it opens a picker listing every shipment
  currently `PICKED_UP` (i.e. a kurir is bringing it back to the gudang) with
  a live scan-progress bar per shipment. Picking one opens the same
  camera/reader/manual scan flow used in the Gudang menu; once every package
  is scanned, "Konfirmasi Tiba di Gudang" flips the shipment's status. Every
  scan is still tagged `SCANNED` (camera/reader) vs `TYPED` (manual) exactly
  like the driver pickup/delivery flow, visible in Riwayat Scan.
  No backend changes were needed — this reuses the existing
  `GET /gudang`, `POST /shipments/{id}/arrival-scans`,
  `POST /shipments/{id}/arrival-scan-all`, and `POST /shipments/{id}/arrive`
  endpoints and their permission checks.

## 4. PWA

Reviewed the existing PWA setup — it was already complete: manifest with all
icon sizes (192/512/maskable/apple-touch), `display: standalone`, a
cache-first/network-first service worker, an install-prompt handler for
Android/desktop Chrome, and "Add to Home Screen" instructions for iOS Safari
(which has no install prompt API). No changes were needed here. To test:

- **Android (Chrome)**: open the site, tap the account menu → "Install App
  di Perangkat Ini" (or the browser's own install banner).
- **iPhone (Safari)**: open the site in Safari (not Chrome — iOS only
  supports installing PWAs from Safari), tap Share → "Add to Home Screen".

Both require the app to be served over **HTTPS** (or `localhost` during
development) — `getUserMedia` (camera scanning) also requires a secure
context, so make sure whatever host you deploy to has a valid TLS
certificate.

## Notes on verification

This environment has no network access, so I couldn't run `bun install` /
`next build` / a live dev server to visually confirm the fixes. I instead:
- Parsed every edited file (and the full `src/` tree — 161 files) with the
  TypeScript compiler's parser to catch syntax errors — all clean.
- Manually cross-checked every import against its usage in each file I
  touched or refactored.

I'd still recommend running `bun install && bun dev` yourself and clicking
through the flows (especially the camera scan on an actual phone, since
`getUserMedia` behavior varies by browser) before shipping.
