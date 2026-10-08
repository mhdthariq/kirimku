import { db } from "@/infrastructure/persistence/db";
import type { PricingRepository } from "@/application/pricing/pricing-repository";

export const prismaPricingRepository: PricingRepository = {
  findActiveTariffById(id, at) {
    return db.tariff.findFirst({
      where: {
        id,
        isActive: true,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      },
    });
  },

  findMatchingActiveTariff(selection, at) {
    return db.tariff.findFirst({
      where: {
        origin: selection.origin,
        destination: selection.destination,
        isActive: true,
        effectiveFrom: { lte: at },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
          { OR: [{ customerType: selection.customer.type }, { customerType: null }] },
          // Never fall back to a tariff belonging to another customer.
          { OR: [{ customerId: null }, { customerId: selection.customerId ?? -1 }] },
        ],
      },
      orderBy: [{ customerType: "desc" }, { effectiveFrom: "desc" }],
    });
  },
};
