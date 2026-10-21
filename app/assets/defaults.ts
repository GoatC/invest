import { likelyAssetClass } from '@/lib/defaults';
import type { AssetClass, Security } from '@/lib/models/types';

/** The class a new gold or cash entry starts on: the class of the matching ETF (GLDM, BIL), else the first class. */
export function assetClassDefaults(assetClasses: readonly AssetClass[], securities: readonly Security[]): Record<'gold' | 'cash_mmf', string> {
  const first = assetClasses[0]?.id ?? '';
  return {
    gold: likelyAssetClass(securities, 'gold') ?? first,
    cash_mmf: likelyAssetClass(securities, 'cash_mmf') ?? first,
  };
}
