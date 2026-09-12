/* Full-duplex Realtime session over WebRTC. See docs/REALTIME.md. */

function rpc(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      const last = chrome.runtime.lastError?.message;
      resolve(last ? { error: /reload|invalidated/i.test(last) ? 'Extension reloaded — refresh the tab.' : last } : (res || { error: 'No response — reload the extension.' }));
    });
  });
}

export class RealtimeSession {
  constructor(opts) {
    this.opts = opts;
    this.pc = null;
    this.dc = null;
    this.mic = null;
    this.ctx = null;
    this.analyser = null;
    this.raf = 0;
    this.dead = false;
  }

  async start() {
    const { model, apiKey, onEvent, onStatus, onRemoteStream } = this.opts;

    onStatus?.('mic');
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    onStatus?.('connecting');
    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.addTransceiver('audio', { direction: 'sendrecv' });

    this.dc = pc.createDataChannel('oai-events');
    this.dc.onmessage = (e) => {
      try { onEvent?.(JSON.parse(e.data)); } catch {}
    };
    this.dc.onopen = () => {
      if (this.dead) return;
      onStatus?.('live');
      this.updateSession();
    };
    this.dc.onclose = () => { if (!this.dead) onStatus?.('closed'); };

    pc.ontrack = (e) => onRemoteStream?.(e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (this.dead) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') onStatus?.('closed');
    };

    pc.addTrack(this.mic.getAudioTracks()[0], this.mic);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const res = await rpc({ type: 'rtc-connect', sdp: offer.sdp, model, apiKey });
    if (res.error) throw new Error(res.error);
    await pc.setRemoteDescription({ type: 'answer', sdp: res.sdp });

    this.meter();
  }

  /* mic level for the UI meter */
  meter() {
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.mic);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      const buf = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (this.dead) return;
        this.analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
        this.opts.onLevel?.(peak);
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
  }

  sendEvent(obj) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(obj));
  }

  /* (re)configure — also used by the Sync button to refresh the watchhead */
  updateSession() {
    this.sendEvent({
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        voice: this.opts.voice || 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600 },
        instructions: this.opts.instructions?.() || ''
      }
    });
  }

  setMuted(m) {
    this.mic?.getAudioTracks().forEach((t) => { t.enabled = !m; });
  }

  stop() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.mic?.getTracks().forEach((t) => t.stop());
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.ctx?.close().catch(() => {});
  }
}
