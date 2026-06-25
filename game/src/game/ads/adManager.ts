import { createDummyAdProvider } from './dummyProvider';
import type { AdCreative, AdOpportunity, AdPlacementRequest, AdProvider } from './types';

export class AdManager {
  constructor(private readonly provider: AdProvider = createDummyAdProvider()) {}

  getPlacements(request: AdPlacementRequest): AdCreative[] {
    try {
      return this.provider.getPlacements(request);
    } catch {
      return [];
    }
  }

  recordOpportunity(opportunity: AdOpportunity): void {
    try {
      this.provider.recordOpportunity(opportunity);
    } catch {
      // Ad opportunities must never block gameplay.
    }
  }
}

export function createAdManager(provider?: AdProvider): AdManager {
  return new AdManager(provider);
}
