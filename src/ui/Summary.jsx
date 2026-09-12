import React, { useRef, useState } from 'react';
import { Copy, Check, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Md } from '../lib/markdown.jsx';
import { complete, PROMPTS } from '../lib/api.js';

export default function Summary({ system, model, cues, cached, onCached }) {
  const [text, setText] = useState(cached || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const job = useRef(null);

  React.useEffect(() => { if (cached && !text) setText(cached); }, [cached]);

  async function run() {
    if (!cues?.length) return;
    job.current?.abort();
    setBusy(true); setErr(''); setText('');
    const j = complete({
      model,
      stream: true,
      messages: [system, { role: 'user', content: PROMPTS.summary }],
      onDelta: (full) => setText(full)
    });
    job.current = j;
    try {
      const out = await j.promise;
      setText(out);
      onCached?.(out);
    } catch (e) {
      setErr(e.message || String(e));
    }
    setBusy(false);
  }

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  if (cues === null) return <div>{[1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" />)}</div>;
  if (!cues.length) {
    return (
      <div className="center-note">
        <Sparkles size={22} />
        <strong>Nothing to summarize</strong>
        This video has no transcript, so a summary would just be guessing.
      </div>
    );
  }

  if (!text && !busy) {
    return (
      <div className="hero">
        <div className="hero-inner">
          <div className="orb"><Sparkles size={22} /></div>
          <h2>Briefing</h2>
          <p>One pass over the transcript. Cached on this device so you don’t pay twice.</p>
          <button className="btn btn-primary" onClick={run}>Generate summary</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pane-bar">
        <button className="btn-ghost" onClick={copy} disabled={!text}>{copied ? <Check size={13} /> : <Copy size={13} />} Copy</button>
        <button className="btn-ghost" onClick={run} disabled={busy}>
          {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {busy ? 'Writing…' : 'Regenerate'}
        </button>
      </div>
      <div className="scroll" style={{ padding: '8px 16px 20px' }}>
        {err && <div className="err">{err}</div>}
        {text ? <Md text={text} /> : <div className="skel" />}
      </div>
    </>
  );
}
