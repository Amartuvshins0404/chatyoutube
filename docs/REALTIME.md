# Research: `gpt-live-1` (full-duplex speech-to-speech) in this extension

## What the model is

`gpt-live-1` belongs to OpenAI's **Realtime** family (predecessors: `gpt-4o-realtime-preview`, `gpt-realtime`).
These are speech-to-speech models: microphone audio in, voice audio out, **full duplex** —
the model hears you while it talks, and server-side VAD handles turn-taking and barge-in.

Evidence from this project: selecting a "gpt live" model in Chat returned
*"This is not a chat model and thus not supported in the v1/chat/completions endpoint"* —
Realtime models are served by a **different API**, not chat/completions. So the product needs a
separate surface: a **Live tab**.

## The API contract we code against

### Transport: WebRTC (the browser-safe one)

- `POST https://api.openai.com/v1/realtime/calls?model=<model>`
  - headers: `Authorization: Bearer <key>`, `Content-Type: application/sdp`
  - body: raw SDP **offer**
  - response: SDP **answer** (text)
- The alternative transport (`wss://api.openai.com/v1/realtime?model=…`) needs
  `Authorization` + `OpenAI-Beta` **headers on the WebSocket handshake, which browsers cannot set**.
  ⇒ WebRTC is the only clean path from a web page; the SDP exchange (the only key-bearing HTTP
  call) happens in the **service worker**.
- After the handshake: **audio rides RTP** (true full duplex), **control events ride an SCTP
  data channel** the client creates (label `oai-events`, JSON lines).

### Session config (client → server, on the data channel)

`session.update` with:
```json
{
  "modalities": ["audio", "text"],
  "voice": "alloy",
  "input_audio_format": "pcm16",
  "output_audio_format": "pcm16",
  "input_audio_transcription": { "model": "whisper-1" },
  "turn_detection": { "type": "server_vad", "threshold": 0.5,
                      "prefix_padding_ms": 300, "silence_duration_ms": 600 },
  "instructions": "…"
}
```
- `server_vad` = duplex turn taking + barge-in for free.
- `input_audio_transcription` gives us *what the user said* as text (for the caption log).

### Event flow we consume

| Direction | Event | Use |
|---|---|---|
| → | `session.update` | configure / re-sync context |
| → | `response.cancel` | (future) cut the model off |
| ← | `session.created` / `session.updated` | handshake ack |
| ← | `conversation.item.input_audio_transcription.completed` | user speech → log |
| ← | `response.audio_transcript.delta` / `.done` | model speech as text → live captions |
| ← | `response.done`, `error` | turn boundaries / surfacing failures |

Audio itself never appears as events on WebRTC — it arrives as an RTP track
(`pc.ontrack` → `MediaStream` → `<audio>` element).

## Extension-specific constraints (MV3)

1. **Key never in the page.** SDP exchange goes through `chrome.runtime.sendMessage`
   → service worker does the authenticated POST → answer SDP comes back.
2. **Mic permission** is requested from the content script, so the prompt is attributed to
   `youtube.com` (secure context ✓). We ask only on Connect click.
3. **Output audio**: `<audio srcObject=remoteStream>` inside the Shadow DOM. Autoplay is
   satisfied by sticky activation (the Connect click); a tap-to-enable fallback covers rejection.
4. **Lifecycle**: session tears down on tab switch, panel collapse-navigation, video change
   (`yt:navigate-finish` → new video id) and unmount. No orphaned mic.
5. **Model gating**: Realtime models 400 on chat/completions; chat models 400 on Realtime.
   ⇒ separate `settings.liveModel` (default `gpt-live-1`), picker filtered by `/live|realtime/`,
   chat-probe disabled for that picker (a chat probe would falsely flag a realtime model).
6. **Context sync**: `instructions` carry video title + transcript excerpt around the playhead +
   the exact watchhead second. A **Sync** button re-sends `session.update` with a fresh watchhead
   so the voice stays on the same page as the viewer mid-call.

## Assumptions / open questions (2026 model, verified against the stable contract)

- `gpt-live-1` accepts the GA Realtime contract above (same as `gpt-realtime`). If OpenAI renamed
  an event or field, the error surfaces verbatim in the Live tab and the transport still connects.
- Voice ids: `alloy, echo, shimmer, verse, ballad, marin, cedar` — picker offers them, custom
  typing allowed; unknown voice = server error shown, not a crash.
- If a future live model drops WebRTC for WS-only, the fix is one new SW handler (ephemeral
  client-secret flow); nothing in the UI changes.

## Files

- `src/background.js` — `rtc-connect` message handler (SDP exchange, key-bearing)
- `src/lib/live.js` — `RealtimeSession` (peer connection, data channel, VAD config, meter, mute)
- `src/ui/Live.jsx` — the Live tab (connect/call UI, live captions, sync, mute, end)
