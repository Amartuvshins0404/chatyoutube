import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Radio, RefreshCw, Hand } from 'lucide-react';
import { RealtimeSession } from '../lib/live.js';
import ModelPicker from './ModelPicker.jsx';
import { cueIndex, usePlayhead } from '../lib/playhead.js';
import { asText } from '../lib/transcript.js';
import { fmt } from '../lib/time.js';

const VOICES = ['alloy', 'echo', 'shimmer', 'verse', 'ballad', 'marin', 'cedar'];
const isLive = (id) => /live|realtime/.test(id);

export default function Live({ settings, patchSettings, title, id, cues }) {
  const [status, setStatus] = useState('idle'); // idle | mic | connecting | live | closed
  const [err, setErr] = useState('');
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [log, setLog] = useState([]);
  const [needTap, setNeedTap] = useState(false);
  const [liveModel, setLiveModel] = useState(settings.liveModel || 'gpt-live-1');
  const [voice, setVoice] = useState(settings.voice || 'alloy');

  const sess = useRef(null);
  const audioRef = useRef(null);
  const botText = useRef('');
  const scroller = useRef(null);
  const { now } = usePlayhead();
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  useEffect(() => () => sess.current?.stop(), []);
  useEffect(() => { sess.current?.stop(); sess.current = null; setStatus('idle'); }, [id]);

  const instructions = () => {
    const t = nowRef.current;
    const i = cueIndex(cues, t);
    const line = i >= 0 ? cues[i].text : '';
    const excerpt = asText((cues || []).slice(Math.max(0, i - 25), i + 10));
    return (
      `You are the voice companion for a YouTube video the listener is watching RIGHT NOW.\n` +
      `Video: ${title || 'unknown'}\nListener is at ${fmt(t)} in the video.` +
      (line ? ` On screen right now: "${line}"` : '') +
      `\nRecent transcript around them:\n${excerpt || '(no captions)'}\n\n` +
      `Voice rules: short spoken sentences. No markdown, no headings. Answer from what is playing; ` +
      `do not spoil later parts unless asked. If they ask "what did they just say", use the lines above.`
    );
  };

  async function connect() {
    setErr(''); setLog([]); setMuted(false); setNeedTap(false);
    const s = new RealtimeSession({
      model: liveModel,
      apiKey: settings.apiKey,
      voice,
      instructions,
      onStatus: (st) => setStatus(st),
      onLevel: setLevel,
      onRemoteStream: (stream) => {
        const a = audioRef.current;
        if (!a) return;
        a.srcObject = stream;
        a.play().catch(() => setNeedTap(true));
      },
      onEvent: (ev) => {
        if (ev.type === 'conversation.item.input_audio_transcription.completed' && ev.transcript) {
          setLog((l) => [...l, { who: 'user', text: ev.transcript }]);
        } else if (ev.type === 'response.audio_transcript.delta' && ev.delta) {
          botText.current += ev.delta;
          const t = botText.current;
          setLog((l) => {
            const n = [...l];
            if (n[n.length - 1]?.who === 'ai') n[n.length - 1] = { who: 'ai', text: t };
            else n.push({ who: 'ai', text: t });
            return n;
          });
        } else if (ev.type === 'response.done') {
          botText.current = '';
        } else if (ev.type === 'error') {
          setErr(ev.error?.message || 'Realtime error');
        }
      }
    });
    sess.current = s;
    try {
      await s.start();
    } catch (e) {
      setErr(e.message || String(e));
      setStatus('idle');
      sess.current = null;
    }
  }

  function disconnect() {
    sess.current?.stop();
    sess.current = null;
    setStatus('idle');
    setLevel(0);
  }

  const live = status === 'live';

  return (
    <>
      <audio ref={audioRef} style={{ display: 'none' }} />

      {!live && status !== 'connecting' && status !== 'mic' ? (
        <div className="scroll">
          <div className="hero" style={{ minHeight: 0, padding: '24px 18px' }}>
            <div className="hero-inner" style={{ maxWidth: 300 }}>
              <div className="orb"><Radio size={22} /></div>
              <h2>Watch together, out loud</h2>
              <p>Full-duplex voice: talk over the video, interrupt the AI, it hears you while it speaks — and it knows your exact second.</p>

              <div className="field">
                <label>Speech model</label>
                <ModelPicker
                  apiKey={settings.apiKey}
                  value={liveModel}
                  onChange={(v) => { setLiveModel(v); patchSettings({ liveModel: v }); }}
                  predicate={isLive}
                  noProbe
                />
              </div>
              <div className="field">
                <label>Voice</label>
                <select className="select" value={voice} onChange={(e) => { setVoice(e.target.value); patchSettings({ voice: e.target.value }); }}>
                  {VOICES.map((v) => <option key={v}>{v}</option>)}
                </select>
              </div>

              {err && <div className="err">{err}</div>}

              <button className="btn btn-primary" onClick={connect} disabled={!settings.apiKey}>
                <Mic size={16} /> Start voice session
              </button>
              <p className="hint">YouTube will ask for microphone permission. Audio stays between this tab and OpenAI.</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="callbar">
            <span className={'pill' + (live ? ' on' : '')}>
              <span className={'dot' + (live ? '' : ' paused')} />
              {status === 'mic' ? 'mic…' : status === 'connecting' ? 'connecting…' : status === 'closed' ? 'ended' : 'LIVE'}
            </span>
            <div className="meter"><div className="meter-fill" style={{ width: Math.min(100, level * 160) + '%' }} /></div>
            <button className="icon-btn" title={muted ? 'Unmute mic' : 'Mute mic'} onClick={() => { const m = !muted; setMuted(m); sess.current?.setMuted(m); }}>
              {muted ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button className="icon-btn" title="Re-sync AI to your current second" onClick={() => sess.current?.updateSession()}>
              <RefreshCw size={15} />
            </button>
            <button className="icon-btn danger" title="End session" onClick={disconnect}>
              <PhoneOff size={15} />
            </button>
          </div>

          {needTap && (
            <button className="banner tap" onClick={() => { audioRef.current?.play().catch(() => {}); setNeedTap(false); }}>
              <Hand size={13} /> Tap to enable the AI’s voice
            </button>
          )}
          {err && <div className="banner err-banner">{err}</div>}

          <div className="scroll log" ref={scroller}>
            {log.length === 0 && (
              <div className="center-note">
                <Radio size={22} />
                <strong>Listening…</strong>
                Just talk. It answers out loud and captions appear here. Interrupt anytime.
              </div>
            )}
            {log.map((l, i) => (
              <div key={i} className={'log-line ' + l.who}>
                <span className="who">{l.who === 'user' ? 'You' : 'AI'}</span>
                {l.text}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
