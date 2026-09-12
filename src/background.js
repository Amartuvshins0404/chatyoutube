/* Service worker — the only place the OpenAI key is used, and where web search executes.
   All model traffic goes through the Responses API (/v1/responses). */
import { searchDuckDuckGo, searchSearxng, formatSearchText } from './search/providers.js';
import { RESPONSES_URL, responseBody, readResponse, outputText, runResponses } from './lib/responses.mjs';

function friendlyHttp(status, body, model) {
  const m = body?.error?.message || '';
  const code = body?.error?.code || '';
  if (/not a chat model|v1\/completions/i.test(m))
    return `“${model}” can’t chat — it’s a legacy completions-only model. Pick a chat model (gpt-…, o1/o3…, chatgpt-…).`;
  if (status === 404 || /model_not_found|does not exist|no such model/i.test(m + code))
    return `“${model}” isn’t available on this key. Pick another model in settings.`;
  if (status === 401 || status === 403)
    return 'Invalid API key. Open settings and paste a key from platform.openai.com/api-keys.';
  if (status === 429) return 'OpenAI rate limit or quota exceeded. Check billing at platform.openai.com.';
  if (/unsupported parameter|unsupported value/i.test(m))
    return `“${model}” rejected a request parameter: ${m}`;
  return m || `OpenAI error (${status})`;
}

async function requestResponse(body, apiKey, signal) {
  const res = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const error = new Error(friendlyHttp(res.status, detail, body.model));
    error.requestId = res.headers.get('x-request-id') || undefined;
    throw error;
  }
  return res;
}

/* ---------- web search: provider registry ---------- */

const WEB_FN_TOOL = {
  type: 'function',
  name: 'web_search',
  description: 'Search the public web for information beyond the video: current events, people, products, follow-ups, fact-checks. Returns titles, URLs and snippets.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'concise search query' },
      max_results: { type: 'integer', minimum: 1, maximum: 8, description: '1-8, usually 5' }
    },
    required: ['query', 'max_results']
  }
};

async function searchConfig() {
  const { settings } = await chrome.storage.local.get('settings');
  const p = settings?.searchProvider ?? 'duckduckgo';
  if (p === 'off') return null;
  if (p === 'openai') return { provider: 'openai' };
  if (p === 'searxng') {
    const url = settings?.searxUrl;
    if (!url) return null;
    let origin;
    try { origin = new URL(url).origin; } catch { return null; }
    const perm = await chrome.permissions.getAll();
    const origins = perm.origins || [];
    if (!origins.includes(origin + '/*') && !origins.includes('<all_urls>')) return null;
    return { provider: 'searxng', url, auth: settings?.searxAuth || '' };
  }
  return { provider: 'duckduckgo' };
}

async function execSearch(cfg, query, maxResults, signal) {
  const r = cfg.provider === 'searxng'
    ? await searchSearxng(cfg.url, query, maxResults, cfg.auth, signal)
    : await searchDuckDuckGo(query, maxResults, signal);
  return formatSearchText(r);
}

/* ---------- messages: models list, probe, rtc ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'models') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get('settings');
        const apiKey = msg.apiKey || stored.settings?.apiKey;
        if (!apiKey) { sendResponse({ error: 'Add your OpenAI API key first.' }); return; }
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` }
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          sendResponse({ error: friendlyHttp(res.status, body, msg.model) });
          return;
        }
        const data = await res.json();
        sendResponse({ models: (data.data || []).map((m) => m.id).sort() });
      } catch (e) {
        sendResponse({ error: e?.message || 'Network error fetching models.' });
      }
    })();
    return true;
  }

  if (msg?.type === 'probe') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get('settings');
        const apiKey = msg.apiKey || stored.settings?.apiKey;
        if (!apiKey) { sendResponse({ ok: false, error: 'Add your OpenAI API key first.' }); return; }
        if (!msg.model) { sendResponse({ ok: false, error: 'Pick a model first.' }); return; }
        const res = await requestResponse(
          responseBody(msg.model, [{ role: 'user', content: 'Reply with OK.' }]),
          apiKey, AbortSignal.timeout(60000)
        );
        const data = await readResponse(res);
        if (!outputText(data).trim()) throw new Error('The model completed without answer text.');
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || 'Network error checking model.' });
      }
    })();
    return true;
  }

  if (msg?.type === 'rtc-connect') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get('settings');
        const apiKey = msg.apiKey || stored.settings?.apiKey;
        if (!apiKey) { sendResponse({ error: 'Add your OpenAI API key first.' }); return; }
        const model = msg.model || stored.settings?.liveModel || 'gpt-live-1';
        const res = await fetch('https://api.openai.com/v1/realtime/calls?model=' + encodeURIComponent(model), {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/sdp' },
          body: msg.sdp
        });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          let body = {};
          try { body = JSON.parse(t); } catch {}
          sendResponse({ error: friendlyHttp(res.status, Object.keys(body).length ? body : { error: { message: t.slice(0, 300) } }, model) });
          return;
        }
        sendResponse({ sdp: await res.text() });
      } catch (e) {
        sendResponse({ error: e?.message || 'Network error starting the realtime call.' });
      }
    })();
    return true;
  }

  return false;
});

/* ---------- Responses API with tool loop ---------- */

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cytai') return;
  let ac = null;
  let disconnected = false;
  const post = (message) => {
    if (!disconnected) {
      try { port.postMessage(message); }
      catch { disconnected = true; ac?.abort(); }
    }
  };
  port.onDisconnect.addListener(() => { disconnected = true; ac?.abort(); });

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'abort') { ac?.abort(); return; }
    if (ac) return; // one request per port; don't let old callbacks overwrite a new turn
    const controller = new AbortController();
    ac = controller;
    let timedOut = false;
    let phase = 'Connecting';
    const started = Date.now();
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 180000);
    const status = (value) => {
      phase = value;
      post({ type: 'status', phase, elapsed: Math.floor((Date.now() - started) / 1000) });
    };
    // Actual port activity also keeps MV3 alive during a long reasoning interval.
    const heartbeat = setInterval(() => status(phase), 15000);
    try {
      const stored = await chrome.storage.local.get('settings');
      const apiKey = msg.apiKey || stored.settings?.apiKey;
      if (!apiKey) throw new Error('Add your OpenAI API key in settings first.');
      const cfg = msg.allowTools ? await searchConfig() : null;
      const text = await runResponses({
        model: msg.model || stored.settings?.model || 'gpt-4o-mini',
        input: msg.messages, stream: !!msg.stream, json: !!msg.json,
        max_tokens: msg.max_tokens,
        effort: msg.effort ?? stored.settings?.effort ?? 'medium',
        tools: cfg?.provider === 'openai' ? [{ type: 'web_search' }] : cfg ? [WEB_FN_TOOL] : [],
        request: (body, signal) => requestResponse(body, apiKey, signal),
        executeTool: cfg && cfg.provider !== 'openai'
          ? (query, limit, signal) => execSearch(cfg, query, limit, signal) : undefined,
        signal: controller.signal,
        onDelta: (delta) => post({ type: 'delta', text: delta }),
        onStatus: status,
        onTool: (event) => post({ type: 'tool', ...event })
      });
      post({ type: 'done', text }); // canonical final text, not an empty success sentinel
    } catch (error) {
      post({
        type: 'error',
        error: timedOut ? 'The request timed out after 3 minutes. You can retry.'
          : controller.signal.aborted ? 'Request stopped.' : error.message || 'Request failed.',
        requestId: error.requestId
      });
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
    }
  });
});
