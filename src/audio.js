// Web Audio API Synthesizer - 100% standalone, no external files needed!
class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
        this.initialized = true;
      }
    } catch (e) {
      console.warn('AudioContext init error:', e);
    }
  }

  ensureContext() {
    if (!this.initialized) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  playTone(freq, type = 'sine', duration = 0.1, gainVal = 0.15) {
    if (this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Audio autoplay policy catch
    }
  }

  playPlant() {
    this.playTone(320, 'triangle', 0.08, 0.12);
  }

  playWater() {
    if (this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + 0.12);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch (e) {}
  }

  playHarvest() {
    if (this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [440, 554, 659].forEach((freq, i) => {
      setTimeout(() => {
        this.playTone(freq, 'sine', 0.15, 0.14);
      }, i * 50);
    });
  }

  playSell() {
    if (this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      setTimeout(() => {
        this.playTone(freq, 'triangle', 0.12, 0.12);
      }, i * 40);
    });
  }

  playUnlock() {
    if (this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;
    [261.63, 329.63, 392.00, 523.25].forEach((freq, i) => {
      setTimeout(() => {
        this.playTone(freq, 'square', 0.18, 0.08);
      }, i * 70);
    });
  }

  playClick() {
    this.playTone(600, 'sine', 0.04, 0.08);
  }
}

export const sound = new SoundManager();
