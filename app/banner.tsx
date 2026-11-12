import { GuideBanner } from '@/components/guide-banner';
import { requireSession } from '@/lib/auth';
import { DataError, loadBanners, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';

import { dismissBanner, skipDividend } from './dividends/actions';

/**
 * The in-app banner under the header, on every page: what waits on Hugo, worked out from what is
 * saved (lib/models/banners). Streamed after the page, so it never holds a page back; a failed
 * read shows nothing rather than an error on every page.
 */
export async function Banners() {
  const { supabase } = await requireSession();
  const banners = await orDataError(loadBanners(supabase, taipeiToday()));
  if (banners instanceof DataError || banners.length === 0) return null;
  return <GuideBanner banners={banners} dismiss={dismissBanner} skip={skipDividend} />;
}
