import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Loader2, MessagesSquare, Pause, Play, Send, Square } from 'lucide-react';
import { Md } from '../lib/markdown.jsx';
import { complete } from '../lib/api.js';
import { cueIndex, usePlayhead, wrapUser } from '../lib/playhead.js';
import { fmt } from '../lib/time.js';

const SUGGEST = [
  'What are they saying right now?',
  'Explain the last minute like I zoned out',
  'Search the web for follow-ups on this'
];
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'];

function Progress({ since, phase }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return <span className="thinking" role="status"><Loader2 size={13} className="spin" /> {phase} · {seconds}s</span>;
}

export default function Chat({ system, model, cues, cached, onCached, effort, onEffort }) {
  const [msgs, setMsgs] = useState(cached || []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busySince, setBusySince] = useState(0);
  const [phase, setPhase] = useState('Waiting for OpenAI');
  const [tool, setTool] = useState('');
  const { now, paused } = usePlayhead();
  const scroller = useRef(null);
  const ta = useRef(null);
  const job = useRef(null);

  useEffect(() => { if (cached?.length && msgs.length === 0) setMsgs(cached); }, [cached]);
  useEffect(() => () => {
    const active = job.current;
    job.current = null;
    active?.transport?.abort();
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  const liveLine = useMemo(() => {
    const i = cueIndex(cues, now);
    return i >= 0 ? cues[i].text : '';
  }, [cues, now]);

  function grow() {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  async function send(text, retry = false) {
    if (job.current || cues === null) return;
    const question = (text ?? input).trim();
    if (!question && !retry) return;
    let history;
    if (retry) {
      // Replace the failed attempt, don't duplicate the user's question or shift its timestamp.
      const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
      if (lastUser < 0) return;
      history = msgs.slice(0, lastUser + 1);
    } else {
      const actualTime = document.querySelector('video')?.currentTime ?? now;
      history = [...msgs, { role: 'user', content: question, t: Math.floor(actualTime) }];
      setInput('');
      if (ta.current) ta.current.style.height = 'auto';
    }
    const token = {};
    job.current = token;
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setBusy(true);
    setBusySince(Date.now());
    setPhase('Waiting for OpenAI');
    setTool('');

    const apiHistory = history
      .filter((m) => ['user', 'assistant'].includes(m.role) && m.content?.trim() && !m.error)
      .map((m) => ({
        role: m.role,
        content: m.role === 'user' ? wrapUser(m.content, m.t ?? 0, cues) : m.content
      }));
    const transport = complete({
      model, stream: true, allowTools: true, effort,
      messages: [system, ...apiHistory],
      onDelta(full) {
        if (job.current !== token) return;
        setPhase('Writing answer');
        setTool('');
        setMsgs([...history, { role: 'assistant', content: full }]);
      },
      onTool(event) {
        if (job.current !== token) return;
        setTool(event.status === 'completed' ? '' : event.query || 'the web');
      },
      onStatus(value) { if (job.current === token) setPhase(value); }
    });
    token.transport = transport;
    let final;
    try {
      const content = await transport.promise;
      if (job.current !== token) return;
      final = [...history, { role: 'assistant', content }];
    } catch (error) {
      if (job.current !== token) return;
      final = [...history, {
        role: 'assistant', content: error.partialText || '',
        error: error.name === 'AbortError' ? 'Stopped.' : error.message,
        requestId: error.requestId
      }];
    } finally {
      if (job.current === token) {
        job.current = null;
        setBusy(false);
        setTool('');
      }
    }
    if (final) {
      setMsgs(final);
      onCached?.(final);
    }
  }

  return (
    <>
      {cues === null && <div className="banner" role="status">Loading the video transcript before sending…</div>}
      {cues && !cues.length && <div className="banner">No captions found. The AI knows your timestamp but has no transcript to read.</div>}
      <div className="scroll msgs" ref={scroller}>
        {msgs.length === 0 && (
          <div className="hero" style={{ minHeight: 260 }}>
            <div className="hero-inner">
              <div className="orb"><MessagesSquare size={22} /></div>
              <h2>Ask about the video</h2>
              <p>Questions include the transcript and your current second. Refer to any part of the video.</p>
              <div className="chips">
                {SUGGEST.map((s) => <button key={s} className="suggest" disabled={cues === null} onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'row ' + (m.role === 'user' ? 'user' : 'bot')}>
            <div className="bubble">
              {m.role === 'user' ? (
                <>{m.content}{m.t != null && <span className="stamp">asked at {fmt(m.t)}</span>}</>
              ) : (
                <>
                  {m.content && <Md text={m.content} />}
                  {busy && i === msgs.length - 1 ? (
                    <Progress since={busySince} phase={phase} />
                  ) : (m.error || !m.content?.trim()) && (
                    <div>
                      <p className="err-inline" role="alert">{m.error || 'This earlier request ended without an answer.'}</p>
                      {m.requestId && <p className="empty-note">Request: {m.requestId}</p>}
                      {i === msgs.length - 1 && <button className="btn btn-ghost" disabled={cues === null || busy} onClick={() => send(undefined, true)}>Retry question</button>}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {tool && <div className="banner tool-banner"><Globe size={13} /> Searching the web: {tool}…</div>}
      <div className="nowbar" title="Your current playback position">
        <span className={'dot' + (paused ? ' paused' : '')} />
        <span className="t">{fmt(now)}</span>
        <span className="line">{liveLine || (cues === null ? 'loading captions…' : '—')}</span>
        {paused ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
      </div>
      <div className="composer">
        <select className="effort" value={effort} disabled={busy} onChange={(e) => onEffort(e.target.value)} aria-label="Reasoning effort">
          {EFFORTS.map((e) => <option key={e} value={e}>{'effort: ' + e}</option>)}
        </select>
        <textarea ref={ta} className="area" rows={1} value={input} aria-label="Question about the video"
          placeholder={`Ask at ${fmt(now)}…`}
          onChange={(e) => { setInput(e.target.value); grow(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }} />
        {busy ? (
          <button className="send" onClick={() => job.current?.transport?.abort()} title="Stop" aria-label="Stop response"><Square size={14} fill="currentColor" /></button>
        ) : (
          <button className="send" disabled={!input.trim() || cues === null} onClick={() => send()} aria-label="Send"><Send size={16} /></button>
        )}
      </div>
    </>
  );
}
