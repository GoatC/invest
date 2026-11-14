import type { MetadataRoute } from 'next';

import { SPLASH_GROUND } from '@/lib/splash';

/**
 * The web app manifest, so a phone can add the app to its home screen and open it full screen
 * (PRD Section 6: a PWA). The icons are app/icon.svg drawn at the sizes phones ask for. It opens
 * on the weekly dashboard; public/sw.js, the service worker, shows Web Push (Phase 1, step 10).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Long-View Invest 長期投資',
    short_name: '長期投資',
    description: 'A 30-year core–satellite portfolio run on written rules. 依書面規則運行的 30 年核心／衛星投資組合。',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // The poster's colour (--hero-bg in globals.css, light): the ground of the opening screen, so
    // the screen a phone shows while the app starts runs into it (lib/splash.ts).
    background_color: SPLASH_GROUND.light,
    theme_color: SPLASH_GROUND.light,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
