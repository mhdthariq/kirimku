-- Keep Tariff.id and all shipment references. Date-only validity includes its final day.
UPDATE "Tariff"
SET "effectiveTo" = "effectiveTo" + INTERVAL '1 day' - INTERVAL '1 millisecond'
WHERE "effectiveTo" = date_trunc('day', "effectiveTo");

UPDATE "Tariff" SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "isActive" AND "effectiveTo" < CURRENT_TIMESTAMP;

-- Retain every historical row; the newest active version reserves the name.
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "origin", "destination", COALESCE("customerType", ''),
                 COALESCE("customerId", 0), COALESCE("name", '')
    ORDER BY "createdAt" DESC, "id" DESC
  ) AS position
  FROM "Tariff" WHERE "isActive"
)
UPDATE "Tariff" SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM ranked WHERE position > 1);

-- A Boolean in a normal unique key would also prohibit multiple inactive versions.
CREATE UNIQUE INDEX "Tariff_active_identity_key" ON "Tariff" (
  "origin", "destination", COALESCE("customerType", ''),
  COALESCE("customerId", 0), COALESCE("name", '')
) WHERE "isActive" = true;
