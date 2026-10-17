import { CONFIG } from '../config';

const A = CONFIG.air;

/**
 * Dos tanques de aire comprimido. Internamente es un único nivel 0..2 que el
 * HUD muestra como dos barras. Se recarga solo (más rápido rodando) después
 * de una breve pausa desde el último uso.
 */
export class AirTanks {
  readonly capacity = A.tanks * A.perTank;
  level = this.capacity;
  private cooldown = 0;
  /** Momento (s, reloj real) del último intento fallido → parpadeo rojo del HUD. */
  failAt = -10;

  reset(): void {
    this.level = this.capacity;
    this.cooldown = 0;
    this.failAt = -10;
  }

  tank(i: number): number {
    return Math.min(1, Math.max(0, this.level - i * A.perTank) / A.perTank);
  }

  /** Consume `amount` si alcanza. Si no, marca el fallo y devuelve false. */
  consume(amount: number, now: number): boolean {
    if (this.level + 1e-6 < amount) {
      this.failAt = now;
      return false;
    }
    this.level -= amount;
    this.cooldown = A.rechargeDelay;
    return true;
  }

  /** Consumo continuo de los propulsores traseros. Devuelve false si se vació. */
  drain(dt: number, now: number): boolean {
    if (this.level <= 0) {
      this.failAt = now;
      return false;
    }
    this.level = Math.max(0, this.level - A.boostDrainPerSec * dt);
    this.cooldown = A.rechargeDelay;
    return true;
  }

  canBoost(): boolean {
    return this.level >= A.minToBoost;
  }

  update(dt: number, rolling: boolean): void {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }
    const rate = rolling ? A.rechargeRollingPerSec : A.rechargeIdlePerSec;
    this.level = Math.min(this.capacity, this.level + rate * dt);
  }
}
