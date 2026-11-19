/**
 * The opening screen, B (Hugo, 2026-11-19, chosen from three on a design canvas): ink black, in light
 * and dark alike, the first thing in the page and over everything. A forget-me-not glow fades in from
 * the top right and the mark's rising line is drawn along its faint track, once each (Ink: no motion
 * loops); the hairline at the foot shows how far the app has fetched every page a tab can open
 * (components/preload.tsx, which also lifts it). It matches the launch image an iPhone shows first
 * (app/layout.tsx `startupImage`, public/splash: the ground, the glow and the mark with its track), so
 * the line simply draws itself where the still left it. Nothing under it scrolls or can be touched
 * while it shows (globals.css). Once per opening: the script under it hides it at once on a reload
 * within the same visit. Should the scripts never run, it fades by itself (globals.css .splash).
 */

/** Marks this visit as opened once a page without the opening screen has loaded, and hides the screen on later loads. */
const OPENED = `try{var d=document.documentElement,s=sessionStorage;if(s.getItem('opened'))d.setAttribute('data-opened','');else if(!document.getElementById('splash'))s.setItem('opened','1')}catch(e){}`;

export function Splash({ show }: { show: boolean }) {
  return (
    <>
      {show && (
        <div id="splash" className="splash" role="status" aria-label="長期投資 載入中 Long-View Invest, loading">
          <div className="splash-glow" aria-hidden="true" />
          <div className="splash-mark">
            <svg width="120" height="120" viewBox="0 0 64 64" aria-hidden="true">
              <rect x="1.5" y="1.5" width="61" height="61" rx="15" className="splash-tile" />
              <polyline points="12,44 26,32 36,38 52,20" className="splash-track" />
              <polyline points="12,44 26,32 36,38 52,20" className="splash-line" />
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
