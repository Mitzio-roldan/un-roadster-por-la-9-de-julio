import { CONFIG, type QualityLevel, type QualityPreset } from '../config';

const KEY = 'ndjr.quality';
const ORDER: QualityLevel[] = ['high', 'medium', 'low'];

/**
 * Selector de calidad (Alta/Media/Baja/Auto). En "auto" arranca según el
 * dispositivo y baja un escalón si el promedio de FPS queda por debajo del
 * mínimo durante una ventana de muestreo. Nunca sube solo (evita oscilar).
 */
export class Quality {
  choice: QualityLevel | 'auto' = 'auto';
  level: QualityLevel;
  private frames = 0;
  private time = 0;
  private settle = 2;
  private good = 0;
  /** Escala de resolución dinámica (solo en "auto"). */
  scale = 1;

  constructor(private readonly mobile: boolean) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* sin storage */
    }
    if (saved === 'high' || saved === 'medium' || saved === 'low' || saved === 'auto') this.choice = saved;
    this.level = this.choice === 'auto' ? this.autoStart() : this.choice;
  }

  private autoStart(): QualityLevel {
    if (this.mobile) return 'medium';
    const cores = navigator.hardwareConcurrency ?? 4;
    return cores >= 6 ? 'high' : 'medium';
  }

  get preset(): QualityPreset {
    return CONFIG.quality[this.level];
  }

  set(choice: QualityLevel | 'auto', save: boolean): void {
    if (save) {
      this.choice = choice;
      try {
        localStorage.setItem(KEY, choice);
      } catch {
        /* sin storage */
      }
      this.level = choice === 'auto' ? this.autoStart() : choice;
      this.scale = 1;
    } else if (choice !== 'auto') {
      this.level = choice;
    }
    this.frames = 0;
    this.time = 0;
    this.settle = 2;
  }

  /**
   * Llamar cada frame. En "auto" ajusta primero la escala de resolución
   * (resolución dinámica: el juego está limitado por fill-rate) y, si ya
   * está al mínimo, baja un preset. Sube la escala con histéresis.
   */
  sample(dt: number, active: boolean, onScale: () => void, downgrade: (q: QualityLevel) => void): void {
    if (this.choice !== 'auto' || !active) return;
    if (this.settle > 0) {
      this.settle -= dt;
      return;
    }
    this.frames++;
    this.time += dt;
    if (this.time < CONFIG.quality.autoSampleSeconds) return;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    const min = this.mobile ? CONFIG.quality.autoMinFpsMobile : CONFIG.quality.autoMinFpsDesktop;
    const Q = CONFIG.quality;
    if (fps < min) {
      this.good = 0;
      if (this.scale > Q.minRenderScale + 0.01) {
        this.scale = Math.max(Q.minRenderScale, this.scale * (fps < min * 0.7 ? 0.8 : 0.9));
        if (import.meta.env.DEV) console.info(`[calidad] ${fps.toFixed(0)} FPS → escala ${this.scale.toFixed(2)}`);
        this.settle = 0.6;
        onScale();
        return;
      }
      const i = ORDER.indexOf(this.level);
      if (i < ORDER.length - 1) {
        if (import.meta.env.DEV) console.info(`[calidad] ${fps.toFixed(0)} FPS → ${ORDER[i + 1]}`);
        this.scale = 0.85;
        downgrade(ORDER[i + 1]);
      }
    } else if (fps > min + 6 && this.scale < 1) {
      // Varias ventanas seguidas holgadas → subir un poco la resolución
      if (++this.good >= 3) {
        this.good = 0;
        this.scale = Math.min(1, this.scale * 1.08);
        this.settle = 0.6;
        onScale();
      }
    }
  }
}
