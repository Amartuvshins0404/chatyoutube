import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app.jsx';
import ErrorBoundary from './ui/ErrorBoundary.jsx';
import css from './styles.css';
import { bootLayout } from './lib/youtube.js';

const HOST_ID = 'chatyoutube-root';

function injectPageBridge() {
  if (document.documentElement.dataset.cytBridge) return;
  document.documentElement.dataset.cytBridge = '1';
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('page.js');
  (document.head || document.documentElement).appendChild(s);
  s.addEventListener('load', () => s.remove());
}

function makeHost() {
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const mount = document.createElement('div');
  mount.className = 'mount';
  shadow.append(style, mount);
  return { host, mount };
}

injectPageBridge();
const { host, mount } = makeHost();
const layout = bootLayout(host);
createRoot(mount).render(<ErrorBoundary><App layout={layout} /></ErrorBoundary>);
