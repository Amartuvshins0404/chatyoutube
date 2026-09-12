import React, { useRef, useState } from 'react';
import { Highlighter, Loader2, RefreshCw } from 'lucide-react';
import { complete, parseHighlights, PROMPTS } from '../lib/api.js';
import { fmt, seek } from '../lib/time.js';

export default function Highlights({ system, model, cues, cached, onCached }) {
  const [items, setItems] = useState(cached || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const job = useRef(null);

  React.useEffect(() => { if (cached && !items) setItems(cached); }, [cached]);

  async function run() {
    if (!cues?.length) return;
    job.current?.abort();
    setBusy(true); setErr('');
    const j = complete({
      model,
      stream: false,
      json: true,
      messages: [system, { role: 'user', content: PROMPTS.highlights }]
    });
    job.current = j;
    try {
      const out = parseHighlights(await j.promise);
      setItems(out);
      onCached?.(out);
    } catch (e) {
      setErr(e.message || String(e));
    }
    setBusy(false);
  }

  if (cues === null) return <div>{[1, 2, 3, 4].map((i) => <div key={i} className="skel" />)}</div>;
  if (!cues.length) {
    return (
      <div className="center-note">
        <Highlighter size={22} />
        <strong>No moments to mark</strong>
        Highlights are jumped from the transcript.
      </div>
    );
  }

  if (!items && !busy) {
    return (
      <div className="hero">
        <div className="hero-inner">
          <div className="orb"><Highlighter size={22} /></div>
          <h2>Jump to the good parts</h2>
          <p>We’ll pick 5–8 timestamps worth watching. Click any card to seek the player.</p>
          <button className="btn btn-primary" onClick={run}>Find highlights</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pane-bar">
        <button className="btn-ghost" onClick={run} disabled={busy}>
          {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {busy ? 'Finding…' : 'Regenerate'}
        </button>
      </div>
      <div className="scroll">
        <div className="stack">
          {err && <div className="err">{err}</div>}
          {busy && !items && [1, 2, 3].map((i) => <div key={i} className="skel" />)}
          {(items || []).map((h, i) => (
            <button key={i} className="hl" onClick={() => seek(h.t)}>
              <div className="hl-top">
                <span className="hl-t">{fmt(h.t)}</span>
                <span className="hl-title">{h.title}</span>
              </div>
              {h.detail && <p className="hl-d">{h.detail}</p>}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
