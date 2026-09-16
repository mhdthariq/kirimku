# Kirimku: Shipment & Logistics Management System

Web-based application for managing shipments and day-to-day logistics operations.

The project covers shipment creation, pickup and delivery, warehouse operations, transport, routes and checkpoints, pricing, payments, invoices, user access, and activity logs. Data is scoped by warehouse so staff only work with the operational data assigned to their warehouse, while the Owner can access all warehouses.

## Tech Stack

- Next.js 16
- TypeScript
- Tailwind CSS 4
- shadcn/ui
- Prisma
- SQLite (default)
- Leaflet
- Bun (recommended)

The database can be moved to Supabase Postgres when needed. See `.env.example` and `docs/02-database.md`.

More detailed documentation is available in [`docs/`](docs/).

---

## Getting Started

### Requirements

Make sure you have:

- Bun installed
- Node.js installed if you prefer npm instead of Bun

### 1. Install dependencies

```bash
bun install
```

### 2. Create the database

```bash
bun run db:push
```

This creates the local SQLite database at `db/custom.db`.

### 3. Add demo data

```bash
bun run db:seed
```

The seed command is optional. The application can seed an empty database automatically when the API is first used.

### 4. Start the development server

```bash
bun run dev
```

Then open:

```text
http://localhost:3000
```

### Using npm instead

```bash
npm install
npx prisma db push --accept-data-loss
npx tsx prisma/seed.ts
npm run dev
```

---

## Environment

Copy the example environment file if you need to change the default configuration:

```bash
cp .env.example .env
```

By default, the application uses:

```text
db/custom.db
```

For Supabase Postgres configuration, see:

- `.env.example`
- [`docs/02-database.md`](docs/02-database.md)

---

## Updating an Existing Installation

If you have already run an older version of the project, update the generated Prisma Client and database before starting the application.

Some older versions used different Prisma relations, including:

- `VehicleAssignment.driver`
- `Transport.kenek`
- `TransportShipment.master`
- `HandoverScan` for QR handover records

If you see errors such as `Unknown field "driver"` or `Unknown field "master"`, clean the old generated files and sync the current schema.

```bash
# Stop the development server first

rm -rf .next
rm -rf node_modules/.prisma

bun install
bun run db:push
bun run db:seed
bun run dev
```

On Windows PowerShell, you can remove the directories with:

```powershell
Remove-Item -Recurse -Force .next
Remove-Item -Recurse -Force node_modules\.prisma
```

For a completely clean setup, use a fresh copy of the project and follow the Getting Started section above.

> The project does not include `db/custom.db` in the repository, so a fresh copy starts with a new local database.

---

## Demo Accounts

The seed data includes the following accounts:

| Username | Password | Role | Scope |
|---|---|---|---|
| `owner` | `ChangeMeOwner#2026` | Owner | All warehouses |
| `siti` | `Demo#Pass2026` | Admin Kantor | Gudang Jakarta |
| `budi` | `Demo#Pass2026` | Marketing | Gudang Jakarta |
| `agus` | `Demo#Pass2026` | Admin Gudang | Gudang Jakarta |
| `ratna` | `Demo#Pass2026` | Admin Gudang | Gudang Bandung |
| `wawan` | `Demo#Pass2026` | Staff Gudang | Gudang Jakarta Pusat |
| `dewi` | `Demo#Pass2026` | Kurir | Gudang Jakarta |
| `rizky` | `Demo#Pass2026` | Kurir | Gudang Jakarta |
| `joko` | `Demo#Pass2026` | Driver | Gudang Jakarta |
| `andi` | `Demo#Pass2026` | Kenek | Gudang Jakarta |

> These accounts are for local/demo use only. Change the passwords before using the application outside a development environment.

---

## Warehouse Data Scope

Each employee is assigned to a warehouse through `Employee.warehouseId`.

Operational data is filtered using that warehouse assignment:

- Shipments
- Pickups
- Deliveries
- Transports
- Warehouse operations

Staff cannot access another warehouse's operational shipment data, including by opening a shipment directly through its URL. The API enforces the warehouse scope.

The Owner can access all warehouses and switch between warehouse views.

Some master data remains available across warehouses because it is not tied to a single warehouse, including:

- Customers
- Tariffs
- Invoices
- Vehicles
- Routes

The exact data-access rules are documented in the project documentation.

---

## Main Features

### Shipment

- Shipment master and package/detail records
- Shipment lifecycle tracking
- Customer and recipient information
- Weight and volume calculation
- Configurable volumetric multiplier
- Pricing calculated by the server
- Shipment cancellation
- Shipment tracking timeline

Shipment status flow:

```text
CREATED
  → READY_FOR_PICKUP
  → PICKED_UP
  → RECEIVED_AT_GUDANG
  → IN_TRANSPORT
  → ARRIVED_AT_GUDANG
  → DELIVERED
```

### Pickup and Delivery

- Pickup assignment to couriers
- QR-based package handover
- Package-by-package scanning
- Pickup status remains `PICKED_UP` until the package reaches the warehouse
- Delivery proof with photo and location
- Remaining payment can be recorded during pickup

### Warehouse Operations

- Queue for packages picked up by couriers
- QR scanning using a phone camera
- Keyboard-wedge reader support
- Manual code entry
- Walk-in package receiving
- Warehouse package overview
- Notification for shipments that still need payment

For security and operational reasons, package QR/code values are not displayed directly in the scanning interface.

### Routes and Checkpoints

- Route management
- Checkpoint management
- Leaflet-based map editor
- Configurable checkpoint radius
- At least three checkpoints per route
- Location and photo records for checkpoint activity

### Pricing

The volumetric weight calculation is configurable per tariff:

```text
L × W × H / 1,000,000 × multiplier
```

The application uses the server-calculated price when creating a shipment.

Routes are selected from active tariffs instead of manually entering origin and destination cities. Available tariffs are filtered by customer type.

### QR and Shipment Printing

The application supports QR-based shipment handover and printing.

Printed documents include:

- Shipment receipt
- Individual package/detail receipt
- QR code
- Recipient information
- Weight
- Volume
- Package count
- Sender and contact information
- Warehouse customer-service contact

### Access Control

The application uses role-based access control with granular permissions.

The Owner can manage permissions for system roles from:

```text
Access Control → Roles
```

Employees are also assigned to warehouses through:

```text
Access Control → Employees
```

### Audit Logs

Activity logs are available for supported modules and can be filtered by entity type.

API endpoint:

```text
GET /audit-logs?entityType=...
```

### Responsive UI

The interface is designed for:

- Desktop
- Laptop
- Tablet
- Mobile

It also supports light and dark themes.

### PWA

The application includes PWA support:

- Web app manifest
- Application icons
- Service worker
- Install option
- iOS Add to Home Screen instructions

---

## Database Seeder

Seed data is defined in:

```text
prisma/seed.ts
src/lib/seed.ts
```

The seed data is intended for development and testing.

It includes:

| Entity | Count |
|---|---:|
| Users | 9 |
| Employees | 9 |
| Warehouses | 3 |
| Vehicles | 3 |
| Routes | 2 |
| Checkpoints | 6 |
| Tariffs | 4 |
| Customers | 5 |
| Shipments | 6 |
| Shipment Details | 8 |
| Pickups | 4 |
| Deliveries | 1 |
| Transports | 1 |
| Invoices | 1 |
| Payments | 4 |
| Audit Logs | 12 |

Useful database commands:

```bash
bun run db:push
bun run db:seed
bunx prisma studio
```

To start with a completely empty SQLite database, remove:

```text
db/custom.db
```

Then run:

```bash
bun run db:push
bun run db:seed
```

---

## Project Structure

```text
.
├── db/
│   └── custom.db
├── docs/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── public/
│   └── logo.svg
├── src/
│   ├── app/
│   │   ├── api/v1/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   ├── hooks/
│   └── lib/
├── .env.example
└── package.json
```

The main API is under:

```text
src/app/api/v1/
```

The application logic and shared helpers are under:

```text
src/lib/
```

---

## API

The API uses bearer-token authentication.

Authentication:

```text
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Other main endpoints include:

```text
GET /api/v1/dashboard
GET /api/v1/options

/customers
/shipments
/pickups
/deliveries
/transports
/vehicles
/warehouses
/routes
/checkpoints
/tariffs
/invoices
/payments
/users
/roles
/employees
```

Shipment operations include:

```text
/shipments/:id/tracking
/shipments/:id/price
/shipments/:id/ready
/shipments/:id/cancel
/shipments/:id/payments
```

Other operational actions include:

```text
/pickups/:id/confirm
/deliveries/:id/complete
/transports/:id/depart
/transports/:id/arrive
/payments/:id/verify
/payments/:id/reject
```

B2C unpaid shipments:

```text
GET /api/v1/unpaid
```

API responses use a simple structure:

```json
{
  "data": {}
}
```

or:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Error message"
  }
}
```

---

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | Start the development server |
| `bun run build` | Create a production build |
| `bun run start` | Start the production build |
| `bun run lint` | Run ESLint |
| `bun run db:push` | Sync Prisma schema to SQLite |
| `bun run db:seed` | Seed development data |
| `bun run db:generate` | Generate Prisma Client |

---

## Documentation

Project documentation is kept in [`docs/`](docs/).

The documentation covers:

- Application architecture
- Database schema
- API reference
- Frontend structure
- Business workflows
- Seeder and test data
- Deployment
