import { AirGauge } from './AirGauge';
import { Speedometer } from './Speedometer';

export interface HudFrame {
  kmh: number;
  boost: boolean;
  tanks: [number, number];
  airFail: boolean;
  time: number;
  distance: number;
  points: number;
  mult: number;
  best: number;
  street: string;
}

const fmt = (n: number) => Math.floor(n).toLocaleString('es-AR');

/**
 * HUD minimalista en DOM (nítido en cualquier pantalla y barato):
 * puntaje + multiplicador, distancia, récord, cartel con la calle que se
 * cruza, velocímetro, tanques de aire y mensajes emergentes de bonus.
 */
export class HUD {
  readonly root: HTMLDivElement;
  private readonly speedo = new Speedometer();
  private readonly air = new AirGauge();
  private readonly els: Record<'points' | 'mult' | 'dist' | 'best' | 'street', HTMLElement>;
  private readonly popups: HTMLDivElement;
  private readonly streetWrap: HTMLDivElement;
  private lastT = 0;
  private cache: Record<string, string> = {};

  constructor(container: HTMLElement) {
    const r = (this.root = document.createElement('div'));
    r.className = 'hud hidden';
    r.innerHTML = `
      <div class="hud-tl">
        <div class="hud-label">PUNTOS</div>
        <div class="hud-points" data-k="points">0</div>
        <div class="hud-mult" data-k="mult">×1.0</div>
      </div>
      <div class="hud-street"><div class="street-sign"><span data-k="street"></span></div></div>
      <div class="hud-tr">
        <div><span class="hud-label">DIST</span> <b data-k="dist">0 m</b></div>
        <div><span class="hud-label">RÉCORD</span> <b data-k="best">0</b></div>
      </div>
      <div class="hud-popups"></div>
      <div class="hud-gauges"></div>`;
    const q = (k: string) => r.querySelector(`[data-k="${k}"]`) as HTMLElement;
    this.els = { points: q('points'), mult: q('mult'), dist: q('dist'), best: q('best'), street: q('street') };
    this.popups = r.querySelector('.hud-popups')!;
    this.streetWrap = r.querySelector('.hud-street')!;
    const g = r.querySelector('.hud-gauges')!;
    g.appendChild(this.air.root);
    g.appendChild(this.speedo.root);
    container.appendChild(r);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  layout(w: number, h: number): void {
    this.root.classList.toggle('compact', Math.min(w, h) < 520);
  }

  private set(k: keyof HUD['els'], text: string): void {
    if (this.cache[k] === text) return;
    this.cache[k] = text;
    this.els[k].textContent = text;
  }

  update(f: HudFrame): void {
    const dt = Math.min(0.1, f.time - this.lastT);
    this.lastT = f.time;
    this.speedo.update(f.kmh, f.boost, dt);
    this.air.update(f.tanks, f.airFail);
    this.set('points', fmt(f.points));
    this.set('mult', `×${f.mult.toFixed(1)}`);
    this.els.mult.classList.toggle('hot', f.mult >= 2);
    this.set('dist', f.distance >= 1000 ? `${(f.distance / 1000).toFixed(2)} km` : `${Math.floor(f.distance)} m`);
    this.set('best', fmt(Math.max(f.best, f.points)));
    if (f.street) this.set('street', f.street);
    this.streetWrap.classList.toggle('show', !!f.street);
  }

  /** Mensaje emergente (bonus, roce, checkpoint). */
  popup(text: string, tone: 'white' | 'cyan' | 'orange' | 'red', big = false): void {
    const d = document.createElement('div');
    d.className = `popup ${tone}${big ? ' big' : ''}`;
    d.textContent = text;
    this.popups.appendChild(d);
    while (this.popups.children.length > 4) this.popups.firstElementChild?.remove();
    setTimeout(() => d.remove(), 1600);
  }
}
