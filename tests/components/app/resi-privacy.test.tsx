// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ResiTemplate, type ResiShipment } from "@/components/app/print-templates/ResiTemplate";

it("masks sender and recipient addresses and phones on master and child labels", () => {
  const shipment = {
    masterCode: "MKT-1", origin: "Jakarta", destination: "Bandung", createdAt: new Date().toISOString(),
    pengirimName: "Sender", pengirimPhone: "081234567890", pengirimAddress: "Jalan Mawar 123",
    penerimaName: "Recipient", penerimaContact: "089876543210", penerimaAddress: "Jalan Mawar 123",
    customer: { type: "b2b", name: "Sender" }, details: [{ id: 1, detailCode: "CHILD-1", description: "Box", actualWeightKg: 1 }],
  } as ResiShipment;
  render(<ResiTemplate shipment={shipment} options={null} qrMap={{}} printByLabel={null} printedAt={new Date()} />);
  expect(screen.queryByText(/081234567890|089876543210|Jalan Mawar 123/)).not.toBeInTheDocument();
  expect(screen.getAllByText("Telp: 081234******")).toHaveLength(2);
  expect(screen.getAllByText("Telp: 089876******")).toHaveLength(2);
  expect(screen.getAllByText("Jalan M********")).toHaveLength(4);
});
