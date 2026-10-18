export interface PaymentShipment {
  paymentTrackingEnabled?: boolean;
  customer?: { type: string } | null;
  priceAmount: number | null;
  finalPriceAmount: number | null;
  payments?: { amount: number; status: string }[];
}

export function tracksShipmentPayments(shipment: Pick<PaymentShipment, "paymentTrackingEnabled" | "customer">): boolean {
  return shipment.paymentTrackingEnabled === true && shipment.customer?.type === "b2c";
}

/** RECORDED is awaiting verification; REJECTED is never money received. */
export function shipmentPaymentTotals(shipment: PaymentShipment) {
  const total = shipment.finalPriceAmount ?? shipment.priceAmount;
  const paid = (shipment.payments ?? []).reduce((sum, payment) => sum + (payment.status === "VERIFIED" ? payment.amount : 0), 0);
  const remaining = total == null ? 0 : Math.max(0, total - paid);
  const status = total == null ? "UNPRICED" : remaining === 0 ? "PAID" : paid > 0 ? "DP" : "UNPAID";
  const label = { UNPRICED: "Belum dihitung", UNPAID: "Belum Lunas", DP: "Sebagian", PAID: "Lunas" }[status];
  return { total, paid, remaining, status, label };
}
