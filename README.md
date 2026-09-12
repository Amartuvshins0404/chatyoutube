# ChatYouTube

A Chrome extension that watches YouTube **with** you: a panel in YouTube's own right column with
transcript, AI summary, highlights, a playhead-aware chat, full-duplex voice, and pluggable web search.

You bring your own OpenAI API key. **No accounts, no backend of ours, no database.**
The key lives in `chrome.storage.local` and is used only by the extension's service worker.

> Unofficial project. Not affiliated with YouTube or OpenAI.

## Features

| Tab | What it does |
|---|---|
| **Transcript** | Captions from the YouTube player (InnerTube fallback). Follows the playhead, search, copy. |
| **Summary** | One-click streaming briefing, cached per video so you never pay twice. |
| **Chat** | Every question carries your exact second + the lines playing around it (`WATCHHEAD`). Answers cite clickable `[12:34]` timestamps. Reasoning-effort picker. Streaming with Stop. |
| **Live** | Full-duplex voice with speech-to-speech models (`gpt-live-1`, `gpt-realtime`, …) over the OpenAI Realtime API / WebRTC. Barge-in, live captions, mic meter. |
| **Highlights** | 5–8 jump-to moments extracted as JSON; click a card to seek. |

Web search (Chat only, model-triggered via tool calling):

| Provider | Setup | Notes |
|---|---|---|
| DuckDuckGo (**default**) | none | scraped in the service worker, free |
| OpenAI native | none | hosted `web_search` on the Responses API, billed per search by OpenAI |
| SearXNG | your server | your own metasearch; one-time site-access grant; optional basic auth |
| Off | — | model answers from the video only |

## Install

```bash
npm install
npm run build        # → dist/
```

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select `dist/`
3. Open any YouTube watch page; the panel docks where related videos usually sit
4. Paste an OpenAI API key (toolbar popup or the panel). It is verified before saving.

Reload the extension after rebuilds, then hard-refresh YouTube (⌘⇧R / Ctrl⇧R).

## Privacy & cost

- Requests go: tab → service worker → `api.openai.com` (+ your search provider). Nothing else.
- The page never sees your key; content scripts talk to the worker over extension ports.
- Summaries/highlights/chats are cached per video in `chrome.storage.local` (last 30 videos).
- You pay OpenAI directly, at their prices. Effort picker and per-video caching keep bills sane.
- SearXNG queries go to *your* instance; the extension stores its URL + optional basic-auth pair locally.

## Self-hosting SearXNG (optional)

```bash
# on your server
bash deploy/searxng/install.sh
```

It runs SearXNG loopback-only with the JSON API enabled and `limiter: false`, then prints
reverse-proxy steps. In the extension popup: provider → SearXNG → URL (+ `user:pass` if you put
basic auth in front) → **Connect & test**. Details: `docs/SEARCH.md`.

## Development

```bash
npm run watch   # rebuild on change
npm test        # protocol/worker/bridge/render regression tests (mocked providers, no paid calls)
```

Layout:

```
src/
  content.jsx        shadow-DOM mount into YouTube's #secondary-inner
  app.jsx            tabs, per-video state, storage wiring
  background.js      service worker: OpenAI Responses API, tool loop, search execution, RTC handshake
  page.js            page-world bridge (ytInitialPlayerResponse → caption tracks)
  lib/               responses.mjs (SSE lifecycle), playhead, transcript, storage, api bridge, live RTC
  search/            provider registry (duckduckgo, searxng)
  ui/                tabs + settings + model/effort pickers
deploy/searxng/      one-shot installer for a personal SearXNG
docs/                SEARCH.md, REALTIME.md, RESPONSE-REPAIR.md
tests/               node:test suites (no network, no keys)
```

Design notes worth reading:
- `docs/SEARCH.md` — provider registry, MV3 permission model for user-defined hosts, tool loop
- `docs/REALTIME.md` — why WebRTC (browsers can't set WS auth headers), event flow, mic lifecycle
- `docs/RESPONSE-REPAIR.md` — the Responses-API failure modes this code guards against

## Contributing

See `CONTRIBUTING.md`. Short version: add search providers via the registry contract, keep the
service worker the only place secrets touch the network, and extend `tests/` for any protocol change.

## License

MIT — see `LICENSE`.
