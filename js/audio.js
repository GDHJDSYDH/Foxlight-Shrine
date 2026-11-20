/**
 * Web Audio API 程序化氛围与交互音效引擎（移动端防崩溃与防内存泄漏加固版）
 * - 所有音频节点结束后自动 disconnect()，避免移动端浏览器长时间游玩后 AudioNode 堆积闪退
 * - 所有 AudioParam 调用加安全范围保护与 try/catch，防止 Safari/微信浏览器非法状态报错
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
    try {
      if (this.ctx) {
        if (this.ctx.state === "suspended") {
          this.ctx.resume().catch(() => {});
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
    } catch (_e) {
      this.ctx = null;
    }
  }

  _canPlay() {
    return !!(this.ctx && this.masterGain && !this.muted && this.ctx.state === "running");
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.75, this.ctx.currentTime, 0.05);
      } catch (_e) {
        this.masterGain.gain.value = muted ? 0 : 0.75;
      }
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  startAmbientWind() {
    if (!this.ctx || this.ambientRunning) return;
    this.ambientRunning = true;

    try {
      // 使用较轻量的 1.5s 噪声缓冲降低内存占用
      const bufferSize = Math.floor(this.ctx.sampleRate * 1.5);
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
    } catch (_e) {
      this.ambientRunning = false;
    }
  }

  _autoCleanup(osc, nodes) {
    osc.onended = () => {
      for (let i = 0; i < nodes.length; i++) {
        try {
          nodes[i].disconnect();
        } catch (_e) {}
      }
    };
  }

  // 手电开关咔哒声
  playClick(isOn) {
    if (!this._canPlay()) return;
    try {
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
      this._autoCleanup(osc, [osc, gain]);
      osc.start(now);
      osc.stop(now + 0.06);
    } catch (_e) {}
  }

  // 拾取电池清脆充能声
  playPickupBattery() {
    if (!this._canPlay()) return;
    try {
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
        this._autoCleanup(osc, [osc, gain]);
        osc.start(t);
        osc.stop(t + 0.24);
      });
    } catch (_e) {}
  }

  // 强光爆闪轰鸣 + 高频闪鸣
  playFlashBurst() {
    if (!this._canPlay()) return;
    try {
      const now = this.ctx.currentTime;

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
      this._autoCleanup(osc, [osc, filter, gain]);
      osc.start(now);
      osc.stop(now + 0.35);

      const sub = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(140, now);
      sub.frequency.exponentialRampToValueAtTime(42, now + 0.24);
      subGain.gain.setValueAtTime(0.32, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      sub.connect(subGain);
      subGain.connect(this.masterGain);
      this._autoCleanup(sub, [sub, subGain]);
      sub.start(now);
      sub.stop(now + 0.28);
    } catch (_e) {}
  }

  // 雫音的金色铃铛声（安全释放 StereoPannerNode，杜绝音频节点堆积）
  playShrineBell(volume = 0.24, pan = 0, pitchShift = 1.0) {
    if (!this._canPlay()) return;
    try {
      const now = this.ctx.currentTime;
      const safeVol = Math.max(0.02, Math.min(0.6, volume));
      const partials = [
        { f: 2217 * pitchShift, g: 0.45, d: 0.48 },
        { f: 4434 * pitchShift, g: 0.25, d: 0.32 }
      ];

      const outNode = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
      if (outNode.pan) {
        outNode.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);
      }
      outNode.connect(this.masterGain);

      let remaining = 4;
      const onOneDone = (osc, gain) => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (_e) {}
        remaining--;
        if (remaining <= 0) {
          try {
            outNode.disconnect();
          } catch (_e) {}
        }
      };

      [0, 0.085].forEach((offset, k) => {
        partials.forEach((p) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = "sine";
          const t = now + offset;
          osc.frequency.setValueAtTime(p.f * (k === 1 ? 1.03 : 1), t);
          gain.gain.setValueAtTime(0.0002, t);
          gain.gain.linearRampToValueAtTime(Math.max(0.001, p.g * safeVol), t + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.0002, t + p.d);
          osc.connect(gain);
          gain.connect(outNode);
          osc.onended = () => onOneDone(osc, gain);
          osc.start(t);
          osc.stop(t + p.d + 0.03);
        });
      });
    } catch (_e) {}
  }

  // 雫音被照退/识破时的魅惑狐鸣轻响
  playFoxRetreat() {
    if (!this._canPlay()) return;
    try {
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
      this._autoCleanup(osc, [osc, gain]);
      osc.start(now);
      osc.stop(now + 0.42);
    } catch (_e) {}
  }

  // 突袭预警音
  playAmbushCue(pan = 0) {
    if (!this._canPlay()) return;
    this.playShrineBell(0.36, pan, 1.12);
    try {
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
      this._autoCleanup(osc, [osc, gain]);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (_e) {}
  }

  // 根据心率触发心跳（lub-dub）
  updateHeartbeat(nowMs, bpm, dangerFactor) {
    if (!this._canPlay() || dangerFactor < 0.18) return;
    const intervalMs = (60 / Math.max(60, bpm)) * 1000;
    if (nowMs - this.lastHeartbeatTime < intervalMs) return;
    this.lastHeartbeatTime = nowMs;

    try {
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
        this._autoCleanup(osc, [osc, gain]);
        osc.start(t);
        osc.stop(t + 0.15);
      });
    } catch (_e) {}
  }

  // 被捉住音效
  playCaught() {
    if (!this._canPlay()) return;
    this.playShrineBell(0.42, 0, 0.92);
    try {
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
      this._autoCleanup(osc, [osc, filter, gain]);
      osc.start(now);
      osc.stop(now + 0.62);
    } catch (_e) {}
  }

  // 破晓 6:00 胜利钟声
  playDawnVictory() {
    if (!this._canPlay()) return;
    try {
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
        this._autoCleanup(osc, [osc, gain]);
        osc.start(t);
        osc.stop(t + 1.65);
      });
    } catch (_e) {}
  }
}

window.SoundEngine = SoundEngine;
