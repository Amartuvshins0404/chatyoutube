import { currentVideoId } from './time.js';

const HOST_ID = 'chatyoutube-root';

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
  const dark = document.documentElement.hasAttribute('dark');
  host.dataset.theme = dark ? 'dark' : 'light';
}

export function bootLayout(host) {
  let open = true;
  let scheduled = false;

  function place() {
    applyTheme(host);
    host.classList.toggle('is-open', open);
    host.classList.toggle('is-chip', !open);
    if (!currentVideoId()) {
      host.style.display = 'none';
      setRelatedHidden(false);
      return;
    }

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
      host.style.cssText = 'display:block;position:fixed;top:64px;right:12px;width:402px;max-width:calc(100vw - 16px);z-index:3000;filter:drop-shadow(0 12px 40px rgba(0,0,0,.45));';
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

  const htmlObs = new MutationObserver(() => { applyTheme(host); });
  htmlObs.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });

  window.addEventListener('resize', requestPlace);
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
    place
  };
}
