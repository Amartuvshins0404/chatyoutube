import React, { useState } from 'react';
import { KeyRound, Loader2, MessagesSquare } from 'lucide-react';
import { probeModel } from '../lib/api.js';
import ModelPicker from './ModelPicker.jsx';

export default function Setup({ onSave }) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  async function testAndSave() {
    const key = apiKey.trim();
    if (!key || !model) return;
    setBusy(true); setErr(''); setOk(false);
    const r = await probeModel(key, model);
    if (!r.ok) {
      setErr(r.error);
      setBusy(false);
      return;
    }
    setOk(true);
    await onSave({ apiKey: key, model });
    setBusy(false);
  }

  return (
    <div className="hero">
      <div className="hero-inner">
        <div className="orb"><MessagesSquare size={22} /></div>
        <h2>Chat about this video</h2>
        <p>Answers come from the transcript via the ChatGPT API. Your key never leaves this browser except to OpenAI.</p>

        <div className="field">
          <label htmlFor="cyt-key">OpenAI API key</label>
          <input id="cyt-key" className="input" type="password" autoComplete="off" spellCheck="false"
            placeholder="sk-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') testAndSave(); }} />
        </div>
        <div className="field">
          <label>Model (live from your key)</label>
          <ModelPicker apiKey={apiKey.trim()} value={model} onChange={setModel} />
        </div>

        {err && <div className="err">{err}</div>}
        {ok && <div className="ok">Key and model check out. You’re in.</div>}

        <button className="btn btn-primary" disabled={busy || !apiKey.trim() || !model} onClick={testAndSave}>
          {busy ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />}
          {busy ? 'Checking key & model…' : 'Test & start'}
        </button>
        <p className="hint">
          Create a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>.
          Stored in chrome.storage — no account, no server of ours.
        </p>
      </div>
    </div>
  );
}
