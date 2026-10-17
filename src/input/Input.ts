import { CONFIG } from '../config';
import { DoubleTapDetector } from './DoubleTap';
import { Keyboard } from './Keyboard';

export interface ControlState {
  throttle: number;
  brake: number;
  steer: number;
  boost: boolean;
}

export type InputAction = 'jump' | 'jumpDouble' | 'camera' | 'pause' | 'mute' | 'night' | 'confirm';

/** Fuente de controles táctiles (ver input/Touch.ts). */
export interface TouchSource {
  readonly state: ControlState;
  /** Pulsaciones del botón SALTO desde el último poll (timestamps ms). */
  drainJumps(): number[];
  readonly active: boolean;
}

/**
 * Combina teclado y controles táctiles en un único estado + cola de acciones.
 * El doble Espacio / doble tap se resuelve acá con `DoubleTapDetector`.
 */
export class Input {
  readonly keyboard = new Keyboard();
  touch: TouchSource | null = null;
  readonly state: ControlState = { throttle: 0, brake: 0, steer: 0, boost: false };
  private readonly actions: InputAction[] = [];
  private readonly jumpTaps = new DoubleTapDetector(CONFIG.jump.doubleTapMs);

  poll(): ControlState {
    const k = this.keyboard;
    let throttle = k.isDown('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = k.isDown('KeyS', 'ArrowDown') ? 1 : 0;
    let steer = (k.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (k.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    let boost = k.isDown('ShiftLeft', 'ShiftRight', 'KeyF');
    for (const code of k.drainPressed()) {
      switch (code) {
        case 'Space':
          this.actions.push(this.jumpTaps.press(performance.now()) ? 'jumpDouble' : 'jump');
          break;
        case 'KeyC':
          this.actions.push('camera');
          break;
        case 'Escape':
        case 'KeyP':
          this.actions.push('pause');
          break;
        case 'KeyM':
          this.actions.push('mute');
          break;
        case 'KeyN':
          this.actions.push('night');
          break;
        case 'Enter':
          this.actions.push('confirm');
          break;
      }
    }
    if (this.touch?.active) {
      const t = this.touch.state;
      throttle = Math.max(throttle, t.throttle);
      brake = Math.max(brake, t.brake);
      if (Math.abs(t.steer) > Math.abs(steer)) steer = t.steer;
      boost ||= t.boost;
      for (const ts of this.touch.drainJumps()) this.actions.push(this.jumpTaps.press(ts) ? 'jumpDouble' : 'jump');
    }
    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.steer = steer;
    this.state.boost = boost;
    return this.state;
  }

  drainActions(): InputAction[] {
    return this.actions.splice(0, this.actions.length);
  }
}
