# Web search: pluggable provider registry

The AI in Chat can search the web. The engine is a **provider**, chosen in the toolbar popup
(`settings.searchProvider`). Adding a new engine = one function in `src/search/providers.js`
+ one branch in `searchConfig()` (background).

| Provider | id | Setup | Cost | How it runs |
|---|---|---|---|---|
| DuckDuckGo (**default**) | `duckduckgo` | none | free | SW scrapes `lite.duckduckgo.com` / `html.duckduckgo.com` HTML, parses result links+snippets |
| OpenAI native | `openai` | none | billed per search to your key | Chat switches to the **Responses API** (`/v1/responses`) with `tools:[{type:'web_search'}]`; OpenAI searches server-side and streams the grounded answer |
| SearXNG | `searxng` | your server + one-time grant | free (your infra) | SW calls your instance's JSON API |
| Off | `off` | — | — | tool is not attached; model answers from the video only |

## Transport note

All model traffic (chat, summary, highlights, probes, tool loops) goes through the
**Responses API** (`/v1/responses`) — chat/completions rejects function tools on
reasoning-effort models like `gpt-5.6-luna`. Reasoning effort is user-selectable in the
chat composer (`reasoning.effort`: none/minimal/low/medium/high) and self-heals away on
models that don’t accept it.

## How the model triggers a search (non-native providers)

Chat requests carry a function tool `web_search { query, max_results }` (Responses schema:
fields at tool top level, results returned as `function_call_output` items). The service worker
runs a **streaming tool loop** (max 4 turns):

1. stream a turn; accumulate `delta.tool_calls[]` chunks per index (`id`, `name`, `arguments` fragments)
2. if the model called the tool: push the assistant `tool_calls` message, execute each call via the
   provider, push `role:'tool'` results (titles/URLs/snippets, ≤4k chars), re-stream
3. UI receives `{type:'tool', query}` → "Searching the web: …" line; answer deltas keep flowing into the same bubble

The tool is attached **only when** the provider is configured *and* (for SearXNG) the origin
permission is currently granted — re-checked per call via `chrome.permissions.getAll()`.

## SearXNG specifics (your personal server)

Deploy recipe: `deploy/searxng/` (docker-compose + settings.yml).

Two settings are mandatory or calls fail loudly:
```yaml
search:
  formats: [html, json]   # else 403 on ?format=json
server:
  limiter: false          # else 429 (limiter fingerprint-checks browsers; we are not one)
```
No auth of its own → keep it network-private (loopback bind + TLS reverse proxy / Tailscale).

### MV3 permission model for a user-defined host
- Instance URL is user-specific ⇒ not a static `host_permissions` entry.
- Manifest: `optional_host_permissions: ["http://*/*", "https://*/*"]` (grants nothing at install).
- Popup (extension page, real gesture) → `chrome.permissions.request({origins:[origin+'/*']})` → consent dialog.
- Once granted, SW `fetch` to that origin **bypasses CORS**, so SearXNG's missing CORS headers never matter.
- Popup verifies with a live test query before saving `settings.searxUrl`; 403/429 map to the exact settings.yml fix. Revoke button removes the origin.

## DuckDuckGo specifics
- No key, no server. Static `host_permissions` for the two HTML endpoints (declared in manifest).
- Scraping is inherently fragile: if DDG serves a bot-check page we detect it and say so instead of
  returning garbage; the HTML endpoint is the automatic fallback. Redirect links (`uddg=`) are unwrapped.
- Swap-in candidates later: Brave Search API, Tavily, Bing — same `{results, answers}` contract.

## OpenAI native specifics
- Uses `/v1/responses` (not chat/completions) because that's where the hosted `web_search` tool lives.
- Stream events consumed: `response.output_text.delta` (answer), `response.output_item.done`
  with `item.type === 'web_search_call'` (→ UI "searching" line with the query), `response.completed`,
  `response.failed`, `error`.
- Needs a model that supports hosted search; otherwise the 400 is translated and suggests switching
  provider. Billed per search by OpenAI — the popup says so on the option.

## Privacy
Query path: tab → service worker → {DuckDuckGo | your SearXNG → upstream engines | OpenAI}.
We operate no search infrastructure and log nothing.
