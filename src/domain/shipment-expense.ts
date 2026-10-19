export function canEnterShipmentExpense(shipment: { customer: { type: string }; createdByPartnerId: number | null; status: string; destReceivedAt: Date | null }) {
  return shipment.customer.type.toLowerCase() === "b2b" && shipment.createdByPartnerId == null &&
    (shipment.status === "RECEIVED_AT_GUDANG" || (shipment.status === "ARRIVED_AT_GUDANG" && shipment.destReceivedAt != null));
}
