-- Nullable additions only: existing evidence and web clients remain valid.
ALTER TABLE "TransportActivity"
  ADD COLUMN "locationLabel" TEXT,
  ADD COLUMN "timeZone" TEXT,
  ADD COLUMN "mockLocation" BOOLEAN;

ALTER TABLE "CheckpointRecord"
  ADD COLUMN "locationLabel" TEXT,
  ADD COLUMN "timeZone" TEXT,
  ADD COLUMN "capturedAt" TIMESTAMP(3),
  ADD COLUMN "mockLocation" BOOLEAN,
  ADD COLUMN "locationAccuracy" DOUBLE PRECISION;

ALTER TABLE "TransportExpense"
  ADD COLUMN "locationLabel" TEXT,
  ADD COLUMN "timeZone" TEXT,
  ADD COLUMN "capturedAt" TIMESTAMP(3),
  ADD COLUMN "mockLocation" BOOLEAN;

-- Do not confuse planned task coordinates with capture coordinates.
ALTER TABLE "Pickup"
  ADD COLUMN "locationLabel" TEXT,
  ADD COLUMN "timeZone" TEXT,
  ADD COLUMN "capturedAt" TIMESTAMP(3),
  ADD COLUMN "mockLocation" BOOLEAN,
  ADD COLUMN "captureLatitude" DOUBLE PRECISION,
  ADD COLUMN "captureLongitude" DOUBLE PRECISION,
  ADD COLUMN "captureAccuracy" DOUBLE PRECISION;

ALTER TABLE "Delivery"
  ADD COLUMN "locationLabel" TEXT,
  ADD COLUMN "timeZone" TEXT,
  ADD COLUMN "capturedAt" TIMESTAMP(3),
  ADD COLUMN "mockLocation" BOOLEAN,
  ADD COLUMN "captureLatitude" DOUBLE PRECISION,
  ADD COLUMN "captureLongitude" DOUBLE PRECISION,
  ADD COLUMN "captureAccuracy" DOUBLE PRECISION;
