// Embeds the target assessment site using Electron's <webview> tag.
// <webview> is a full, isolated browser view (not an iframe), so sites that
// block iframing (X-Frame-Options) — including Google — still load here.
// `key={url}` forces a clean remount whenever the URL changes.
export default function SiteFrame({ url }) {
  return (
    <div className="site-frame">
      <webview
        key={url}
        src={url}
        className="webview"
        allowpopups="true"
        partition="persist:assessment"
      />
    </div>
  );
}
