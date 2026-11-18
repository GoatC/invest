/**
 * The opening screen (Hugo, 2026-11-13): the mark and the name on the poster's own colour, the
 * first thing in the page, over everything. It stays while the app fetches every
 * page a tab can open (components/preload.tsx, which also lifts it) and shows how far that is. It
 * matches the launch image an iPhone shows before the page arrives (app/layout.tsx `startupImage`,
 * public/splash), so the two read as one screen. Once per opening: the script under it hides it at
 * once on a reload within the same visit. Should the scripts never run, it fades by itself
 * (globals.css .splash).
 */

/** Marks this visit as opened once a page without the opening screen has loaded, and hides the screen on later loads. */
const OPENED = `try{var d=document.documentElement,s=sessionStorage;if(s.getItem('opened'))d.setAttribute('data-opened','');else if(!document.getElementById('splash'))s.setItem('opened','1')}catch(e){}`;

export function Splash({ show }: { show: boolean }) {
  return (
    <>
      {show && (
        <div id="splash" className="splash" role="status" aria-label="長期投資 載入中 Long-View Invest, loading">
          <div className="splash-mark">
            <svg width="88" height="88" viewBox="0 0 64 64" aria-hidden="true">
              <rect width="64" height="64" rx="15" fill="var(--hero-text)" />
              <polyline points="12,44 26,32 36,38 52,20" fill="none" stroke="var(--hero-bg)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span lang="zh-Hant">長期投資</span>
          </div>
          <div className="splash-progress" aria-hidden="true">
            <span />
          </div>
        </div>
      )}
      <script dangerouslySetInnerHTML={{ __html: OPENED }} />
    </>
  );
}
