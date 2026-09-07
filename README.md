# Shipment & Logistics Management System

Aplikasi manajemen logistik pengiriman (shipment management) yang dibangun ulang dengan standar UI/UX modern: responsif penuh (desktop / tablet / ponsel), mode terang & gelap, CRUD berbasis modal, peta Leaflet untuk checkpoint, RBAC, audit trail, dan **database seeder mock-up lengkap**.

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
npx tsx prisma/seed.ts        # butuh: npm i -D tsx
npm run dev
```

---

## 🌱 Database Seeder (Mock-up Data)

Seeder berada di **`prisma/seed.ts`** (entry CLI) dan **`src/lib/seed.ts`** (rutin yang sama, dipanggil otomatis oleh API saat database kosong). Seeder bersifat **idempoten** — aman dijalankan berulang kali tanpa menduplikasi data.

Data mock-up yang dibuat:

| Entitas | Jumlah | Keterangan |
|---|---|---|
| Users | 8 | 1 owner + 7 staff dengan role berbeda |
| Employees | 8 | Lengkap dengan posisi & nomor pegawai |
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
| `owner` | `ChangeMeOwner#2026` | Owner | Semua menu & permission |
| `siti` | `Demo#Pass2026` | Admin Kantor | Operasional kantor, pembayaran, invoice |
| `budi` | `Demo#Pass2026` | Marketing | Customer & shipment |
| `agus` | `Demo#Pass2026` | Admin Gudang | Gudang, route, transport |
| `dewi` | `Demo#Pass2026` | Kurir | Pickup & delivery |
| `rizky` | `Demo#Pass2026` | Kurir | Pickup & delivery |
| `joko` | `Demo#Pass2026` | Driver | Transport |
| `andi` | `Demo#Pass2026` | Kenek | Transport |

Semua password staff menggunakan `Demo#Pass2026`.

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
