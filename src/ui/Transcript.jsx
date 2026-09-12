import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, Copy, Check } from 'lucide-react';
import { fmt, seek } from '../lib/time.js';

export default function Transcript({ cues }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const listRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    const v = document.querySelector('video');
    if (!v || !cues?.length) return;
    const on = () => {
      const t = v.currentTime * 1000;
      let i = 0;
      for (let k = 0; k < cues.length; k++) {
        if (cues[k].offset <= t) i = k;
        else break;
      }
      setActive(i);
    };
    v.addEventListener('timeupdate', on);
    on();
    return () => v.removeEventListener('timeupdate', on);
  }, [cues]);

  useEffect(() => {
    if (!follow || q) return;
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active, follow, q]);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    const all = (cues || []).map((c, i) => ({ c, i }));
    if (query) return all.filter(({ c }) => c.text.toLowerCase().includes(query));
    if (!cues || cues.length < 500) return all;
    const from = Math.max(0, active - 90);
    const to = Math.min(cues.length, active + 140);
    return all.slice(from, to);
  }, [cues, q, active]);

  if (cues === null) {
    return <div>{[1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="skel" />)}</div>;
  }
  if (!cues.length) {
    return (
      <div className="center-note">
        <AlignLeft size={22} />
        <strong>No captions on this video</strong>
        Auto-captions and uploaded subtitles are both missing, so there’s nothing to read or send to the model.
      </div>
    );
  }

  async function copyAll() {
    const text = cues.map((c) => `[${fmt(c.offset / 1000)}] ${c.text}`).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <>
      <div className="tools">
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transcript" />
        <button className="btn-ghost" onClick={() => setFollow((f) => !f)} title="Keep the current line in view">
          {follow ? 'Following' : 'Follow'}
        </button>
        <button className="icon-btn" onClick={copyAll} title="Copy transcript">
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <div className="scroll" ref={listRef}>
        {q && !rows.length && <div className="center-note">No lines match “{q}”.</div>}
        {rows.map(({ c, i }) => (
          <button
            key={i}
            ref={i === active && !q ? activeRef : null}
            className={'cue' + (i === active ? ' is-on' : '')}
            onClick={() => seek(c.offset / 1000)}
          >
            <span className="cue-t">{fmt(c.offset / 1000)}</span>
            <span className="cue-x">{c.text}</span>
          </button>
        ))}
      </div>
    </>
  );
}
