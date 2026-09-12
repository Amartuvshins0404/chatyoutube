import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { listModels, probeModel } from '../lib/api.js';

const CUSTOM = '__custom__';

const isChat = (id) =>
  /^(gpt-|o\d|chatgpt-)/.test(id) &&
  !/(realtime|audio|search|instruct|transcrib|tts|dall|embedding|moderation|guard|safety)/.test(id) &&
  !/^(davinci|babbage|text-|code-)/.test(id);

function rank(id) {
  if (/^gpt-5/.test(id)) return 0;
  if (/^o[3-9]/.test(id)) return 1;
  if (/^o1/.test(id)) return 2;
  if (/^gpt-4\.1/.test(id)) return 3;
  if (/^gpt-4o/.test(id)) return 4;
  if (/^gpt-4/.test(id)) return 5;
  if (/^chatgpt-/.test(id)) return 6;
  if (/^gpt-/.test(id)) return 7;
  return 9;
}

export default function ModelPicker({ apiKey, value, onChange, predicate, noProbe }) {
  const [all, setAll] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [custom, setCustom] = useState(false);
  const [probe, setProbe] = useState(null); // null | 'checking' | { ok, error }

  async function load() {
    if (!apiKey) { setAll([]); return; }
    setLoading(true);
    setErr('');
    try {
      setAll(await listModels(apiKey));
    } catch (e) {
      setErr(e.message || String(e));
      setAll([]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [apiKey]);

  // live-compat probe: catches non-chat / unavailable models before they bite
  useEffect(() => {
    if (noProbe) { setProbe(null); return; }
    if (!apiKey || !value) { setProbe(null); return; }
    setProbe('checking');
    const t = setTimeout(async () => {
      const r = await probeModel(apiKey, value);
      setProbe(r);
    }, 450);
    return () => clearTimeout(t);
  }, [apiKey, value]);

  const list = ((all || []).filter((m) => showAll || (predicate ? predicate(m) : isChat(m))))
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const known = !!all?.includes(value);
  const isCustom = custom || (!!all?.length && !known);
  const sel = isCustom ? CUSTOM : value;

  return (
    <div>
      <div className="picker-row">
        <select
          className="select"
          value={sel}
          disabled={loading || !all?.length}
          onChange={(e) => {
            const v = e.target.value;
            if (v === CUSTOM) setCustom(true);
            else { setCustom(false); onChange(v); }
          }}
        >
          <option value="" disabled>{loading ? 'Loading models…' : (all?.length ? 'Pick a model' : 'No models loaded')}</option>
          {list.map((m) => <option key={m} value={m}>{m}</option>)}
          <option value={CUSTOM}>Custom model ID…</option>
        </select>
        <button type="button" className="icon-btn" onClick={load} disabled={!apiKey || loading} title="Refresh model list">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {isCustom && (
        <input
          className="input"
          style={{ marginTop: 6 }}
          value={value}
          placeholder="any model id, e.g. gpt-4o-2024-11-20"
          spellCheck="false"
          autoComplete="off"
          onChange={(e) => onChange(e.target.value.trim())}
        />
      )}

      {probe === 'checking' && (
        <span className="mini"><Loader2 size={11} className="spin" /> checking “{value}” against the chat API…</span>
      )}
      {probe && probe !== 'checking' && probe.ok && (
        <span className="mini ok-inline">✓ “{value}” chats fine on this key</span>
      )}
      {probe && probe !== 'checking' && !probe.ok && (
        <span className="err-inline">{probe.error}</span>
      )}
      {err && <span className="err-inline">{err}</span>}
      {!err && all?.length > 0 && (
        <label className="mini">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          show all {all.length} models on this key
        </label>
      )}
    </div>
  );
}
