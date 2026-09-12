import { YoutubeTranscript } from 'youtube-transcript';

const SOURCE = 'chatyoutube';
let last = null;
const waiters = new Set();

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (e.data?.source !== SOURCE || e.data.type !== 'player') return;
  last = e.data;
  waiters.forEach((fn) => fn(e.data));
});

function waitForTracks(videoId, ms = 2200) {
  if (last?.videoId === videoId && last.tracks?.length) return Promise.resolve(last);
  return new Promise((resolve) => {
    const t = setTimeout(() => { waiters.delete(on); resolve(last?.videoId === videoId ? last : null); }, ms);
    const on = (data) => {
      if (data.videoId !== videoId) return;
      clearTimeout(t);
      waiters.delete(on);
      resolve(data);
    };
    waiters.add(on);
  });
}

function pickTrack(tracks) {
  if (!tracks?.length) return null;
  const lang = (document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
  const scored = [...tracks].sort((a, b) => {
    const as = (a.lang?.slice(0, 2).toLowerCase() === lang ? 2 : 0) + (a.kind === 'asr' ? 0 : 1);
    const bs = (b.lang?.slice(0, 2).toLowerCase() === lang ? 2 : 0) + (b.kind === 'asr' ? 0 : 1);
    return bs - as;
  });
  return scored[0];
}

function eventsToCues(json, lang) {
  const events = json?.events;
  if (!Array.isArray(events)) return [];
  const cues = [];
  for (const ev of events) {
    if (!ev?.segs) continue;
    const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    cues.push({
      text,
      offset: ev.tStartMs || 0,
      duration: ev.dDurationMs || 0,
      lang: lang || ''
    });
  }
  return cues;
}

async function fromTrack(track) {
  const u = new URL(track.baseUrl, location.origin);
  u.searchParams.set('fmt', 'json3');
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error('timedtext ' + res.status);
  const json = await res.json();
  return eventsToCues(json, track.lang);
}

export async function loadTranscript(videoId) {
  if (!videoId) return [];
  const payload = await waitForTracks(videoId);
  const track = pickTrack(payload?.tracks);
  if (track) {
    try {
      const cues = await fromTrack(track);
      if (cues.length) return cues;
    } catch {}
  }
  try {
    const list = await YoutubeTranscript.fetchTranscript(videoId);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function onPlayerMessage(fn) {
  if (last) fn(last);
  const wrap = (e) => {
    if (e.source !== window) return;
    if (e.data?.source !== SOURCE || e.data.type !== 'player') return;
    fn(e.data);
  };
  window.addEventListener('message', wrap);
  return () => window.removeEventListener('message', wrap);
}

export function asText(cues) {
  if (!cues?.length) return '';
  const pad = (ms) => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const h = Math.floor(m / 60);
    const mm = h ? String(m % 60).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  };
  return cues.map((c) => `[${pad(c.offset)}] ${c.text}`).join('\n');
}
