/* Project Nexus — audio service: everything synthesized with WebAudio.
   No audio assets exist, so wind, rain, footsteps, jumps and booms are
   generated — noise buffers and oscillators through filters. */
export class AudioService {
  constructor() {
    this.ctx = null; this.muted = false; this._stepAcc = 0; this._prevVy = 0;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      // shared noise buffer
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // wind: looped noise through a wandering bandpass
      this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.05;
      const windFilter = this.ctx.createBiquadFilter();
      windFilter.type = 'bandpass'; windFilter.frequency.value = 480; windFilter.Q.value = 0.6;
      const wind = this.ctx.createBufferSource();
      wind.buffer = this.noiseBuf; wind.loop = true;
      wind.connect(windFilter); windFilter.connect(this.windGain); this.windGain.connect(this.master);
      wind.start();
      this._windFilter = windFilter;
      // rain layer (gain driven by weather state)
      this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
      const rainFilter = this.ctx.createBiquadFilter();
      rainFilter.type = 'highpass'; rainFilter.frequency.value = 1200;
      const rain = this.ctx.createBufferSource();
      rain.buffer = this.noiseBuf; rain.loop = true; rain.playbackRate.value = 0.7;
      rain.connect(rainFilter); rainFilter.connect(this.rainGain); this.rainGain.connect(this.master);
      rain.start();
    } catch (e) { /* no audio: silent */ }
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }

  blip(freqA, freqB, dur, gain, type = 'sine') {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freqA, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freqB), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noiseBurst(dur, gain, filterFreq, type = 'lowpass') {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  jump() { this.blip(280, 520, 0.14, 0.12); }
  spawnPop() { this.blip(500, 900, 0.09, 0.10); }
  boom() { this.noiseBurst(0.7, 0.5, 900); this.blip(120, 34, 0.6, 0.4, 'triangle'); }
  thunder() {
    if (!this.ctx || this.muted) return;
    this.noiseBurst(1.5, 0.5, 150);
    setTimeout(() => this.noiseBurst(1.0, 0.28, 105), 190);
  }

  update(dt, s) {
    if (!this.ctx) return;
    // footsteps: a soft tick every ~2.1m of grounded travel
    if (s.grounded && s.speed > 0.6) {
      this._stepAcc += s.speed * dt;
      if (this._stepAcc > 2.1) { this._stepAcc = 0; this.noiseBurst(0.07, 0.05 + Math.min(0.05, s.speed * 0.006), 500 + Math.random() * 250); }
    } else this._stepAcc = 0;
    if (this._prevVy <= 0.5 && s.vy > 3) this.jump();
    if (this._prevVy < -6 && s.grounded) this.noiseBurst(0.12, 0.16, 300); // landing thud
    this._prevVy = s.vy;
    if (this._windFilter) this._windFilter.frequency.value = 430 + Math.sin(performance.now() / 3400) * 130 + (s.wind || 0) * 260;
    if (this.windGain) this.windGain.gain.value = 0.035 + (s.wind || 0.15) * 0.085;
    const rainTarget = (s.wet || 0) * 0.13;
    if (this.rainGain) this.rainGain.gain.value += (rainTarget - this.rainGain.gain.value) * Math.min(1, dt * 3);
  }
}
