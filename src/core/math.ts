/** Utilidades matemáticas chicas y sin dependencias. */

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => clamp01((v - a) / (b - a));

/** Suavizado exponencial independiente del framerate. `k` = velocidad (1/s). */
export const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt));

/** Mueve `v` hacia `target` como máximo `step`. */
export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Módulo siempre positivo (para índices de calles con distancias negativas). */
export const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** Ángulo normalizado a (−π, π]. */
export const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
