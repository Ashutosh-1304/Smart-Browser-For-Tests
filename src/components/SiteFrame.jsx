import { useEffect, useRef } from 'react';

export default function SiteFrame({ url, onNavigate }) {
  const webviewRef = useRef(null);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return undefined;

    const onDidNavigate = (e) => onNavigate?.(e.url);
    const onInPage = (e) => {
      if (e.isMainFrame) onNavigate?.(e.url);
    };

    wv.addEventListener('did-navigate', onDidNavigate);
    wv.addEventListener('did-navigate-in-page', onInPage);
    return () => {
      wv.removeEventListener('did-navigate', onDidNavigate);
      wv.removeEventListener('did-navigate-in-page', onInPage);
    };
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
