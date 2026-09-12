/* Pluggable web-search providers.
   Contract: search(query, maxResults) → { results: [{title, url, snippet}], answers: [string] }
   Add an engine by implementing that and registering it in background.js searchConfig(). */

function decodeEntities(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

function unddg(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    return u.searchParams.get('uddg') || href;
  } catch {
    return href;
  }
}

/* --- DuckDuckGo: scrape the lightweight HTML endpoints (no API key, no server) --- */
export async function searchDuckDuckGo(query, maxResults = 5, signal) {
  const endpoints = [
    'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query),
    'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)
  ];
  let lastErr = null;
  for (const url of endpoints) {
    signal?.throwIfAborted();
    try {
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
      const res = await fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml' }, signal: requestSignal });
      if (!res.ok) { lastErr = new Error('DuckDuckGo HTTP ' + res.status); continue; }
      const html = await res.text();
      if (/anomaly|captcha|challenge/i.test(html.slice(0, 5000))) {
        lastErr = new Error('DuckDuckGo bot-check blocked this request. Try again or switch provider in the popup.');
        continue;
      }
      const lite = url.includes('/lite/');
      // Attribute order differs between the lite and HTML pages.
      const linkRe = /<a\b(?=[^>]*class=['"][^'"]*\b(?:result-link|result__a)\b[^'"]*['"])(?=[^>]*href=['"]([^'"]+)['"])[^>]*>([\s\S]*?)<\/a>/g;
      const snipRe = lite
        ? /<td[^>]*class=['"]?result-snippet['"]?[^>]*>([\s\S]*?)<\/td>/g
        : /<a[^>]*class=['"]?result__snippet['"]?[^>]*>([\s\S]*?)<\/a>/g;

      const snippets = [];
      let ms;
      while ((ms = snipRe.exec(html))) snippets.push(decodeEntities(ms[1]));

      const results = [];
      let m;
      let i = 0;
      while ((m = linkRe.exec(html)) && results.length < maxResults) {
        const target = unddg(m[1]);
        if (!/^https?:/i.test(target)) continue;
        results.push({ title: decodeEntities(m[2]), url: target, snippet: snippets[i] || '' });
        i++;
      }
      if (results.length) return { results, answers: [] };
      lastErr = new Error('DuckDuckGo returned no parseable results.');
    } catch (e) {
      signal?.throwIfAborted();
      lastErr = e;
    }
  }
  throw lastErr || new Error('DuckDuckGo unreachable.');
}

/* --- SearXNG: the user's own metasearch instance, JSON API (optional basic auth) --- */
export async function searchSearxng(base, query, maxResults = 5, auth, signal) {
  const u = new URL(base.replace(/\/+$/, '') + '/search');
  u.searchParams.set('q', query);
  u.searchParams.set('format', 'json');
  const headers = { Accept: 'application/json' };
  if (auth) headers.Authorization = 'Basic ' + btoa(auth);
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  const res = await fetch(u.toString(), { headers, signal: requestSignal });
  if (res.status === 401) throw new Error('SearXNG basic auth rejected — check user:password in the popup.');
  if (res.status === 403) throw new Error('SearXNG refused JSON (403): set search: formats: [html, json] in its settings.yml');
  if (res.status === 429) throw new Error('SearXNG rate-limited (429): set limiter: false on your private instance');
  if (!res.ok) throw new Error('SearXNG HTTP ' + res.status);
  const data = await res.json();
  const results = (data.results || []).slice(0, maxResults).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    snippet: (r.content || '').slice(0, 300)
  }));
  const answers = (data.answers || []).map((a) => (typeof a === 'string' ? a : a.answer)).filter(Boolean).slice(0, 2);
  return { results, answers };
}

/* --- shared formatting into LLM-readable tool output --- */
export function formatSearchText({ results, answers }) {
  const parts = [];
  if (answers?.length) parts.push('Direct answers:\n- ' + answers.join('\n- '));
  if (results?.length) {
    parts.push(results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n'));
  }
  return (parts.join('\n\n') || 'No results.').slice(0, 4000);
}
