# Contributing

Thanks for helping make YouTube watching smarter.

## Ground rules

- **Secrets never leave the service worker.** Content scripts and pages must not see API keys or
  search credentials. New network calls belong in `src/background.js` (or `src/lib/` modules it imports).
- **No new backend.** This project is deliberately serverless; self-hosted pieces (SearXNG) run on
  the *user's* infrastructure.
- **Tests for protocol code.** Anything touching the OpenAI Responses/Realtime APIs or SSE parsing
  needs a mocked case in `tests/` (`npm test` must stay green and offline).
- Keep the UI inside the Shadow DOM; YouTube's CSS must not leak in, ours must not leak out.

## Adding a search provider

1. Implement `search(query, maxResults, signal) → { results: [{title, url, snippet}], answers: [] }`
   in `src/search/providers.js` (throw plain `Error`s with actionable messages).
2. Register it in `searchConfig()` in `src/background.js` and in the popup's provider `<select>`.
3. If it needs a user-defined host: use the runtime-permission flow (see `docs/SEARCH.md`), never a
   static wildcard `host_permissions`.
4. Add a mocked test if the parsing is non-trivial.

## Pull requests

- Small, focused PRs; describe the user-visible change.
- Run `npm test && npm run build` before pushing.
- Don't commit `dist/`, keys, URLs of private instances, or screenshots containing personal data.

## Reporting bugs

Include: extension version (toolbar popup → manifest), model id, effort level, and the exact error
text (it now includes a request id when OpenAI supplies one). Redact your key always.
