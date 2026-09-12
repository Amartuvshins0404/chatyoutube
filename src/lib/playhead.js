import { useEffect, useState } from 'react';
import { fmt } from './time.js';

/** Live playhead of the page's <video>: { now (seconds), paused }. */
export function usePlayhead() {
  const [state, setState] = useState(() => {
    const v = document.querySelector('video');
    return { now: v?.currentTime || 0, paused: v?.paused ?? true };
  });

  useEffect(() => {
    let v = null;
    let lastT = -1;
    let lastP = null;

    const bump = () => {
      if (!v) return;
      const t = v.currentTime;
      const p = v.paused;
      if (Math.abs(t - lastT) < 0.25 && p === lastP) return;
      lastT = t;
      lastP = p;
      setState({ now: t, paused: p });
    };

    function attach() {
      const el = document.querySelector('video');
      if (!el || el === v) return;
      detach();
      v = el;
      v.addEventListener('timeupdate', bump);
      v.addEventListener('seeked', bump);
      v.addEventListener('play', bump);
      v.addEventListener('pause', bump);
      bump();
    }
    function detach() {
      if (!v) return;
      v.removeEventListener('timeupdate', bump);
      v.removeEventListener('seeked', bump);
      v.removeEventListener('play', bump);
      v.removeEventListener('pause', bump);
      v = null;
    }

    attach();
    const poll = setInterval(attach, 800);
    return () => { clearInterval(poll); detach(); };
  }, []);

  return state;
}

export function cueIndex(cues, tSec) {
  if (!cues?.length) return -1;
  const ms = tSec * 1000;
  let i = -1;
  for (let k = 0; k < cues.length; k++) {
    if (cues[k].offset <= ms) i = k;
    else break;
  }
  return i;
}

/** Caption lines around the playhead; the line playing right now is marked ▶. */
export function around(cues, tSec, back = 45, forth = 15) {
  if (!cues?.length) return '';
  const ms = tSec * 1000;
  const lo = ms - back * 1000;
  const hi = ms + forth * 1000;
  const lines = [];
  for (const c of cues) {
    if (c.offset < lo) continue;
    if (c.offset > hi) break;
    const here = c.offset <= ms && c.offset + (c.duration || 1200) >= ms;
    lines.push(`${here ? '▶ ' : '  '}[${fmt(c.offset / 1000)}] ${c.text}`);
  }
  return lines.join('\n');
}

/** Wraps a question with where the viewer is, so the model answers from the same second. */
export function wrapUser(text, tSec, cues) {
  const window = around(cues, tSec);
  return (
    `WATCHHEAD ${fmt(tSec)} (${Math.floor(tSec)} seconds into the video).\n` +
    (window
      ? `Playing around the viewer right now:\n${window}\n\n`
      : 'No caption line at this exact second.\n\n') +
    `Viewer question:\n${text}`
  );
}
