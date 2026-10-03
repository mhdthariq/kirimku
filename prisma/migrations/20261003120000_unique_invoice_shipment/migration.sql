-- A shipment must not be billed on more than one invoice.
CREATE UNIQUE INDEX "InvoiceLine_shipmentId_key" ON "InvoiceLine"("shipmentId");