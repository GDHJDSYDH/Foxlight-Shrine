/**
 * Web Audio API 程序化氛围与交互音效引擎
 * 零外部音频文件依赖，支持铃铛声、心跳、手电咔哒声、强光爆闪、电池拾取、环境夜风
 */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.masterGain = null;
    this.ambientGain = null;
    this.ambientRunning = false;
    this.lastHeartbeatTime = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") {
        this.ctx.resume();
      }
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.75;
    this.masterGain.connect(this.ctx.destination);
    this.startAmbientWind();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.75, this.ctx.currentTime, 0.05);
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  startAmbientWind() {
    if (!this.ctx || this.ambientRunning) return;
    this.ambientRunning = true;

    // 低频夜风白噪声滤波
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 240;
    filter.Q.value = 2.4;

    // 缓慢风声起伏 LFO
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.14;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.06;

    noise.connect(filter);
    filter.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);
    noise.start();
  }

  // 手电开关咔哒声
  playClick(isOn) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(isOn ? 1150 : 720, now);
    osc.frequency.exponentialRampToValueAtTime(isOn ? 1900 : 320, now + 0.045);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  // 拾取电池清脆充能声
  playPickupBattery() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 880];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      const t = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  }

  // 强光爆闪轰鸣 + 高频闪鸣
  playFlashBurst() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    // 高频闪光音效
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.28);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3200, now);
    filter.frequency.exponentialRampToValueAtTime(400, now + 0.3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.35);

    // 低频冲击
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(140, now);
    sub.frequency.exponentialRampToValueAtTime(42, now + 0.24);
    subGain.gain.setValueAtTime(0.32, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.28);
  }

  // 静音的金色铃铛声（支持音量与左右声道平移，pan in [-1, 1]）
  playShrineBell(volume = 0.24, pan = 0, pitchShift = 1.0) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const partials = [
      { f: 2217 * pitchShift, g: 0.45, d: 0.55 },
      { f: 4434 * pitchShift, g: 0.28, d: 0.38 },
      { f: 6180 * pitchShift, g: 0.16, d: 0.25 }
    ];

    const outNode = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
    if (outNode.pan) {
      outNode.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);
    }
    outNode.connect(this.masterGain);

    // 双清脆振铃
    [0, 0.085].forEach((offset, k) => {
      partials.forEach((p) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sine";
        const t = now + offset;
        osc.frequency.setValueAtTime(p.f * (k === 1 ? 1.03 : 1), t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(p.g * volume, t + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + p.d);
        osc.connect(gain);
        gain.connect(outNode);
        osc.start(t);
        osc.stop(t + p.d + 0.03);
      });
    });
  }

  // 静音被照退/识破时的魅惑狐鸣轻响
  playFoxRetreat() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(780, now);
    osc.frequency.exponentialRampToValueAtTime(1180, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.36);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.42);
  }

  // 突袭预警音
  playAmbushCue(pan = 0) {
    if (!this.ctx || this.muted) return;
    this.playShrineBell(0.36, pan, 1.12);
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.22);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // 根据心率触发心跳（lub-dub）
  updateHeartbeat(nowMs, bpm, dangerFactor) {
    if (!this.ctx || this.muted || dangerFactor < 0.18) return;
    const intervalMs = (60 / Math.max(60, bpm)) * 1000;
    if (nowMs - this.lastHeartbeatTime < intervalMs) return;
    this.lastHeartbeatTime = nowMs;

    const now = this.ctx.currentTime;
    const vol = Math.min(0.45, 0.08 + dangerFactor * 0.34);

    [0, 0.14].forEach((offset, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      const t = now + offset;
      osc.frequency.setValueAtTime(idx === 0 ? 78 : 62, t);
      osc.frequency.exponentialRampToValueAtTime(34, t + 0.11);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(idx === 0 ? vol : vol * 0.72, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  // 被捉住音效
  playCaught() {
    if (!this.ctx || this.muted) return;
    this.playShrineBell(0.42, 0, 0.92);
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.55);
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.62);
  }

  // 破晓 6:00 胜利钟声
  playDawnVictory() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      const t = now + i * 0.14;
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 1.65);
    });
  }
}

window.SoundEngine = SoundEngine;
