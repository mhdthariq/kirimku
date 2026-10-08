import { createPricingService } from "@/application/pricing/pricing-service";
import { prismaPricingRepository } from "@/infrastructure/pricing/prisma-pricing-repository";

export type { PricingPreview } from "@/application/pricing/pricing-repository";

// Compatibility composition facade; application code depends only on its repository port.
const pricing = createPricingService(prismaPricingRepository);

export const resolveTariff = pricing.resolveTariff;
export const pricingPreview = pricing.pricingPreview;
export const computeServerPricing = pricing.computeServerPricing;
