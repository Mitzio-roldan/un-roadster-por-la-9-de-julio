import { clamp } from '../core/math';

const MUTE_KEY = 'ndjr.muted';

export interface AudioFrame {
  kmh: number;
  throttle: number;
  boost: number;
  air: boolean;
  nearLight: boolean;
}

/**
 * Audio 100% sintetizado con WebAudio (sin archivos):
 * zumbido eléctrico que sube con la velocidad, viento, "pssst" de los
 * propulsores (corto al saltar, continuo con Shift), aterrizajes, choques,
 * roces, bocinas de colectivos/taxis y el tic del semáforo peatonal.
 */
export class AudioEngine {
  muted: boolean;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  // Motor eléctrico
  private motorGain!: GainNode;
  private motorFilter!: BiquadFilterNode;
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  // Viento y propulsores
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private boostGain!: GainNode;
  private boostFilter!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private driving = false;
  private tickTimer = 0;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* sin storage */
    }
    this.muted = m;
  }

  /** Debe llamarse desde un gesto del usuario (botón Jugar). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp).connect(ctx.destination);

    // Ruido blanco compartido
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Motor: dos osciladores filtrados + silbido agudo de inversor
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.Q.value = 1.5;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'triangle';
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'sine';
    const gB = ctx.createGain();
    gB.gain.value = 0.5;
    this.oscA.connect(this.motorFilter);
    this.oscB.connect(gB).connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain).connect(this.master);
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.oscA.start();
    this.oscB.start();
    this.whine.start();

    // Viento
    const wind = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Propulsores traseros: siseo + retumbo
    const hiss = this.loopNoise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    this.boostFilter = ctx.createBiquadFilter();
    this.boostFilter.type = 'bandpass';
    this.boostFilter.frequency.value = 2400;
    this.boostFilter.Q.value = 0.6;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    hiss.connect(hp).connect(this.boostFilter).connect(this.boostGain).connect(this.master);
    const rumble = this.loopNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(lp).connect(this.rumbleGain).connect(this.master);
  }

  private loopNoise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 1.5);
    return s;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* sin storage */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  setDriving(on: boolean): void {
    this.driving = on;
    if (!this.ctx) return;
    if (!on) {
      const t = this.ctx.currentTime;
      for (const g of [this.motorGain, this.whineGain, this.windGain, this.boostGain, this.rumbleGain]) g.gain.setTargetAtTime(0, t, 0.15);
    }
  }

  update(dt: number, f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx || !this.driving) return;
    const t = ctx.currentTime;
    const k = clamp(f.kmh / 330, 0, 1.2);
    // Motor eléctrico agudo: tono base alto + armónico, y silbido de inversor
    const base = 260 + f.kmh * 5.2;
    this.oscA.frequency.setTargetAtTime(base, t, 0.05);
    this.oscB.frequency.setTargetAtTime(base * 2.01, t, 0.05);
    this.motorFilter.frequency.setTargetAtTime(2200 + f.kmh * 14 + f.throttle * 1500, t, 0.08);
    this.motorGain.gain.setTargetAtTime(0.025 + f.throttle * 0.04 + k * 0.02, t, 0.1);
    this.whine.frequency.setTargetAtTime(1500 + f.kmh * 14, t, 0.05);
    this.whineGain.gain.setTargetAtTime(0.012 + (0.008 + f.throttle * 0.03) * Math.min(1, k * 3), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(350 + f.kmh * 5, t, 0.1);
    this.windGain.gain.setTargetAtTime(k * k * 0.22 + (f.air ? 0.04 : 0), t, 0.15);
    this.boostGain.gain.setTargetAtTime(f.boost * 0.42, t, 0.04);
    this.boostFilter.frequency.setTargetAtTime(1800 + f.boost * 1600 + k * 600, t, 0.1);
    this.rumbleGain.gain.setTargetAtTime(f.boost * 0.5, t, 0.06);

    // Tic del semáforo peatonal (cuando los peatones tienen verde)
    if (f.nearLight) {
      this.tickTimer -= dt;
      if (this.tickTimer <= 0) {
        this.tickTimer = 0.55;
        this.tone(2600, 0.012, 0.06, 'square');
      }
    } else this.tickTimer = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Efectos one-shot                                                     */
  /* ------------------------------------------------------------------ */

  private burst(duration: number, gain: number, type: BiquadFilterType, freq: number, q = 1, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', endFreq?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  /** "Pssst" corto de los propulsores inferiores. */
  jet(spin: boolean): void {
    this.burst(spin ? 0.6 : 0.4, spin ? 0.55 : 0.4, 'highpass', 1400, 0.7);
    this.burst(0.25, 0.3, 'lowpass', 300, 1);
  }

  land(speed: number): void {
    const g = clamp(speed / 20, 0.15, 1);
    this.tone(95, 0.3, 0.5 * g, 'sine', 38);
    this.burst(0.25, 0.35 * g, 'lowpass', 700, 0.8);
  }

  scrape(impact: number): void {
    this.burst(0.35, clamp(impact / 10, 0.15, 0.5), 'bandpass', 3200, 2.5, 1800);
  }

  crash(): void {
    this.burst(1.4, 0.9, 'lowpass', 2500, 0.7, 120);
    this.tone(70, 0.9, 0.8, 'sine', 28);
    for (const f of [1210, 1690, 2350]) this.tone(f, 0.8, 0.06, 'square', f * 0.94);
  }

  whoosh(): void {
    this.burst(0.45, 0.35, 'bandpass', 500, 1.5, 2600);
  }

  horn(type: 'bus' | 'taxi' | string, distance: number): void {
    const v = clamp(1 - distance / 130, 0.05, 1) * 0.16;
    if (type === 'bus') {
      this.tone(196, 0.7, v, 'sawtooth');
      this.tone(247, 0.7, v * 0.8, 'sawtooth');
    } else {
      this.tone(415, 0.16, v, 'square');
      this.tone(523, 0.16, v * 0.7, 'square');
      this.tone(415, 0.2, v, 'square', undefined, 0.22);
      this.tone(523, 0.2, v * 0.7, 'square', undefined, 0.22);
    }
  }

  bonus(): void {
    [1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.22, 0.12, 'triangle', undefined, i * 0.07));
  }

  click(): void {
    this.tone(1800, 0.04, 0.05, 'triangle');
  }
}
