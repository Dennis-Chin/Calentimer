/**
 * audioManager.js
 * Synthesizes a clean bell/chime using Web Audio API.
 * 100% offline, zero audio asset files needed, compatible with Android WebViews and browsers.
 */

class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.volume = 0.8;
  }

  _initContext() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (this.ctx && !this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      } catch (e) {}
    }
  }

  _getDestination() {
    this._initContext();
    return this.masterGain || (this.ctx ? this.ctx.destination : null);
  }

  /**
   * Plays a pleasant dual-tone focus timer completion chime (Harmonic bell).
   */
  playTaskCompleteChime() {
    try {
      this._initContext();
      if (!this.ctx) return;
      const dest = this._getDestination();
      if (!dest) return;

      const now = this.ctx.currentTime;
      const frequencies = [587.33, 880.00]; // D5 and A5 notes (gentle notification)

      frequencies.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);

        // Exponential decay envelope for bell-like timbre
        gain.gain.setValueAtTime(0.001, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.25, now + idx * 0.12 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 1.2);

        osc.connect(gain);
        gain.connect(dest);

        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 1.3);
      });
    } catch (e) {
      console.warn('Audio playback failed:', e);
    }
  }

  /**
   * Subtle tick click sound when turning the rotary wheel.
   */
  playRotaryTick() {
    try {
      this._initContext();
      if (!this.ctx) return;
      const dest = this._getDestination();
      if (!dest) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.03);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

      osc.connect(gain);
      gain.connect(dest);

      osc.start(now);
      osc.stop(now + 0.035);
    } catch (e) {
      // Ignore background audio failures
    }
  }

  /**
   * Tumbling coins sound effect when a piggy bank cracks.
   * Synthesizes rapid metallic gold coin clinks and cascading bounces.
   */
  playTumblingCoinsSound() {
    try {
      this._initContext();
      if (!this.ctx) return;
      const dest = this._getDestination();
      if (!dest) return;

      const now = this.ctx.currentTime;
      // 7 distinct metallic coin bounces with decreasing intervals and pitch variations
      const coinFrequencies = [2400, 3100, 2150, 2850, 3400, 2600, 3800];
      const startTimes = [0, 0.07, 0.15, 0.22, 0.30, 0.38, 0.46];

      coinFrequencies.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        const t = now + startTimes[idx];
        osc.frequency.setValueAtTime(freq, t);
        // Slight metallic pitch drop on impact
        osc.frequency.exponentialRampToValueAtTime(freq * 0.88, t + 0.08);

        gain.gain.setValueAtTime(0.001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

        osc.connect(gain);
        gain.connect(dest);

        osc.start(t);
        osc.stop(t + 0.1);
      });
    } catch (e) {
      console.warn('Tumbling coins sound error:', e);
    }
  }
}

export const audioManager = new AudioManager();
export default audioManager;
