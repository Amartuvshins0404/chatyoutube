import { fmt } from './time.js';

export function complete({ messages, stream = false, json = false, model, apiKey, max_tokens, onDelta, onTool, onStatus, allowTools, effort }) {
  let port, timer, finish;
  let settled = false;
  let text = '';
  const promise = new Promise((resolve, reject) => {
    finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port?.disconnect(); } catch {}
      if (error) { error.partialText = text; reject(error); }
      else resolve(result);
    };
    try {
      port = chrome.runtime.connect({ name: 'cytai' });
      // Also settles if the worker dies without delivering its final message.
      timer = setTimeout(() => finish(new Error('The extension stopped responding. Refresh the tab and retry.')), 195000);
      port.onMessage.addListener((msg) => {
        if (settled) return;
        if (msg.type === 'delta') {
          text += msg.text;
          onDelta?.(text, msg.text);
        } else if (msg.type === 'tool') {
          onTool?.(msg);
        } else if (msg.type === 'status') {
          onStatus?.(msg.phase);
        } else if (msg.type === 'done') {
          const final = msg.text ?? text;
          if (!final.trim()) finish(new Error('The request ended without answer text. Please retry.'));
          else finish(null, final);
        } else if (msg.type === 'error') {
          const error = new Error(msg.error);
          error.requestId = msg.requestId;
          finish(error);
        }
      });
      port.onDisconnect.addListener(() => {
        const detail = chrome.runtime.lastError?.message || '';
        finish(new Error(/reload|invalidated/i.test(detail) ? 'Extension reloaded — refresh this YouTube tab.' : detail || 'The extension connection closed before the answer finished.'));
      });
      port.postMessage({ messages, stream, json, model, apiKey, max_tokens, allowTools, effort });
    } catch {
      finish(new Error('Extension connection failed — refresh this YouTube tab.'));
    }
  });
  return {
    promise,
    abort() {
      if (settled) return;
      try { port?.postMessage({ type: 'abort' }); } catch {}
      const error = new Error('Stopped');
      error.name = 'AbortError';
      finish(error); // Local disconnect does not fire this port's onDisconnect in Chrome.
    }
  };
}

export function probeModel(apiKey, model) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'probe', apiKey, model }, (res) => {
      const last = chrome.runtime.lastError?.message;
      if (last) return resolve({ ok: false, error: /reload|invalidated/i.test(last) ? 'Extension reloaded — refresh the tab.' : last });
      resolve(res || { ok: false, error: 'No response from the extension. Reload it.' });
    });
  });
}

export function listModels(apiKey) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'models', apiKey }, (res) => {
      const last = chrome.runtime.lastError?.message;
      if (last) return reject(new Error(/reload|invalidated/i.test(last) ? 'Extension reloaded — refresh the tab.' : last));
      if (!res) return reject(new Error('No response from the extension. Reload it.'));
      if (res.error) return reject(new Error(res.error));
      resolve(res.models || []);
    });
  });
}

const TRANSCRIPT_LIMIT = 240000; // chars ≈ 60k tokens — fits 128k-context models with room to answer

export function systemPrompt({ title, id, transcript, cues, searchOn }) {
  let body = transcript || '';
  let note = '';
  if (body.length > TRANSCRIPT_LIMIT) {
    if (cues?.length) {
      const step = Math.ceil(body.length / TRANSCRIPT_LIMIT);
      body = cues
        .filter((_, i) => i % step === 0)
        .map((c) => `[${fmt(c.offset / 1000)}] ${c.text}`)
        .join('\n');
      note = `\n(long video: transcript condensed by keeping every ${step}th line — coverage spans the WHOLE video)`;
    } else {
      body = body.slice(0, TRANSCRIPT_LIMIT);
      note = '\n(transcript truncated)';
    }
  }
  return {
    role: 'system',
    content:
      `You are watching this YouTube video WITH the viewer. Same couch, same second.\n` +
      `Title: ${title || '(unknown)'}\n` +
      `Video ID: ${id}\n\n` +
      `You hold the FULL transcript below. It is your knowledge of this video — earlier, current AND later sections alike.\n` +
      `Each chat message starts with a WATCHHEAD: where the viewer is right now, plus the lines playing around them.\n` +
      `The WATCHHEAD is the viewer’s position, NOT a limit on what you know or may discuss.\n\n` +
      `Rules:\n` +
      `- Questions about any part or the whole video (fact-checks, “what happens later”, conclusions): answer FULLY from the transcript, citing [m:ss].\n` +
      `- Avoid UNSOLICITED spoilers only: don’t volunteer endings/twists while answering about earlier moments. If the question itself targets later parts or the entire video, answering completely is not spoiling — it is answering.\n` +
      `- “This”, “what they just said”, “why now” = the watchhead window in the message.\n` +
      `- Cite times as [m:ss] so they can jump. Keep answers tight.\n` +
      `- If it isn’t in the transcript, say so. Match their language. No preamble.\n` +
      (searchOn
        ? `- You can search the web (web_search). Use it for anything outside the video or time-sensitive; cite sources as markdown links.\n`
        : '') +
      note +
      `\nFull transcript:\n${body || '(no transcript available)'}`
  };
}

export const PROMPTS = {
  summary:
    'Write a briefing for someone who has not watched yet.\n\n' +
    '## The gist\n2–3 sentences.\n\n' +
    '## Worth knowing\n5–8 concrete bullets. No generic filler.\n\n' +
    '## Key moments\n- [m:ss] what happens — why it matters\n\n' +
    '## Quotes\nUp to 3 short quotes with [m:ss] if you can.\n\n' +
    'No intro sentence before the first heading.',
  highlights:
    'Pick 5–8 moments a busy viewer should jump to. ' +
    'JSON only, shape: {"highlights":[{"t":<integer seconds>,"title":"<≤6 words>","detail":"<one sentence>"}]}'
};

export function parseHighlights(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return [];
    json = JSON.parse(m[0]);
  }
  const arr = json.highlights || json.moments || (Array.isArray(json) ? json : []);
  return arr.map((h) => ({
    t: Math.max(0, Math.round(Number(h.t ?? h.time ?? h.seconds) || 0)),
    title: String(h.title || h.heading || 'Moment').trim(),
    detail: String(h.detail || h.summary || h.description || '').trim()
  })).filter((h) => h.title);
}
