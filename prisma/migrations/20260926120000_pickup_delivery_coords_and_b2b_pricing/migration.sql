-- Fixes/Features (2026-09-26):
--   1) Pickup & Delivery coordinates, so the kurir map can plot pickup (red)
--      and delivery (green) points.
--   2) B2B pricing methods: PER_KG (existing, still the only method B2C
--      uses), PER_KOLI, PER_CUBIC — chosen per tariff.
-- All changes are additive (nullable columns / columns with defaults) and
-- safe to run on an existing database without data loss.

-- AlterTable: Pickup coordinates
ALTER TABLE "Pickup" ADD COLUMN     "latitude" DOUBLE PRECISION;
ALTER TABLE "Pickup" ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable: Delivery coordinates
ALTER TABLE "Delivery" ADD COLUMN     "latitude" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable: Tariff — B2B pricing method (kg / koli / cubic)
ALTER TABLE "Tariff" ADD COLUMN     "pricingMethod" TEXT NOT NULL DEFAULT 'PER_KG';
ALTER TABLE "Tariff" ADD COLUMN     "ratePerKoli" DOUBLE PRECISION;
ALTER TABLE "Tariff" ADD COLUMN     "ratePerCubic" DOUBLE PRECISION;
ALTER TABLE "Tariff" ADD COLUMN     "minChargeableKoli" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "Tariff" ADD COLUMN     "minChargeableM3" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable: MasterShipment — snapshot of the pricing method/quantity used
-- at pricing time (mirrors the existing ratePerKg / chargeableWeightKg
-- snapshot pattern so historical shipments stay correct even if the tariff
-- changes later).
ALTER TABLE "MasterShipment" ADD COLUMN     "pricingMethod" TEXT;
ALTER TABLE "MasterShipment" ADD COLUMN     "chargeableKoli" DOUBLE PRECISION;
ALTER TABLE "MasterShipment" ADD COLUMN     "chargeableVolumeM3" DOUBLE PRECISION;
