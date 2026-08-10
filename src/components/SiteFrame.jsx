import { useEffect, useRef } from 'react';

// Embeds the target assessment site using Electron's <webview> tag.
// <webview> is a full, isolated browser view (not an iframe), so sites that
// block iframing (X-Frame-Options) — including Google — still load here.
// `key={url}` forces a clean remount whenever a new URL is loaded from the bar.
//
// We also subscribe to the webview's OWN navigation events, so link clicks and
// in-page (SPA) navigation inside the site are reported back to the app — not
// just the URL typed into the address bar.
export default function SiteFrame({ url, onNavigate }) {
  const webviewRef = useRef(null);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return undefined;

    // Full page load / link click to a new page.
    const onDidNavigate = (e) => onNavigate?.(e.url);
    // History pushState / hash change (SPAs like Google results, ChatGPT).
    const onInPage = (e) => {
      if (e.isMainFrame) onNavigate?.(e.url); // ignore iframe/ad sub-navigations
    };

    wv.addEventListener('did-navigate', onDidNavigate);
    wv.addEventListener('did-navigate-in-page', onInPage);
    return () => {
      wv.removeEventListener('did-navigate', onDidNavigate);
      wv.removeEventListener('did-navigate-in-page', onInPage);
    };
    // `url` is in the deps so we re-attach to the fresh element after a remount.
  }, [url, onNavigate]);

  return (
    <div className="site-frame">
      <webview
        ref={webviewRef}
        key={url}
        src={url}
        className="webview"
        allowpopups="true"
        partition="persist:assessment"
      />
    </div>
  );
}
