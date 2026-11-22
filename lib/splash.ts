/**
 * The launch images an iPhone shows while the app starts: opening screen B's first still (components/splash.tsx),
 * one per screen size, light and dark alike. iOS takes the one whose size
 * matches the phone exactly, and keeps it from the day the app is added to the home screen.
 * scripts/splash_images.ts draws the files into public/splash; app/layout.tsx links them.
 */

/** Each iPhone screen in portrait: its width and height in points, and its pixels per point. */
export const IPHONE_SCREENS: ReadonlyArray<readonly [width: number, height: number, ratio: number]> = [
  [440, 956, 3],
  [430, 932, 3],
  [428, 926, 3],
  [420, 912, 3],
  [414, 896, 3],
  [414, 896, 2],
  [402, 874, 3],
  [393, 852, 3],
  [390, 844, 3],
  [375, 812, 3],
  [375, 667, 2],
];

/** Opening screen B's ink black: the same in light and dark (globals.css .splash). */
export const SPLASH_GROUND = { light: '#070b09', dark: '#070b09' } as const;

export type SplashScheme = keyof typeof SPLASH_GROUND;

export interface LaunchImage {
  /** Where the file is served from, under public/. */
  url: string;
  /** The media query that picks it: one screen size, upright, one colour scheme. */
  media: string;
  width: number;
  height: number;
  ratio: number;
  scheme: SplashScheme;
}

export const LAUNCH_IMAGES: readonly LaunchImage[] = IPHONE_SCREENS.flatMap(([width, height, ratio]) =>
  (['light', 'dark'] as const).map((scheme) => ({
    url: `/splash/${width * ratio}x${height * ratio}-${scheme}.png`,
    media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})`,
    width,
    height,
    ratio,
    scheme,
  })),
);
