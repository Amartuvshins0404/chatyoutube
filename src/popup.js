const keyEl = document.getElementById('key');
const modelEl = document.getElementById('model');
const statusEl = document.getElementById('status');
const msgEl = document.getElementById('msg');
const noteEl = document.getElementById('model-note');
const listEl = document.getElementById('cyt-models');
const providerEl = document.getElementById('provider');
const searxRow = document.getElementById('searx-row');
const searxEl = document.getElementById('searx');
const searxAuthEl = document.getElementById('searx-auth');
const searchStatusEl = document.getElementById('search-status');

const isChat = (id) =>
  /^(gpt-|o\d|chatgpt-)/.test(id) &&
  !/(realtime|audio|search|instruct|transcrib|tts|dall|embedding|moderation|guard|safety)/.test(id) &&
  !/^(davinci|babbage|text-|code-)/.test(id);

function rank(id) {
  if (/^gpt-5/.test(id)) return 0;
  if (/^o[3-9]/.test(id)) return 1;
  if (/^o1/.test(id)) return 2;
  if (/^gpt-4\.1/.test(id)) return 3;
  if (/^gpt-4o/.test(id)) return 4;
  if (/^gpt-4/.test(id)) return 5;
  if (/^chatgpt-/.test(id)) return 6;
  if (/^gpt-/.test(id)) return 7;
  return 9;
}

function mask(k) {
  if (!k) return '';
  if (k.length < 12) return '••••';
  return k.slice(0, 7) + '…' + k.slice(-4);
}

const getSettings = async () => (await chrome.storage.local.get('settings')).settings || {};
const setSettings = async (patch) => {
  const cur = await getSettings();
  await chrome.storage.local.set({ settings: { ...cur, ...patch } });
};

async function loadModels(apiKey) {
  listEl.innerHTML = '';
  if (!apiKey) { noteEl.textContent = ''; return; }
  noteEl.textContent = '· loading…';
  chrome.runtime.sendMessage({ type: 'models', apiKey }, (res) => {
    const err = chrome.runtime.lastError?.message;
    const models = res?.models;
    if (err || !models) { noteEl.textContent = '· list unavailable, type any id'; return; }
    const chat = models.filter(isChat).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    for (const m of chat) {
      const o = document.createElement('option');
      o.value = m;
      listEl.appendChild(o);
    }
    noteEl.textContent = `· ${chat.length} chat models on this key`;
    if (!modelEl.value && chat.length) modelEl.value = chat[0];
  });
}

function ddgStatus() { return 'DuckDuckGo: on — free, no setup, scraped in the service worker.'; }
function openaiStatus() { return 'OpenAI native: on — OpenAI searches server-side; each search is billed to your key.'; }
function offStatus() { return 'Web search off — the AI answers from the video only.'; }

async function refreshSearchStatus() {
  const s = await getSettings();
  const p = s.searchProvider ?? 'duckduckgo';
  providerEl.value = p;
  searxRow.hidden = p !== 'searxng';
  searxEl.value = s.searxUrl || '';
  searxAuthEl.value = s.searxAuth || '';
  if (p === 'duckduckgo') { searchStatusEl.textContent = ddgStatus(); return; }
  if (p === 'openai') { searchStatusEl.textContent = openaiStatus(); return; }
  if (p === 'off') { searchStatusEl.textContent = offStatus(); return; }
  if (!s.searxUrl) { searchStatusEl.textContent = 'SearXNG: enter your instance URL and Connect.'; return; }
  const perm = await chrome.permissions.getAll();
  let origin = '';
  try { origin = new URL(s.searxUrl).origin; } catch {}
  const granted = (perm.origins || []).includes(origin + '/*');
  searchStatusEl.textContent = granted
    ? `SearXNG: connected to ${s.searxUrl}`
    : `SearXNG: URL saved but site access missing — click Connect & test.`;
}

providerEl.addEventListener('change', async () => {
  await setSettings({ searchProvider: providerEl.value });
  refreshSearchStatus();
});

document.getElementById('connect-search').addEventListener('click', async () => {
  const raw = searxEl.value.trim();
  if (!raw) { searchStatusEl.textContent = 'Enter the SearXNG URL first.'; return; }
  let u;
  try { u = new URL(raw); } catch { searchStatusEl.textContent = 'That is not a valid URL.'; return; }
  const base = u.origin + (u.pathname.replace(/\/+$/, '') || '');
  const granted = await chrome.permissions.request({ origins: [u.origin + '/*'] });
  if (!granted) { searchStatusEl.textContent = 'Permission denied — search stays off for SearXNG.'; return; }
  const auth = searxAuthEl.value.trim();
  const headers = { Accept: 'application/json' };
  if (auth) headers.Authorization = 'Basic ' + btoa(auth);
  try {
    const res = await fetch(base + '/search?q=chatyoutube&format=json', { headers });
    if (res.status === 401) throw new Error('basic auth rejected — check user:password');
    if (res.status === 403) throw new Error('JSON API disabled on the instance (search: formats: [html, json])');
    if (res.status === 429) throw new Error('limiter is blocking API calls (set limiter: false)');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    await setSettings({ searxUrl: base, searxAuth: auth, searchProvider: 'searxng' });
    searchStatusEl.textContent = `Connected · test query returned ${(data.results || []).length} results.`;
  } catch (e) {
    await setSettings({ searxUrl: base, searxAuth: auth, searchProvider: 'searxng' });
    searchStatusEl.textContent = 'Access granted but test failed: ' + e.message;
  }
  refreshSearchStatus();
});

document.getElementById('revoke-search').addEventListener('click', async () => {
  const s = await getSettings();
  if (s.searxUrl) {
    try {
      const origin = new URL(s.searxUrl).origin;
      await chrome.permissions.remove({ origins: [origin + '/*'] });
    } catch {}
  }
  await setSettings({ searxUrl: '', searxAuth: '' });
  searchStatusEl.textContent = 'SearXNG disconnected.';
  refreshSearchStatus();
});

async function load() {
  const s = await getSettings();
  if (s.apiKey) keyEl.value = s.apiKey;
  modelEl.value = s.model || '';
  if (s.apiKey) {
    statusEl.className = 'card ok';
    statusEl.textContent = 'Ready · ' + mask(s.apiKey) + ' · open any YouTube video.';
  } else {
    statusEl.className = 'card bad';
    statusEl.textContent = 'Add an API key to start. The panel appears on youtube.com/watch.';
  }
  loadModels(keyEl.value.trim());
  refreshSearchStatus();
}

keyEl.addEventListener('change', () => loadModels(keyEl.value.trim()));

document.getElementById('save').addEventListener('click', async () => {
  await setSettings({
    apiKey: keyEl.value.trim(),
    model: modelEl.value.trim() || 'gpt-4o-mini',
    searchProvider: providerEl.value
  });
  msgEl.textContent = 'Saved. Refresh the YouTube tab if the panel is already open.';
  load();
});

load();
