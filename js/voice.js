// Voice commands, offline: OpenAI's Whisper speech-recognition model running IN THE BROWSER
// (transformers.js). The model (~77 MB) downloads once from Hugging Face on first use, is cached
// by the browser, and from then on works without internet. Nothing you say leaves your Mac.
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js';
const MODEL = 'Xenova/whisper-base.en';
const MAX_SECONDS = 8;

export class Voice {
  constructor({ onState }) {
    this.onState = onState || (() => {});
    this.asr = null;
    this.loading = null;
    this.listening = false;
    this.level = 0;
  }

  get ready() { return !!this.asr; }

  /** Load Whisper (first time downloads it; later it comes from the browser cache). */
  async ensureModel() {
    if (this.asr) return this.asr;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const { pipeline, env } = await import(TRANSFORMERS);
      env.allowLocalModels = false;
      const files = {};
      const progress = (p) => {
        if (p.status === 'progress' && p.total) {
          files[p.file] = [p.loaded, p.total];
          const loaded = Object.values(files).reduce((s, f) => s + f[0], 0), total = Object.values(files).reduce((s, f) => s + f[1], 0);
          this.onState({ state: 'downloading', progress: loaded / total, mb: total / 1e6 });
        }
      };
      this.onState({ state: 'loading' });
      this.asr = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8', device: 'wasm', progress_callback: progress });
      this.onState({ state: 'ready' });
      return this.asr;
    })();
    try { return await this.loading; } catch (e) { this.loading = null; throw e; }
  }

  /** Start recording from the microphone. */
  async start() {
    if (this.listening) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    proc.onaudioprocess = (e) => { if (this.listening) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(this.analyser);
    src.connect(proc);
    proc.connect(this.ctx.destination);
    this.proc = proc;
    this.listening = true;
    this.startedAt = performance.now();
    this.onState({ state: 'listening' });
    const meter = new Uint8Array(this.analyser.fftSize);
    const tick = () => {
      if (!this.listening) return;
      this.analyser.getByteTimeDomainData(meter);
      let peak = 0;
      for (const v of meter) peak = Math.max(peak, Math.abs(v - 128) / 128);
      this.level = this.level * 0.6 + peak * 0.4;
      this.onState({ state: 'listening', level: this.level, seconds: (performance.now() - this.startedAt) / 1000 });
      if (performance.now() - this.startedAt > MAX_SECONDS * 1000) { this.stop(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Stop recording and return the recognised text. */
  async stop() {
    if (!this.listening) return this._pending || '';
    this.listening = false;
    const rate = this.ctx.sampleRate;
    const chunks = this.chunks;
    this.proc.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    this.ctx.close();
    this._pending = (async () => {
      const total = chunks.reduce((s, c) => s + c.length, 0);
      if (total < rate * 0.3) { this.onState({ state: 'idle' }); return ''; }     // too short
      const audio = new Float32Array(total);
      let o = 0;
      for (const c of chunks) { audio.set(c, o); o += c.length; }
      return this.transcribe(await resampleTo16k(audio, rate));
    })();
    const text = await this._pending;
    this._pending = null;
    return text;
  }

  /** Speech -> text for 16 kHz mono audio. */
  async transcribe(audio16k) {
    this.onState({ state: 'transcribing' });
    const asr = await this.ensureModel();
    const out = await asr(audio16k);
    const text = (out.text || '').trim().replace(/^\[.*?\]$/, '');   // drop "[BLANK_AUDIO]" style markers
    this.onState({ state: 'idle' });
    return text;
  }
}

async function resampleTo16k(audio, rate) {
  if (rate === 16000) return audio;
  const len = Math.ceil(audio.length * 16000 / rate);
  const off = new OfflineAudioContext(1, len, 16000);
  const buf = off.createBuffer(1, audio.length, rate);
  buf.copyToChannel(audio, 0);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}
