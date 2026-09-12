import React, { useEffect, useMemo, useState } from 'react';
import { EyeOff, PanelRightClose, Play, Settings } from 'lucide-react';
import { currentVideoId, pageTitle } from './lib/time.js';
import { asText, loadTranscript, onPlayerMessage } from './lib/transcript.js';
import { getSessions, getSettings, getVideo, onSettingsChange, saveSettings, saveVideo } from './lib/storage.js';
import { systemPrompt } from './lib/api.js';
import { useFullscreen } from './lib/youtube.js';
import Setup from './ui/Setup.jsx';
import SettingsModal from './ui/Settings.jsx';
import Transcript from './ui/Transcript.jsx';
import Summary from './ui/Summary.jsx';
import Highlights from './ui/Highlights.jsx';
import Chat from './ui/Chat.jsx';
import Live from './ui/Live.jsx';

const TABS = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'summary', label: 'Summary' },
  { id: 'chat', label: 'Chat' },
  { id: 'live', label: 'Live' },
  { id: 'highlights', label: 'Highlights' }
];

function useVideoId() {
  const [id, setId] = useState(currentVideoId);
  useEffect(() => {
    const tick = () => {
      const n = currentVideoId();
      setId((cur) => (n !== cur ? n : cur));
    };
    const unsub = onPlayerMessage((p) => { if (p.videoId) setId(p.videoId); });
    document.addEventListener('yt:navigate-finish', tick);
    document.addEventListener('yt-page-data-updated', tick);
    window.addEventListener('popstate', tick);
    const t = setInterval(tick, 1200);
    return () => {
      unsub();
      document.removeEventListener('yt-navigate-finish', tick);
      document.removeEventListener('yt-page-data-updated', tick);
      window.removeEventListener('popstate', tick);
      clearInterval(t);
    };
  }, []);
  return id;
}

export default function App({ layout }) {
  const id = useVideoId();
  const fs = useFullscreen();
  const [settings, setSettings] = useState(null);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState('chat');
  const [showSettings, setShowSettings] = useState(false);
  const [title, setTitle] = useState('');
  const [cues, setCues] = useState(null);
  const [cache, setCache] = useState(null);
  const [cacheReady, setCacheReady] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [sid, setSid] = useState(null);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setOpen(s.open !== false);
      setTab(s.lastTab || 'chat');
    });
    return onSettingsChange((s) => s && setSettings((cur) => ({ ...cur, ...s })));
  }, []);

  useEffect(() => { layout.setOpen(open); }, [open, layout]);
  useEffect(() => {
    layout.setOpts({ hideTray: !!settings?.hideTray });
  }, [settings?.hideTray, layout]);

  // Alt+Shift+C: bring the panel back from any state (even fully hidden)
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        const t = e.target;
        if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    if (!id) { setCues([]); setCache(null); setCacheReady(true); setSessions(null); setSid(null); return; }
    let dead = false;
    setCues(null);
    setCacheReady(false);
    setSessions(null);
    setSid(null);
    setTitle(pageTitle());
    getVideo(id).then((v) => { if (!dead) { setCache(v); setCacheReady(true); } });
    getSessions(id).then(({ sessions: list, active }) => {
      if (dead) return;
      setSessions(list);
      setSid(active);
    });
    loadTranscript(id).then((list) => {
      if (dead) return;
      setCues(list);
      setTitle((t) => pageTitle() || t);
      saveVideo(id, { cues: list });
    });
    return () => { dead = true; };
  }, [id]);

  const transcript = useMemo(() => asText(cues || []), [cues]);
  const searchOn = (settings?.searchProvider ?? 'duckduckgo') !== 'off';
  const system = useMemo(
    () => systemPrompt({ title, id, transcript, cues, searchOn }),
    [title, id, transcript, cues, searchOn]
  );

  function toggle(v) {
    setOpen(v);
    saveSettings({ open: v });
  }
  function hideCompletely() {
    setOpen(false);
    saveSettings({ open: false, hideTray: true });
  }
  function switchTab(next) {
    setTab(next);
    saveSettings({ lastTab: next });
  }
  function persistSessions(next, active) {
    setSessions(next);
    setSid(active);
    saveVideo(id, { sessions: next, activeSession: active });
  }

  if (!id) return null;
  if (!settings) return <div className="app" />;

  // fullscreen: the video gets the whole screen, always
  if (fs) return null;

  if (!open && settings.hideTray) return null;

  if (!open) {
    return (
      <button className="chip" onClick={() => toggle(true)} aria-label="Open ChatYouTube">
        <span className="mark"><Play size={13} fill="currentColor" /></span>
        <span className="chip-name">ChatYouTube</span>
        <span className="chip-cta">Open</span>
      </button>
    );
  }

  const activeSess = sessions?.find((s) => s.id === sid);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="mark"><Play size={13} fill="currentColor" /></span>
          <span className="brand-name">ChatYouTube</span>
        </div>
        <div className="header-actions">
          <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => setShowSettings(true)}>
            <Settings size={16} />
          </button>
          <button className="icon-btn" title="Hide completely (Alt+Shift+C to bring back)" aria-label="Hide completely" onClick={hideCompletely}>
            <EyeOff size={16} />
          </button>
          <button className="icon-btn" title="Collapse" aria-label="Collapse" onClick={() => toggle(false)}>
            <PanelRightClose size={16} />
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' is-on' : '')} onClick={() => switchTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="body">
        {!settings.apiKey ? (
          <Setup onSave={async (s) => setSettings(await saveSettings(s))} />
        ) : (
          <>
            {tab === 'transcript' && <Transcript key={id} cues={cues} />}
            {tab === 'summary' && cacheReady && (
              <Summary
                key={id}
                system={system}
                model={settings.model}
                cues={cues}
                cached={cache?.summary}
                onCached={(summary) => { setCache((c) => ({ ...c, summary })); saveVideo(id, { summary }); }}
              />
            )}
            {tab === 'chat' && cacheReady && sessions && (
              <Chat
                key={id + ':' + sid}
                system={system}
                model={settings.model}
                cues={cues}
                cached={activeSess?.messages}
                sessions={sessions}
                sid={sid}
                onSwitch={(s) => persistSessions(sessions, s)}
                onNew={() => {
                  const n = { id: 's' + Date.now().toString(36), name: 'Session ' + (sessions.length + 1), messages: [] };
                  persistSessions([...sessions, n], n.id);
                }}
                onDelete={() => {
                  if (sessions.length < 2) return;
                  const next = sessions.filter((s) => s.id !== sid);
                  persistSessions(next, next[0].id);
                }}
                onRename={(name) => persistSessions(sessions.map((s) => (s.id === sid ? { ...s, name } : s)), sid)}
                onCached={(messages) => persistSessions(sessions.map((s) => (s.id === sid ? { ...s, messages } : s)), sid)}
                effort={settings.effort || 'medium'}
                onEffort={(v) => { setSettings((c) => ({ ...c, effort: v })); saveSettings({ effort: v }); }}
              />
            )}
            {tab === 'live' && (
              <Live
                key={id}
                settings={settings}
                patchSettings={(p) => { setSettings((c) => ({ ...c, ...p })); saveSettings(p); }}
                title={title}
                id={id}
                cues={cues}
              />
            )}
            {tab === 'highlights' && cacheReady && (
              <Highlights
                key={id}
                system={system}
                model={settings.model}
                cues={cues}
                cached={cache?.highlights}
                onCached={(highlights) => { setCache((c) => ({ ...c, highlights })); saveVideo(id, { highlights }); }}
              />
            )}
          </>
        )}
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={async (s) => { setSettings(await saveSettings(s)); setShowSettings(false); }}
        />
      )}
    </div>
  );
}
