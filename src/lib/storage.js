const DEFAULTS = {
  apiKey: '',
  model: 'gpt-4o-mini',
  liveModel: 'gpt-live-1',
  voice: 'alloy',
  searchProvider: 'duckduckgo',
  searxUrl: '',
  effort: 'medium',
  hideTray: false,
  lastTab: 'chat',
  open: true
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const settings = { ...cur, ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

export async function getVideo(id) {
  if (!id) return null;
  const key = 'v:' + id;
  const o = await chrome.storage.local.get(key);
  return o[key] || null;
}

/* Multiple chat sessions per video, with migration from the single-session cache. */
export async function getSessions(id) {
  const v = await getVideo(id);
  let sessions = v?.sessions;
  if (!Array.isArray(sessions) || !sessions.length) {
    sessions = [{ id: 's1', name: 'Session 1', messages: Array.isArray(v?.messages) ? v.messages : [] }];
  }
  const active = v?.activeSession && sessions.some((s) => s.id === v.activeSession)
    ? v.activeSession
    : sessions[0].id;
  return { sessions, active };
}

export async function saveVideo(id, patch) {
  if (!id) return null;
  const cur = (await getVideo(id)) || {};
  const next = { ...cur, ...patch, savedAt: Date.now() };
  try {
    await chrome.storage.local.set({ ['v:' + id]: next });
    await prune(id);
  } catch {
    try {
      const { cues, ...rest } = next;
      await chrome.storage.local.set({ ['v:' + id]: rest });
    } catch {}
  }
  return next;
}

async function prune(id) {
  const { vindex = [] } = await chrome.storage.local.get('vindex');
  const next = [id, ...vindex.filter((x) => x !== id)].slice(0, 30);
  const drop = vindex.filter((x) => !next.includes(x)).map((x) => 'v:' + x);
  if (drop.length) await chrome.storage.local.remove(drop);
  await chrome.storage.local.set({ vindex: next });
}

export function onSettingsChange(fn) {
  const listener = (changes, area) => {
    if (area === 'local' && changes.settings) fn(changes.settings.newValue);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
