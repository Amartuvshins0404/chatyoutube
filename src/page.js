/* Runs in the page world so we can read ytInitialPlayerResponse. */
(function () {
  const SOURCE = 'chatyoutube';

  function tracksFrom(player) {
    const list = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(list)) return [];
    return list.map((t) => ({
      baseUrl: t.baseUrl,
      lang: t.languageCode || '',
      kind: t.kind || '',
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || ''
    })).filter((t) => t.baseUrl);
  }

  function player() {
    try {
      if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
      const raw = window.ytplayer?.config?.args?.player_response;
      if (typeof raw === 'string') return JSON.parse(raw);
      if (raw && typeof raw === 'object') return raw;
    } catch {}
    return null;
  }

  function emit() {
    const pr = player();
    window.postMessage({
      source: SOURCE,
      type: 'player',
      videoId: pr?.videoDetails?.videoId || null,
      title: pr?.videoDetails?.title || null,
      tracks: tracksFrom(pr)
    }, '*');
  }

  emit();
  document.addEventListener('yt-navigate-finish', emit);
  document.addEventListener('yt-page-data-updated', emit);
  document.addEventListener('yt-navigate-start', emit);
  // SPA player response often lands a beat after navigate
  let n = 0;
  const t = setInterval(() => { emit(); if (++n > 20) clearInterval(t); }, 250);
})();
