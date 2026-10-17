import { CONFIG } from '../config';

const S = CONFIG.score;
const BEST_KEY = 'ndjr.best';

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Puntaje: metros recorridos (más puntos a más velocidad) × multiplicador,
 * más bonus por casi-choques, saltar por encima, giros perfectos y el
 * Obelisco. Los roces bajan el multiplicador. Récord en localStorage.
 */
export class Score {
  points = 0;
  /** Metros avanzados desde la largada (solo cuenta el progreso hacia adelante). */
  distance = 0;
  mult = 1;
  best = readBest();
  newRecord = false;
  private origin = 0;
  private sinceBonus = 0;

  reset(): void {
    this.points = 0;
    this.distance = 0;
    this.mult = 1;
    this.newRecord = false;
    this.sinceBonus = 0;
  }

  restore(points: number, distance: number): void {
    this.points = points;
    this.distance = distance;
    this.mult = 1;
    this.newRecord = false;
  }

  /** Progreso (−z) en la largada. Con checkpoint, se descuenta lo ya recorrido. */
  setOrigin(progress: number): void {
    this.origin = progress - this.distance;
  }

  advance(progress: number, kmh: number, dt: number): void {
    const d = progress - this.origin;
    if (d > this.distance) {
      const delta = d - this.distance;
      this.distance = d;
      this.points += delta * (S.perMeterBase + kmh / S.perMeterSpeedDivKmh) * this.mult;
    }
    this.sinceBonus += dt;
    if (this.sinceBonus > S.multDecayDelay) this.mult = Math.max(1, this.mult - S.multDecayPerSec * dt);
  }

  private bonus(points: number, multGain: number): number {
    const p = Math.round(points * this.mult);
    this.points += p;
    this.mult = Math.min(S.multMax, this.mult + multGain);
    this.sinceBonus = 0;
    return p;
  }

  nearMiss(over: boolean): number {
    return over ? this.bonus(S.jumpOverPoints, S.multJumpOver) : this.bonus(S.nearMissPoints, S.multNearMiss);
  }
  perfectSpin(): number {
    return this.bonus(S.perfectSpinPoints, S.multSpin);
  }
  roofBounce(): number {
    return this.bonus(S.roofBouncePoints, S.multJumpOver);
  }
  checkpoint(): number {
    return this.bonus(S.checkpointPoints, 0);
  }
  scrape(): void {
    this.mult = Math.max(1, this.mult * 0.5);
    this.sinceBonus = 0;
  }

  /** Guarda el récord si corresponde y lo devuelve. */
  commitBest(): number {
    const p = Math.floor(this.points);
    if (p > this.best) {
      this.best = p;
      this.newRecord = true;
      try {
        localStorage.setItem(BEST_KEY, String(p));
      } catch {
        /* modo privado: sin persistencia */
      }
    }
    return this.best;
  }
}
