import { useEffect, useState } from 'react';
import { currentVideoId } from './time.js';

const HOST_ID = 'chatyoutube-root';
const COL = 402;

export function useFullscreen() {
  const [fs, setFs] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  return fs;
}

function secondaryUsable() {
  const col = document.querySelector('#secondary');
  if (!col) return false;
  const st = getComputedStyle(col);
  if (st.display === 'none' || st.visibility === 'hidden') return false;
  return col.getBoundingClientRect().width >= 300;
}

function isWatch() {
  return /\/watch/.test(location.pathname) || /\/live\//.test(location.pathname);
}

function setRelatedHidden(hide) {
  const el = document.querySelector('#related');
  if (!el) return;
  if (hide) {
    if (el.dataset.cytPrev === undefined) el.dataset.cytPrev = el.style.display || '';
    el.style.display = 'none';
  } else if (el.dataset.cytPrev !== undefined) {
    el.style.display = el.dataset.cytPrev;
    delete el.dataset.cytPrev;
  }
}

function applyTheme(host) {
  host.dataset.theme = document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
}

export function bootLayout(host) {
  let open = true;
  let opts = { hideTray: false, fsCols: true };
  let scheduled = false;
  let fsParent = null;

  function place() {
    applyTheme(host);
    const fsEl = document.fullscreenElement;
    const fs = !!fsEl;

    host.classList.toggle('is-open', open);
    host.classList.toggle('is-chip', !open);
    host.classList.toggle('is-fs', fs && open);
    document.documentElement.classList.toggle('cyt-fs-cols', !!(fs && open && opts.fsCols));

    /* completely hidden: nothing on the page… */
    if (!open && opts.hideTray && !fs) {
      host.style.display = 'none';
      setRelatedHidden(false);
      return;
    }
    /* …except a rescue pill while fullscreen, so the user is never stuck */
    if (!open && opts.hideTray && fs) {
      host.style.cssText = 'display:block;position:fixed;top:16px;right:16px;width:auto;z-index:6000;';
      if (host.parentElement !== document.documentElement) document.documentElement.appendChild(host);
      setRelatedHidden(false);
      return;
    }

    /* fullscreen: clean right column inside the fullscreen element */
    if (fs) {
      host.style.cssText = `display:block;position:fixed;top:0;right:0;bottom:0;width:${COL}px;max-width:60vw;z-index:6000;`;
      const canHold = fsEl && fsEl.tagName !== 'VIDEO' && fsEl !== document.documentElement;
      if (canHold && !fsEl.contains(host)) {
        fsParent = host.parentElement;
        fsEl.appendChild(host);
      }
      setRelatedHidden(false);
      return;
    }
    if (fsParent && host.parentElement !== fsParent && document.contains(fsParent)) {
      fsParent.appendChild(host);
    } else if (!fsParent && host.parentElement === document.documentElement && isWatch() && document.querySelector('#secondary-inner')) {
      /* fall through to docked placement below */
    }
    fsParent = null;

    const inner = document.querySelector('#secondary-inner');
    const watch = isWatch();

    if (watch && inner && secondaryUsable()) {
      host.classList.remove('is-float');
      host.style.cssText = open
        ? 'display:block;width:100%;margin:0 0 16px;position:sticky;top:56px;z-index:3;'
        : 'display:block;width:100%;margin:0 0 12px;position:relative;z-index:3;';
      if (inner.firstElementChild !== host) inner.prepend(host);
      setRelatedHidden(open);
      return;
    }

    host.classList.add('is-float');
    if (open && (watch || /\/shorts\//.test(location.pathname))) {
      host.style.cssText = `display:block;position:fixed;top:64px;right:12px;width:${COL}px;max-width:calc(100vw - 16px);z-index:3000;filter:drop-shadow(0 12px 40px rgba(0,0,0,.45));`;
      if (host.parentElement !== document.documentElement) document.documentElement.appendChild(host);
      setRelatedHidden(false);
      return;
    }

    host.style.cssText = 'display:block;position:fixed;bottom:24px;right:24px;width:auto;z-index:3000;';
    if (host.parentElement !== document.documentElement) document.documentElement.appendChild(host);
    setRelatedHidden(false);
  }

  function requestPlace() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      place();
    });
  }

  const bodyObs = new MutationObserver(requestPlace);
  if (document.body) bodyObs.observe(document.body, { childList: true, subtree: true });

  const htmlObs = new MutationObserver(() => applyTheme(host));
  htmlObs.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });

  window.addEventListener('resize', requestPlace);
  document.addEventListener('fullscreenchange', requestPlace);
  document.addEventListener('yt-navigate-finish', requestPlace);
  document.addEventListener('yt-page-data-updated', requestPlace);

  place();

  host.id = HOST_ID;
  host.addEventListener('keydown', (e) => e.stopPropagation());
  host.addEventListener('keyup', (e) => e.stopPropagation());
  host.addEventListener('keypress', (e) => e.stopPropagation());

  return {
    setOpen(v) { open = !!v; place(); },
    getOpen() { return open; },
    setOpts(next) { opts = { ...opts, ...next }; place(); },
    place
  };
}
