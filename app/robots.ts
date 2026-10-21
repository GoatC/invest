import type { MetadataRoute } from 'next';

/** A personal portfolio: no search engine should list any of it. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
