export function fmt(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}

export function parseStamp(value) {
  const parts = String(value).split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function seek(sec) {
  const v = document.querySelector('video');
  if (!v) return;
  v.currentTime = Number(sec) || 0;
  v.play().catch(() => {});
}

export function currentVideoId() {
  const u = new URL(location.href);
  const v = u.searchParams.get('v');
  if (v) return v;
  const m = u.pathname.match(/\/(shorts|live|embed)\/([a-zA-Z0-9_-]{11})/);
  return m ? m[2] : null;
}

export function pageTitle() {
  const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1 yt-formatted-string, h1.ytd-watch-metadata');
  const t = el?.textContent?.trim();
  if (t) return t;
  return document.title.replace(/\s*-\s*YouTube\s*$/, '').trim();
}
