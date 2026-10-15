/**
 * audioManager.js
 * Synthesizes a clean bell/chime using Web Audio API.
 * 100% offline, zero audio asset files needed, compatible with Android WebViews and browsers.
 */

class AudioManager {
  constructor() {
    this.ctx = null;
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
  }

  /**
   * Plays a pleasant dual-tone focus timer completion chime (Harmonic bell).
   */
  playTaskCompleteChime() {
    try {
      this._initContext();
      if (!this.ctx) return;

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
        gain.connect(this.ctx.destination);

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

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.03);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.035);
    } catch (e) {
      // Ignore background audio failures
    }
  }
}

export const audioManager = new AudioManager();
export default audioManager;
