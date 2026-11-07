-- Package lists, counts and totals repeatedly look up packages by shipment.
-- Run outside a transaction so writes can continue during index creation.
CREATE INDEX CONCURRENTLY "DetailShipment_masterId_idx"
ON "DetailShipment" ("masterId");
