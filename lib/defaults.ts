import type { Market, ProductType, Security } from './models/types';

function mostCommon(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | undefined;
  for (const [value, count] of counts) if (best === undefined || count > (counts.get(best) ?? 0)) best = value;
  return best;
}

/**
 * The asset class that securities of the same kind already use, so a form can start on it:
 * same product type and market first, then the same product type anywhere. Undefined when
 * nothing similar exists yet; the form then asks.
 */
export function likelyAssetClass(securities: readonly Security[], productType: ProductType, market?: Market): string | undefined {
  const sameType = securities.filter((security) => security.productType === productType);
  const sameMarket = market === undefined ? [] : sameType.filter((security) => security.market === market);
  return mostCommon(sameMarket.map((security) => security.assetClassId)) ?? mostCommon(sameType.map((security) => security.assetClassId));
}
