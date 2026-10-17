import { BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Shape, SphereGeometry, PlaneGeometry, TorusGeometry } from 'three';
import { merge, paint } from '../core/geometry';

/**
 * Modelos low-poly del tránsito porteño. Cada tipo se divide en partes que
 * se dibujan con InstancedMesh:
 *  - paint:  carrocería (color por instancia)
 *  - paint2: segundo color (techo amarillo del taxi, franjas del colectivo)
 *  - detail: vidrios, ruedas, paragolpes (colores por vértice)
 *  - lights: faros, luces traseras/freno y guiños (atributo `aLightType`)
 *  - sign:   cartel LED del colectivo (atlas)
 * Ejes: trompa hacia −Z, piso en y = 0.
 */

export type VehicleType = 'car' | 'taxi' | 'bus' | 'moto' | 'van';

export interface VehicleModel {
  paint: BufferGeometry;
  paint2: BufferGeometry | null;
  detail: BufferGeometry;
  lights: BufferGeometry;
  sign: BufferGeometry | null;
  /** Semiejes para colisión/IA y altura total. */
  hx: number;
  hz: number;
  h: number;
}

/** Perfil lateral (x = largo con la trompa en +x, y = alto) extruido a lo ancho. */
function profile(points: [number, number][], width: number, bevel = 0.06): BufferGeometry {
  const s = new Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 1 });
  // Forma XY → auto: x de la forma → −z (trompa adelante), extrusión → x
  g.rotateY(Math.PI / 2);
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  return g;
}

function wheels(xs: number, zs: number[], r: number, w: number): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (const z of zs) {
    for (const s of [1, -1]) {
      out.push(paint(new CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2).translate(s * xs, r, z), '#151515'));
      out.push(paint(new CylinderGeometry(r * 0.6, r * 0.6, w + 0.02, 10).rotateZ(Math.PI / 2).translate(s * xs, r, z), '#9a9ea3'));
    }
  }
  return out;
}

/** Caja de luz con su tipo: 0 faro, 1 trasera/freno, 2 guiño izq, 3 guiño der, 4 cartel taxi. */
function light(type: number, w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  return paint(new BoxGeometry(w, h, d).translate(x, y, z), '#ffffff', { aLightType: type });
}

function carLike(opts: { len: number; width: number; belt: number; roof: number; cabin: [number, number, number, number]; taxi: boolean; van: boolean }): VehicleModel {
  const L = opts.len / 2;
  const W = opts.width;
  const [c0, c1, c2, c3] = opts.cabin; // x de base trasera, techo trasero, techo delantero, base delantera (trompa en +x)
  const body = profile(
    [
      [-L, 0.32],
      [-L - 0.05, opts.belt - 0.15],
      [-L + 0.15, opts.belt],
      [L - 0.55, opts.belt - (opts.van ? 0 : 0.08)],
      [L, opts.belt - 0.3],
      [L + 0.03, 0.32],
    ],
    W,
  );
  const cabin = profile(
    [
      [c0, opts.belt - 0.02],
      [c1, opts.roof - 0.06],
      [c2, opts.roof - 0.06],
      [c3, opts.belt - 0.02],
    ],
    W - 0.14,
    0.02,
  );
  const roof = profile(
    [
      [c1 - 0.02, opts.roof - 0.07],
      [c1, opts.roof],
      [c2, opts.roof],
      [c2 + 0.02, opts.roof - 0.07],
    ],
    W - 0.18,
    0.02,
  );
  const detail = merge([
    paint(cabin, '#121820'),
    ...wheels(W / 2 - 0.12, [-(L - 0.8), L - 0.85], 0.33, 0.24),
    paint(new BoxGeometry(W + 0.04, 0.2, 0.18).translate(0, 0.42, -L - 0.02), '#1d1f22'),
    paint(new BoxGeometry(W + 0.04, 0.2, 0.18).translate(0, 0.42, L + 0.02), '#1d1f22'),
    paint(new BoxGeometry(W - 0.2, 0.06, opts.len - 0.4).translate(0, 0.3, 0), '#0e0f10'),
    ...(opts.taxi ? [paint(new BoxGeometry(0.7, 0.2, 0.32).translate(0, opts.roof + 0.1, 0.1), '#f4d03f')] : []),
  ]);
  const lights = merge(
    [
      light(0, 0.34, 0.12, 0.05, W / 2 - 0.28, opts.belt - 0.22, -L - 0.03),
      light(0, 0.34, 0.12, 0.05, -(W / 2 - 0.28), opts.belt - 0.22, -L - 0.03),
      light(1, 0.32, 0.14, 0.05, W / 2 - 0.26, opts.belt - 0.12, L + 0.06),
      light(1, 0.32, 0.14, 0.05, -(W / 2 - 0.26), opts.belt - 0.12, L + 0.06),
      light(2, 0.1, 0.08, 0.05, -(W / 2 - 0.06), opts.belt - 0.22, -L - 0.03),
      light(3, 0.1, 0.08, 0.05, W / 2 - 0.06, opts.belt - 0.22, -L - 0.03),
      light(2, 0.1, 0.08, 0.05, -(W / 2 - 0.06), opts.belt - 0.28, L + 0.06),
      light(3, 0.1, 0.08, 0.05, W / 2 - 0.06, opts.belt - 0.28, L + 0.06),
      ...(opts.taxi ? [light(4, 0.62, 0.12, 0.34, 0, opts.roof + 0.16, 0.1)] : []),
    ],
    ['aLightType'],
  );
  return { paint: merge([body]), paint2: merge([roof]), detail, lights, sign: null, hx: W / 2, hz: L + 0.05, h: opts.roof };
}

function bus(): VehicleModel {
  const L = 6.0;
  const W = 2.55;
  const H = 3.15;
  const body = profile(
    [
      [-L, 0.35],
      [-L, H - 0.12],
      [-L + 0.2, H],
      [L - 0.35, H],
      [L, H - 0.35],
      [L + 0.05, 0.35],
    ],
    W,
    0.08,
  );
  // Segundo color: zócalo y franja bajo las ventanas
  const paint2 = merge([
    paint(new BoxGeometry(W + 0.03, 0.55, L * 2 + 0.06).translate(0, 0.62, 0), '#ffffff'),
    paint(new BoxGeometry(W + 0.03, 0.14, L * 2 + 0.06).translate(0, 1.38, 0), '#ffffff'),
  ]);
  const detail = merge([
    // ventanas laterales y parabrisas
    paint(new BoxGeometry(W + 0.05, 1.05, L * 2 - 1.4).translate(0, 2.05, 0.4), '#10161d'),
    paint(new BoxGeometry(W - 0.25, 1.5, 0.06).translate(0, 1.95, -L - 0.06), '#0d1218'),
    paint(new BoxGeometry(W - 0.3, 0.9, 0.06).translate(0, 2.2, L + 0.06), '#10161d'),
    paint(new BoxGeometry(W + 0.06, 0.28, 0.22).translate(0, 0.45, -L - 0.04), '#1b1c1f'),
    paint(new BoxGeometry(W + 0.06, 0.28, 0.22).translate(0, 0.45, L + 0.04), '#1b1c1f'),
    // puertas
    paint(new BoxGeometry(W + 0.06, 2.0, 1.1).translate(0, 1.4, -L + 1.4), '#1a2129'),
    paint(new BoxGeometry(W + 0.06, 2.0, 1.1).translate(0, 1.4, 0.6), '#1a2129'),
    ...wheels(W / 2 - 0.2, [-(L - 1.6), L - 2.0], 0.5, 0.35),
  ]);
  const lights = merge(
    [
      light(0, 0.3, 0.16, 0.05, W / 2 - 0.3, 0.75, -L - 0.08),
      light(0, 0.3, 0.16, 0.05, -(W / 2 - 0.3), 0.75, -L - 0.08),
      light(1, 0.22, 0.4, 0.05, W / 2 - 0.2, 1.0, L + 0.08),
      light(1, 0.22, 0.4, 0.05, -(W / 2 - 0.2), 1.0, L + 0.08),
      light(2, 0.14, 0.12, 0.05, -(W / 2 - 0.12), 0.95, -L - 0.08),
      light(3, 0.14, 0.12, 0.05, W / 2 - 0.12, 0.95, -L - 0.08),
      light(2, 0.14, 0.14, 0.05, -(W / 2 - 0.2), 1.45, L + 0.08),
      light(3, 0.14, 0.14, 0.05, W / 2 - 0.2, 1.45, L + 0.08),
    ],
    ['aLightType'],
  );
  // Cartel LED frontal con número de línea (atlas) y uno lateral
  const sign = merge([new PlaneGeometry(1.9, 0.42).rotateY(Math.PI).translate(0, H - 0.38, -L - 0.07), new PlaneGeometry(1.9, 0.42).rotateY(Math.PI / 2).translate(W / 2 + 0.04, H - 0.5, -L + 2.6)]);
  return { paint: merge([body]), paint2, detail, lights, sign, hx: W / 2, hz: L + 0.08, h: H };
}

function moto(): VehicleModel {
  const detail = merge([
    paint(new TorusGeometry(0.3, 0.08, 6, 14).rotateY(Math.PI / 2).translate(0, 0.38, -0.68), '#141414'),
    paint(new TorusGeometry(0.3, 0.08, 6, 14).rotateY(Math.PI / 2).translate(0, 0.38, 0.68), '#141414'),
    paint(new BoxGeometry(0.28, 0.32, 1.1).translate(0, 0.62, 0), '#2a2c30'),
    paint(new BoxGeometry(0.06, 0.6, 0.06).rotateX(-0.35).translate(0, 0.85, -0.6), '#888'),
    paint(new BoxGeometry(0.62, 0.05, 0.05).translate(0, 1.12, -0.5), '#222'),
    // conductor con casco
    paint(new BoxGeometry(0.42, 0.62, 0.3).rotateX(0.25).translate(0, 1.15, 0.05), '#2d3540'),
    paint(new BoxGeometry(0.16, 0.5, 0.18).translate(0.16, 0.7, -0.1), '#23262b'),
    paint(new BoxGeometry(0.16, 0.5, 0.18).translate(-0.16, 0.7, -0.1), '#23262b'),
    paint(new SphereGeometry(0.17, 10, 8).translate(0, 1.6, -0.05), '#e8e8e8'),
    paint(new BoxGeometry(0.26, 0.08, 0.04).translate(0, 1.6, -0.21), '#111'),
  ]);
  // Caja de delivery (color por instancia)
  const box = new BoxGeometry(0.5, 0.48, 0.48).translate(0, 1.2, 0.48);
  const lights = merge(
    [
      light(0, 0.16, 0.12, 0.05, 0, 0.95, -0.82),
      light(1, 0.18, 0.08, 0.05, 0, 0.9, 0.75),
      light(2, 0.06, 0.06, 0.05, -0.18, 0.95, -0.78),
      light(3, 0.06, 0.06, 0.05, 0.18, 0.95, -0.78),
    ],
    ['aLightType'],
  );
  return { paint: merge([box]), paint2: null, detail, lights, sign: null, hx: 0.38, hz: 1.05, h: 1.75 };
}

export function buildVehicleModels(): Record<VehicleType, VehicleModel> {
  return {
    car: carLike({ len: 4.4, width: 1.78, belt: 0.95, roof: 1.42, cabin: [-1.45, -0.75, 0.45, 1.1], taxi: false, van: false }),
    taxi: carLike({ len: 4.5, width: 1.76, belt: 0.95, roof: 1.44, cabin: [-1.5, -0.8, 0.45, 1.12], taxi: true, van: false }),
    van: carLike({ len: 5.0, width: 1.95, belt: 1.12, roof: 1.98, cabin: [-2.35, -2.3, 0.7, 1.45], taxi: false, van: true }),
    bus: bus(),
    moto: moto(),
  };
}
