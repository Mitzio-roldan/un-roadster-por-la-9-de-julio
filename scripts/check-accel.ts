/**
 * Verifica que la curva de aceleración calibrada cumpla las especificaciones
 * de config.ts. Uso: `npm run check:accel` (Node ≥ 22.18, type stripping).
 */
import { CONFIG } from '../src/config.ts';
import { accelAt, calibrateCurve, timeToSpeed, PHYSICS_DT } from '../src/physics/accel.ts';

let ok = true;
for (const mode of ['normal', 'boost'] as const) {
  const spec = CONFIG.car[mode];
  const curve = calibrateCurve(spec.zeroTo97Seconds, spec.topSpeedKmh, spec.curveExponent);
  const t97 = timeToSpeed(curve, 97 / 3.6);
  const t200 = timeToSpeed(curve, 200 / 3.6);
  const t300 = timeToSpeed(curve, 300 / 3.6);
  // Velocidad alcanzada tras 30 s con acelerador a fondo
  let v = 0;
  for (let t = 0; t < 30; t += PHYSICS_DT) v += accelAt(curve, v) * PHYSICS_DT;
  const err = Math.abs(t97 - spec.zeroTo97Seconds);
  const pass = err < 0.005 && v * 3.6 > spec.topSpeedKmh * 0.97 && v * 3.6 <= spec.topSpeedKmh + 0.01;
  ok &&= pass;
  console.log(
    `${pass ? '✔' : '✘'} ${mode.padEnd(6)} A0=${curve.a0.toFixed(2)} m/s² (${(curve.a0 / 9.81).toFixed(2)} g)  ` +
      `0–97: ${t97.toFixed(3)} s (spec ${spec.zeroTo97Seconds})  0–200: ${t200.toFixed(2)} s  0–300: ${t300.toFixed(2)} s  ` +
      `v(30 s): ${(v * 3.6).toFixed(1)} km/h (tope ${spec.topSpeedKmh})`,
  );
}
process.exit(ok ? 0 : 1);
