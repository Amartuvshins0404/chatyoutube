import React, { useState } from 'react';
import { Loader2, Settings, X } from 'lucide-react';
import { probeModel } from '../lib/api.js';
import ModelPicker from './ModelPicker.jsx';

function searchLabel(s) {
  const p = s.searchProvider ?? 'duckduckgo';
  if (p === 'off') return 'off';
  if (p === 'openai') return 'OpenAI native';
  if (p === 'searxng') {
    if (!s.searxUrl) return 'SearXNG (not connected yet)';
    try { return 'SearXNG · ' + new URL(s.searxUrl).host; } catch { return 'SearXNG'; }
  }
  return 'DuckDuckGo';
}

export default function SettingsModal({ settings, onClose, onSave }) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    const key = apiKey.trim();
    if (!key || !model) return;
    setBusy(true);
    setErr('');
    const r = await probeModel(key, model);
    if (!r.ok) {
      setErr(r.error);
      setBusy(false);
      return;
    }
    await onSave({ apiKey: key, model });
  }

  return (
    <div className="modal" onClick={onClose} role="dialog" aria-label="Settings">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Settings size={15} /> Settings</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="field" style={{ marginTop: 0 }}>
          <label>OpenAI API key</label>
          <input className="input" type="password" autoComplete="off" spellCheck="false"
            value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div className="field">
          <label>Model (live from your key)</label>
          <ModelPicker apiKey={apiKey.trim() || settings.apiKey} value={model} onChange={setModel} />
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Web search: {searchLabel(settings)} — change it in the toolbar popup.
        </p>
        {err && <div className="err">{err}</div>}
        <button className="btn btn-primary" disabled={busy || !model} onClick={save}>
          {busy ? <Loader2 size={15} className="spin" /> : null}
          {busy ? 'Verifying model…' : 'Save'}
        </button>
        <p className="hint">Requests go to api.openai.com only. We don’t operate a backend.</p>
      </div>
    </div>
  );
}
