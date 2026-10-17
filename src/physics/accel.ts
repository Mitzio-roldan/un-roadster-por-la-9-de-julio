/**
 * Curva de aceleración del hiperdeportivo.
 *
 *   a(v) = A0 · (1 − (v / vmax)^k)
 *
 * Es enorme desde parado (tracción eléctrica) y se reduce a alta velocidad
 * hasta anularse en `vmax`. A0 NO se escribe a mano: `calibrateCurve` lo busca
 * por bisección simulando con el MISMO integrador y paso que el juego, para
 * que el 0–97 km/h dé exactamente lo declarado en config.ts.
 *
 * Este archivo no importa nada a propósito: lo usa también
 * `scripts/check-accel.ts` desde Node.
 */

export interface AccelCurve {
  a0: number;
  vmax: number;
  k: number;
}

/** Paso fijo de física del juego (s). */
export const PHYSICS_DT = 1 / 120;

export function accelAt(c: AccelCurve, v: number): number {
  if (v >= c.vmax) return 0;
  const r = Math.max(v, 0) / c.vmax;
  return c.a0 * (1 - Math.pow(r, c.k));
}

/** Tiempo para pasar de 0 a `target` m/s integrando como el juego. */
export function timeToSpeed(c: AccelCurve, target: number, dt = PHYSICS_DT, maxT = 120): number {
  let v = 0;
  let t = 0;
  while (v < target && t < maxT) {
    const vNext = v + accelAt(c, v) * dt;
    if (vNext >= target) return t + dt * ((target - v) / (vNext - v));
    v = vNext;
    t += dt;
  }
  return t;
}

/** Busca A0 tal que 0→`kmh97` tarde `seconds`. */
export function calibrateCurve(zeroTo97Seconds: number, topSpeedKmh: number, k: number): AccelCurve {
  const vmax = topSpeedKmh / 3.6;
  const target = 97 / 3.6;
  let lo = 1;
  let hi = 400;
  const c: AccelCurve = { a0: 0, vmax, k };
  for (let i = 0; i < 60; i++) {
    c.a0 = (lo + hi) / 2;
    if (timeToSpeed(c, target) > zeroTo97Seconds) lo = c.a0;
    else hi = c.a0;
  }
  c.a0 = (lo + hi) / 2;
  return c;
}
