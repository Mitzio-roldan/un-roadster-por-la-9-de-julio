import type { ControlState, TouchSource } from './Input';
import { isTouchDevice, vibrate } from '../ui/device';

/**
 * Controles táctiles con Pointer Events (multitouch real: cada dedo es un
 * pointerId independiente con `setPointerCapture`).
 * - Izquierda: joystick flotante (aparece donde apoyás el dedo) para dirección.
 * - Derecha: ACELERAR, FRENO, SALTO (doble tap = salto con giro) y
 *   PROPULSORES (mantener apretado).
 * Se pueden usar a la vez: acelerar + girar + propulsores.
 */
export class TouchControls implements TouchSource {
  readonly state: ControlState = { throttle: 0, brake: 0, steer: 0, boost: false };
  enabled = isTouchDevice();
  private visible = false;
  private readonly root: HTMLDivElement;
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private stickId: number | null = null;
  private stickX = 0;
  private readonly jumps: number[] = [];
  private readonly radius = 58;

  get active(): boolean {
    return this.enabled && this.visible;
  }

  constructor(container: HTMLElement) {
    const r = (this.root = document.createElement('div'));
    r.className = 'touch hidden';
    r.innerHTML = `
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div><div class="stick-hint">DIRECCIÓN</div></div>
      <div class="btns">
        <button class="tbtn jump" data-b="jump"><span>SALTO</span><small>2× = GIRO</small></button>
        <button class="tbtn boost" data-b="boost"><span>PROPULSORES</span></button>
        <button class="tbtn brake" data-b="brake"><span>FRENO</span></button>
        <button class="tbtn gas" data-b="gas"><span>ACELERAR</span></button>
      </div>`;
    container.appendChild(r);
    this.stickBase = r.querySelector('.stick-base')!;
    this.stickKnob = r.querySelector('.stick-knob')!;

    const zone = r.querySelector<HTMLDivElement>('.stick-zone')!;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.stickX = e.clientX;
      const rect = zone.getBoundingClientRect();
      this.stickBase.style.left = `${e.clientX - rect.left}px`;
      this.stickBase.style.top = `${e.clientY - rect.top}px`;
      this.stickBase.classList.add('on');
      this.moveStick(e.clientX);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.state.steer = 0;
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
      this.stickBase.classList.remove('on');
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    for (const b of r.querySelectorAll<HTMLButtonElement>('.tbtn')) {
      const kind = b.dataset.b!;
      const ids = new Set<number>();
      const set = (on: boolean) => {
        b.classList.toggle('pressed', on);
        if (kind === 'gas') this.state.throttle = on ? 1 : 0;
        else if (kind === 'brake') this.state.brake = on ? 1 : 0;
        else if (kind === 'boost') this.state.boost = on;
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        ids.add(e.pointerId);
        set(true);
        if (kind === 'jump') this.jumps.push(performance.now());
        vibrate(kind === 'boost' ? 12 : 8);
      });
      const up = (e: PointerEvent) => {
        ids.delete(e.pointerId);
        if (ids.size === 0) set(false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Si aparece un toque en un equipo no detectado como táctil, habilitar.
    window.addEventListener(
      'touchstart',
      () => {
        if (!this.enabled) {
          this.enabled = true;
          document.body.classList.add('touch-ui');
          this.setVisible(this.visible);
        }
      },
      { passive: true },
    );
  }

  private moveStick(clientX: number): void {
    const dx = Math.max(-this.radius, Math.min(this.radius, clientX - this.stickX));
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
    let s = dx / this.radius;
    // Zona muerta + curva suave para precisión en el centro
    s = Math.abs(s) < 0.08 ? 0 : Math.sign(s) * Math.pow((Math.abs(s) - 0.08) / 0.92, 1.35);
    this.state.steer = s;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.classList.toggle('hidden', !(v && this.enabled));
    if (!v) {
      this.state.throttle = this.state.brake = this.state.steer = 0;
      this.state.boost = false;
      for (const b of this.root.querySelectorAll('.pressed')) b.classList.remove('pressed');
    }
  }

  drainJumps(): number[] {
    return this.jumps.splice(0, this.jumps.length);
  }
}
