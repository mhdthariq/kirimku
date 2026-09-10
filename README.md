# Shipment & Logistics Management System

Aplikasi manajemen logistik pengiriman (shipment management) yang dibangun ulang dengan standar UI/UX modern: responsif penuh (desktop / tablet / ponsel), mode terang & gelap, CRUD berbasis modal, peta Leaflet untuk checkpoint, RBAC, audit trail, **pemisahan data antar gudang** (setiap karyawan hanya melihat data gudangnya; hanya Owner yang melihat semua gudang), dan **database seeder mock-up lengkap**.

Dibangun dengan **Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui + Prisma (SQLite)** — siap dialihkan ke **Supabase Postgres** (lihat `.env.example` dan `docs/02-database.md`).

> 📚 **Dokumentasi lengkap ada di folder [`docs/`](docs/)** — arsitektur, skema database, referensi API, frontend, alur bisnis, seeder, dan deployment.

---

## ⚡ Quick Start (dengan Bun)

```bash
# 1. Install dependensi
bun install

# 2. Buat database dari schema Prisma (otomatis membuat db/custom.db)
bun run db:push

# 3. (Opsional) Jalankan seeder mock-up secara eksplisit
bun run db:seed

# 4. Jalankan aplikasi
bun run dev
```

> **Catatan:** langkah 3 opsional — aplikasi **menyimpan data otomatis pada request API pertama** setelah database dibuat (perilaku *migrate + seed on boot*). `db:seed` tersedia jika ingin menjalankan seeder secara manual/CI.

> 🛡️ **Prisma Client selalu segar:** script `dev` dan `postinstall` otomatis menjalankan `prisma generate` — client Prisma selalu dibuat ulang dari `prisma/schema.prisma` terbaru, sehingga error seperti `Unknown field "driver" for include statement` (client Prisma basi dari versi lama) **tidak akan terjadi lagi**.

### Konfigurasi environment

Salin `.env.example` → `.env` bila ingin mengubah database:

```bash
cp .env.example .env
```

Default: SQLite lokal (`db/custom.db`, zero-config). Ingin memakai **Supabase Postgres**? Semua varian connection string (direct / session pooler / transaction pooler) sudah disiapkan di `.env.example` — panduan langkah-demi-langkah ada di **[docs/02-database.md](docs/02-database.md)**.

Buka http://localhost:3000 lalu login dengan salah satu akun demo di bawah.

### Alternatif tanpa Bun (npm / Node)

```bash
npm install
npx prisma db push --accept-data-loss
npx tsx prisma/seed.ts        # butuh: npm i -D tsx (opsional — auto-seed berjalan otomatis)
npm run dev
```

---

## 🔄 Upgrade dari Versi Sebelumnya (WAJIB BACA)

Pernah menjalankan versi lama project ini di folder yang sama? Error seperti **`Unknown field 'driver' for include statement on model 'VehicleAssignment'`** atau **`Unknown field 'master' ... on model 'TransportShipment'`** berarti Prisma Client dan database Anda masih memakai schema lama. Schema terbaru menambahkan relasi `driver`/`kenek` (Employee) pada `VehicleAssignment` & `Transport`, mengganti nama relasi `TransportShipment.shipment` → `master`, dan menambah tabel `HandoverScan` untuk alur QR.

Lakukan urutan ini di folder project Anda:

```bash
# 1. Matikan dev server, lalu bersihkan hasil build & client lama
#    (Windows PowerShell: Remove-Item -Recurse -Force .next, node_modules\.prisma)
rm -rf .next
rm -rf node_modules/.prisma

# 2. Install ulang + regenerasi client (postinstall menjalankan prisma generate)
bun install            # atau: npm install

# 3. Sinkronkan schema baru ke database + seed ulang (idempoten)
bun run db:push        # atau: npx prisma db push --accept-data-loss
bun run db:seed        # atau: npx tsx prisma/seed.ts

# 4. Jalankan ulang
bun run dev
```

> Alternatif paling bersih: **ekstrak zip terbaru ke folder baru** dan ikuti Quick Start dari awal — database lama tidak dibawa serta (zip tidak menyertakan `db/custom.db`), sehingga tidak ada sisa schema lama.

---

## 🌱 Database Seeder (Mock-up Data)

Seeder berada di **`prisma/seed.ts`** (entry CLI) dan **`src/lib/seed.ts`** (rutin yang sama, dipanggil otomatis oleh API saat database kosong). Seeder bersifat **idempoten** — aman dijalankan berulang kali tanpa menduplikasi data.

Data mock-up yang dibuat:

| Entitas | Jumlah | Keterangan |
|---|---|---|
| Users | 9 | 1 owner + 8 staff dengan role berbeda (termasuk Admin Gudang Bandung) |
| Employees | 9 | Lengkap dengan posisi, nomor pegawai & **penempatan gudang** |
| Gudang | 3 | Jakarta Pusat, Bandung, Surabaya (tanpa field `type`) |
| Vehicles | 3 | Engkel Box, CDD, Fuso (1 status MAINTENANCE) |
| Routes | 2 | JKT–BDG, JKT–SBY |
| Checkpoints | 6 | 3 per rute, dengan koordinat + radius |
| Tariffs | 4 | Kombinasi rute × tipe customer (b2b/b2c) |
| Customers | 5 | Campuran b2b & b2c |
| Shipments | 6 | Melintasi seluruh lifecycle status |
| Shipment Details | 8 | Item barang dengan berat/dimensi |
| Pickups | 4 | Kurir Dewi Lestari |
| Deliveries | 1 | Completed dengan proof of delivery |
| Transports | 1 | Status DEPARTED + assignment vehicle |
| Invoices | 1 | Dengan 2 baris tagihan |
| Payments | 4 | Berbagai metode & status |
| Audit Logs | 12 | Riwayat aktivitas lintas modul |

Perintah seeder & database:

```bash
bun run db:push     # sinkronkan schema ke database (SQLite)
bun run db:seed     # jalankan seeder mock-up manual
bunx prisma studio  # Inspect database lewat browser
```

Reset total (hapus db lama mulai dari nol): hapus file `db/custom.db` → `bun run db:push` → `bun run db:seed`.

---

## 🔑 Akun Demo

| Username | Password | Role | Akses |
|---|---|---|---|
| `owner` | `ChangeMeOwner#2026` | Owner | Semua menu & permission — **satu-satunya yang melihat data SEMUA gudang** + tab per-gudang |
| `siti` | `Demo#Pass2026` | Admin Kantor | Operasional kantor, pembayaran, invoice — data Gudang Jakarta |
| `budi` | `Demo#Pass2026` | Marketing | Customer & shipment — data Gudang Jakarta |
| `agus` | `Demo#Pass2026` | Admin Gudang | Route, transport, scan kedatangan — data Gudang Jakarta |
| `ratna` | `Demo#Pass2026` | Admin Gudang | Data **Gudang Bandung** saja — untuk demo isolasi data antar gudang |
| `wawan` | `Demo#Pass2026` | Staff Gudang | Data Gudang Jakarta Pusat saja (scoped) |
| `dewi` | `Demo#Pass2026` | Kurir | Pickup & delivery — data Gudang Jakarta |
| `rizky` | `Demo#Pass2026` | Kurir | Pickup & delivery — data Gudang Jakarta |
| `joko` | `Demo#Pass2026` | Driver | Transport — data Gudang Jakarta |
| `andi` | `Demo#Pass2026` | Kenek | Transport — data Gudang Jakarta |

Semua password staff menggunakan `Demo#Pass2026`.

---

## 🏭 Pemisahan Data Antar Gudang

Setiap **karyawan** (employee) ditugaskan ke **satu gudang** lewat field `Employee.warehouseId` — kolom **Gudang Penempatan** di halaman Access Control → Employees. Semua data operasional dipisah berdasarkan gudang tersebut:

- **Shipments, Pickups, Deliveries, Transports** — hanya menampilkan data gudang sendiri. Staff di Jakarta tidak bisa melihat data Gudang Bandung (demikian juga sebaliknya), termasuk saat membuka detail shipment lewat URL (API menolak dengan 403).
- **Hanya Owner** yang melihat data semua gudang. Di menu Shipments / Pickups / Deliveries / Transports, Owner mendapat tab **`Daftar | Gudang A | Gudang B | Gudang C | … | Log Aktivitas`** — satu tab per gudang untuk menelusuri data masing-masing.
- **Role lain** tetap memakai layout `Daftar | Log Aktivitas` — datanya otomatis dibatasi ke gudang tempat karyawan bertugas (badge "Data gudang Anda: …" tampil di header halaman).
- **Dashboard, Log Aktivitas, B2C Belum Bayar** juga mengikuti scope gudang. Data master kantor (customer, tarif, invoice, kendaraan, rute) tetap lintas gudang karena bukan data operasional gudang.
- **Menu Gudang** (master gudang + Isi Gudang) hanya tampil untuk Owner. Staff Gudang bekerja lewat menu Shipments (tombol Terima / Scan).
- Karyawan tanpa gudang tidak melihat data operasional apa pun — pastikan setiap employee diberi gudang.

Aturan kepemilikan data mengikuti lokasi fisik paket pada lifecycle: status sebelum transport milik gudang asal; `IN_TRANSPORT` terlihat oleh kedua gudang ujung rute; setelah tiba/terkirim milik gudang tujuan. Transport linehaul terlihat oleh gudang asal & tujuan rutenya.

---

## ✨ Fitur Utama

1. **Responsif penuh** — sidebar desktop, drawer tablet, bottom navigation + layout kartu di ponsel.
2. **Mode terang & gelap** — toggle tema persisten (next-themes).
3. **Logo & branding** — logo mock-up di kiri atas.
4. **CRUD lengkap dengan modal** — Pickup, Delivery, Tarif, Invoice, Transport, Vehicle, Gudang, Route, Checkpoint, Customer, Access Control: tombol "Tambah" membuka dialog form (bukan form inline di bawah tabel).
5. **Editor checkpoint Leaflet** — klik peta untuk menempatkan titik, atur radius (minimum 3 checkpoint per rute, tanpa batas maksimum).
6. **Audit log per menu** — timeline global + tab "Log Aktivitas" di setiap modul.
7. **Gudang tanpa istilah "Gateway" / field `type`** — schema database bersih.
8. **Login page modern** — panel brand + quick-fill akun demo.
9. **RBAC** — 6 role sistem dengan permission granular; **owner bisa mengedit permission role sistem apa pun langsung dari UI** (Access Control → Roles) tanpa perlu membuat role baru.
10. **Lifecycle shipment lengkap** — CREATED → READY_FOR_PICKUP → PICKED_UP → RECEIVED_AT_GUDANG → IN_TRANSPORT → ARRIVED_AT_GUDANG → DELIVERED, plus pricing, pembayaran, tracking timeline.
11. **Alur QR scan handover** — kurir hanya melihat task yang ditugaskan padanya (`?mine=true`); tombol aksi membuka dialog **scan QR per detail barang** (paket) — semua paket harus ter-scan sebelum konfirmasi; tracking otomatis menampilkan **"Picked-up by [Nama Kurir]"** dan **"Delivered to [Customer] by [Kurir] — received by: [PoD]"**. Dialog juga me-render QR per paket sehingga bisa dites dengan kamera ponsel.
12. **Perhitungan harga dengan multiplier configurable (Rev. 3)** — formula volumetrik `L × W × H / 1.000.000 × multiplier` (kg/m³, diatur per tarif di menu Tariffs); UI memakai **pratinjau harga terhitung server** (tidak ada angka hardcode lagi); tombol **"Hitung Ulang Harga"** tersedia untuk memperbaiki snapshot lama.
13. **Rute dari dropdown tarif (Rev. 3)** — membuat shipment tidak lagi mengetik Kota Asal/Tujuan; pilih rute dari daftar tarif aktif yang **otomatis difilter sesuai tipe customer (B2B hanya melihat rute B2B, B2C hanya B2C)**; kota asal/tujuan + aturan tarif terisi otomatis.
14. **1 baris = 1 paket dengan kode unik (Rev. 3)** — input "Karton Tulis" jumlah 10 → dibuat 10 baris dengan 10 kode unik (`DTL-…-01` s/d `-10`); halaman detail punya tab **Semua** (semua paket) dan **Ringkas** (digabung per deskripsi & dimensi — murni tampilan, database tetap 1 baris per paket).
15. **Alur kedatangan gudang (Rev. 4)** — menu **Gudang** (antara Pickups & Shipments): antrean paket PICKED_UP yang dibawa kurir; Admin Gudang scan tiap paket / tombol **Scan Semua** (mode reader) / **walk-in** (customer serah langsung, tanpa scan); halaman **Isi Gudang** menghitung paket per gudang + **Notify Marketing** untuk kiriman belum lunas.
16. **Scan kamera / reader / ketik — kode disembunyikan (Rev. 4)** — scan pakai **kamera HP** (jsQR) atau **reader tool** (keyboard-wedge, auto-terdeteksi) atau **ketik manual**; kode paket & QR **tidak pernah ditampilkan** dan paste diblokir; kamera & reader tercatat **Scanned**, ketik manual tercatat **Typed** di Riwayat Scan.
17. **Cetak Resi (Rev. 4)** — **Resi Shipment** (untuk customer: no. resi + QR + kode, Penerima, Berat, Volume, jumlah Detail) + **Resi Detail per paket** (QR + kode, Penerima, berat & volume per paket, pcs `001/004`, Pengirim + telp) — nama perusahaan di bagian atas keduanya + CS tiap gudang; otomatis terbuka saat **Submit for Pickup**.
18. **Penerima & kolom Volume/Berat (Rev. 4)** — data Penerima (nama/alamat/kontak) per shipment; tabel shipment kini: Resi · Customer & Rute · Detail · Harga · **Volume** · **Berat** · Dibuat · Status · Aksi; tab status lengkap (All/Created/Ready/Picked/**Arrive at Gudang**/In Transport/Delivered/Cancelled).
19. **Aturan DP & gate pickup (Rev. 4)** — shipment **tidak bisa di-submit untuk pickup sebelum harga dihitung**; paket hanya boleh dijemput setelah **DP ≥ 50%**; kurir bisa mencatat **sisa pembayaran saat pickup**; cancel shipment selalu dengan **dialog konfirmasi**.
20. **PWA — bisa di-install (Rev. 4)** — manifest + icon + service worker; item "Install App" di menu akun (iOS: instruksi Add to Home Screen); layout responsif terverifikasi desktop/laptop/tablet/ponsel.

---

## 📁 Struktur Project

```
├── db/                     # Database SQLite (dibuat oleh db:push)
├── docs/                   # 📚 Dokumentasi lengkap (7 dokumen)
├── prisma/
│   ├── schema.prisma       # 21 model — domain logistik lengkap
│   └── seed.ts             # Seeder CLI (mock-up data)
├── public/
│   └── logo.svg            # Logo mock-up
├── src/
│   ├── app/
│   │   ├── api/v1/         # REST API (auth, shipments, pickups, dst.)
│   │   ├── layout.tsx
│   │   └── page.tsx        # Aplikasi SPA (hash-routed)
│   ├── components/         # UI components (shadcn/ui + AppShell)
│   ├── hooks/
│   └── lib/                # auth, rbac, audit, seed, api-helpers, dll.
├── .env.example            # Template environment (SQLite / Supabase Postgres)
└── package.json
```

## 🔌 Ringkasan API (`/api/v1`)

Autentikasi bearer-token (12 jam). Endpoint utama:

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET /dashboard` — statistik + grafik lifecycle
- `GET /options` — dropdown options (gudang, vehicle, route, customer, tariff)
- CRUD: `/customers`, `/shipments` (+ `/tracking`, `/price`, `/ready`, `/cancel`, `/payments`), `/pickups` (+ `/confirm`), `/deliveries` (+ `/complete`), `/transports` (+ `/depart`, `/arrive`), `/vehicles`, `/warehouses`, `/routes`, `/checkpoints`, `/tariffs`, `/invoices` (+ `/lines`, `/send`, `/settlements`), `/payments` (+ `/verify`, `/reject`)
- `GET /unpaid` — daftar B2C belum dibayar
- `/users`, `/roles`, `/employees` — access control
- `GET /audit-logs?entityType=...` — audit trail dengan filter per modul

Response standar: `{ "data": ... }` atau `{ "error": { "code", "message" } }`.

## 🧰 Scripts

| Perintah | Fungsi |
|---|---|
| `bun run dev` | Development server (port 3000) |
| `bun run build` | Production build |
| `bun run start` | Jalankan production build |
| `bun run lint` | ESLint |
| `bun run db:push` | Sinkronkan schema Prisma → SQLite |
| `bun run db:seed` | Jalankan seeder mock-up |
| `bun run db:generate` | Generate ulang Prisma Client |
