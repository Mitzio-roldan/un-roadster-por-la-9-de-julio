import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
} from 'three';
import { merge, paint } from '../core/geometry';
import { patchMaterial } from '../core/shaderPatch';

/**
 * Hiperdeportivo eléctrico biplaza. El diseño está INSPIRADO en un
 * hiperdeportivo eléctrico presentado en 2026 (réplica sin nombre, logos ni
 * patentes; proyecto de fans, no afiliado a ninguna marca automotriz):
 * cuña muy baja y ancha, frente plano con guardabarros en punta y faros
 * triangulares, techo de vidrio bronce en gota, zócalo negro en "S", cola
 * recta con labio "ducktail" y barra roja de lado a lado, y difusor negro
 * con cuatro toberas de aire comprimido (los propulsores traseros).
 *
 * Toda la geometría es procedural (perfiles en función de z → "loft").
 * Ejes locales: trompa hacia −Z, +X a la derecha, y = 0 en el piso.
 */

export const WHEEL = { radius: 0.37, frontZ: -1.42, rearZ: 1.34, x: 0.89 };
/** Altura del eje de giro del salto. */
export const SPIN_Y = 0.55;
/** Altura de reposo del pivote del alerón. */
export const WING_BASE_Y = 0.9;

const NOSE_Z = -2.32;
const TAIL_Z = 2.32;

/* ------------------------------------------------------------------ */
/* Perfil paramétrico: cada medida es una curva por tramos en función de z */
/* ------------------------------------------------------------------ */

type Keys = [number, number][];
function curve(keys: Keys, z: number): number {
  if (z <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [z1, v1] = keys[i];
    if (z <= z1) {
      const [z0, v0] = keys[i - 1];
      const t = (z - z0) / (z1 - z0);
      return v0 + (v1 - v0) * t;
    }
  }
  return keys[keys.length - 1][1];
}

// Línea central del capot (placa plana y baja entre los guardabarros) → base del vidrio → labio de la cola
const DECK: Keys = [[-2.32, 0.4], [-1.5, 0.84], [-1.0, 0.88], [0.3, 0.82], [1.6, 0.88], [2.2, 0.9], [2.32, 0.93]];
// Cresta de los guardabarros: más alta que el capot adelante ("cuchillas" del frente)
const SHOULDER_Y: Keys = [[-2.32, 0.4], [-1.5, 0.84], [-1.0, 0.88], [0.3, 0.82], [1.34, 0.92], [2.32, 0.93]];
const SHOULDER_W: Keys = [[-2.32, 0.6], [-1.9, 0.8], [-1.42, 0.86], [0.2, 0.86], [1.34, 0.9], [2.32, 0.88]];
// Borde del capot (desde acá sube la pared interna del guardabarros)
const HOOD_W: Keys = [[-2.32, 0.58], [-1.9, 0.78], [-1.42, 0.84], [-1.0, 0.8], [0.0, 0.6], [2.32, 0.6]];
// Arista de cintura (lo más ancho del auto): chanfle entre cresta y costado plano
const BELT_Y: Keys = [[-2.32, 0.34], [-1.95, 0.5], [-1.7, 0.62], [-1.42, 0.78], [-1.0, 0.8], [-0.6, 0.8], [0.3, 0.74], [1.0, 0.84], [1.6, 0.86], [2.32, 0.78]];
const BELT_W: Keys = [[-2.32, 0.66], [-1.9, 0.96], [-1.42, 1.03], [-0.6, 1.02], [0.0, 0.99], [1.34, 1.04], [2.32, 1.0]];
// Límite pintura / parte baja negra: banda negra al frente y curva en "S" que sube detrás de la puerta
const SILL_Y: Keys = [[-2.32, 0.3], [-2.0, 0.27], [-0.9, 0.24], [0.0, 0.28], [0.7, 0.45], [1.0, 0.55], [2.32, 0.52]];
const SILL_W: Keys = [[-2.32, 0.64], [-1.9, 0.95], [-1.42, 1.0], [0.0, 0.95], [1.34, 1.0], [2.32, 0.97]];
const FLOOR_Y = 0.13;
const FLOOR_W: Keys = [[-2.32, 0.5], [-1.9, 0.85], [0.0, 0.86], [2.32, 0.9]];

/** Radio del recorte de los pasos de rueda y ancho interior del pozo. */
const ARCH_R = 0.39;
const WELL_X = 0.82;

/** Altura del recorte circular del paso de rueda en z (0 si no hay paso). */
function archY(z: number): number {
  let y = 0;
  for (const a of [WHEEL.frontZ, WHEEL.rearZ]) {
    const d = Math.abs(z - a);
    if (d < ARCH_R) y = Math.max(y, WHEEL.radius + Math.sqrt(ARCH_R * ARCH_R - d * d));
  }
  return y;
}

interface Profile {
  /** 8 puntos (medio perfil): piso centro, piso borde, pozo de rueda, zócalo, cintura, cresta, borde de capot, centro. */
  pts: [number, number][];
}

/**
 * Perfil transversal en z. En los pasos de rueda el costado se recorta con
 * un círculo limpio y el piso se retira hasta la pared interna del pozo
 * (así no quedan superficies inclinadas raras sobre la rueda).
 */
function profileAt(z: number): Profile {
  const ay = archY(z);
  const inArch = ay > 0;
  const sillY = Math.max(curve(SILL_Y, z), ay);
  const beltY = Math.max(curve(BELT_Y, z), sillY + 0.03);
  const shoulderY = Math.max(curve(SHOULDER_Y, z), beltY + 0.04);
  const deckY = Math.min(curve(DECK, z), shoulderY);
  const sillW = curve(SILL_W, z);
  const floorW = inArch ? WELL_X : curve(FLOOR_W, z);
  return {
    pts: [
      [0, FLOOR_Y],
      [floorW, FLOOR_Y],
      inArch ? [WELL_X, sillY] : [(floorW + sillW) / 2, (FLOOR_Y + sillY) / 2],
      [sillW, sillY],
      [curve(BELT_W, z), beltY],
      [curve(SHOULDER_W, z), shoulderY],
      [curve(HOOD_W, z), deckY + 0.01],
      [0, deckY],
    ],
  };
}

/** Muestras en z: más densas en los pasos de rueda para que salgan redondos. */
function zSamples(): number[] {
  const set = new Set<number>();
  for (let i = 0; i <= 30; i++) set.add(+(NOSE_Z + ((TAIL_Z - NOSE_Z) * i) / 30).toFixed(3));
  for (const a of [WHEEL.frontZ, WHEEL.rearZ]) {
    for (let i = -10; i <= 10; i++) set.add(+(a + (i / 10) * ARCH_R * 0.999).toFixed(4));
    set.add(+(a - ARCH_R - 0.001).toFixed(4));
    set.add(+(a + ARCH_R + 0.001).toFixed(4));
  }
  return [...set].filter((z) => z >= NOSE_Z && z <= TAIL_Z).sort((a, b) => a - b);
}

/**
 * Loft entre perfiles: arma una malla con los puntos [from..to] de cada
 * perfil, espejada en X, con tapas en trompa y cola. Sombreado plano → facetas.
 */
function loft(profiles: { z: number; p: Profile }[], from: number, to: number, capCenter: (pts: [number, number][]) => number): BufferGeometry {
  const v: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);
  for (let s = 0; s < profiles.length - 1; s++) {
    const A = profiles[s];
    const B = profiles[s + 1];
    for (let i = from; i < to; i++) {
      for (const side of [1, -1]) {
        const a0 = [side * A.p.pts[i][0], A.p.pts[i][1], A.z];
        const a1 = [side * A.p.pts[i + 1][0], A.p.pts[i + 1][1], A.z];
        const b0 = [side * B.p.pts[i][0], B.p.pts[i][1], B.z];
        const b1 = [side * B.p.pts[i + 1][0], B.p.pts[i + 1][1], B.z];
        tri(a0, b0, b1);
        tri(a0, b1, a1);
      }
    }
  }
  for (const P of [profiles[0], profiles[profiles.length - 1]]) {
    const cy = capCenter(P.p.pts);
    for (let i = from; i < to; i++) {
      for (const side of [1, -1]) {
        tri([0, cy, P.z], [side * P.p.pts[i][0], P.p.pts[i][1], P.z], [side * P.p.pts[i + 1][0], P.p.pts[i + 1][1], P.z]);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Techo de vidrio bronce: cúpula en forma de gota (vista desde arriba),
 * ancha adelante y afinándose hasta morir sobre la tapa trasera.
 */
function glasshouse(): BufferGeometry {
  // z, ancho base, alto base, ancho techo, alto techo
  const S: [number, number, number, number, number][] = [
    [-1.0, 0.7, 0.74, 0.62, 0.76],
    [-0.6, 0.86, 0.77, 0.72, 0.98],
    [-0.15, 0.9, 0.79, 0.74, 1.1],
    [0.4, 0.9, 0.81, 0.7, 1.12],
    [0.95, 0.86, 0.84, 0.6, 1.08],
    [1.45, 0.74, 0.87, 0.46, 0.99],
    [1.9, 0.5, 0.89, 0.28, 0.93],
    [2.15, 0.2, 0.905, 0.1, 0.915],
  ];
  const v: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);
  const pts = (s: (typeof S)[number]) => [
    [s[1], s[2]],
    [s[1] - 0.06, s[2] + (s[4] - s[2]) * 0.55],
    [s[3], s[4]],
    [0, s[4] + 0.015],
  ];
  for (let i = 0; i < S.length - 1; i++) {
    const A = pts(S[i]);
    const B = pts(S[i + 1]);
    for (let k = 0; k < A.length - 1; k++) {
      for (const side of [1, -1]) {
        const a0 = [side * A[k][0], A[k][1], S[i][0]];
        const a1 = [side * A[k + 1][0], A[k + 1][1], S[i][0]];
        const b0 = [side * B[k][0], B[k][1], S[i + 1][0]];
        const b1 = [side * B[k + 1][0], B[k + 1][1], S[i + 1][0]];
        tri(a0, b0, b1);
        tri(a0, b1, a1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

export interface CarParts {
  root: Group;
  /** Gira con el salto (eje longitudinal). */
  spin: Group;
  /** Cabeceo/rolido/suspensión de la carrocería. */
  body: Group;
  wheels: { pivot: Group; spin: Group; front: boolean; side: number }[];
  wing: Group;
  wingBlade: Group;
  /** Soportes del alerón: de altura unitaria, se estiran con la elevación para no quedar sueltos. */
  wingStruts: Mesh;
  nozzleGlow: Mesh[];
  brakeMat: MeshBasicMaterial;
  headMat: MeshBasicMaterial;
  cyanMat: MeshBasicMaterial;
  paintMat: MeshStandardMaterial;
  /** Posiciones locales (en el grupo spin) de toberas y puntos de estela. */
  nozzles: [number, number, number][];
  trailPoints: [number, number, number][];
  jetPoints: [number, number, number][];
}

/** Caja fina orientada entre dos puntos del costado (para filetes de luz/acentos). */
function strip(x: number, y0: number, z0: number, y1: number, z1: number, h: number, w: number): BufferGeometry {
  const len = Math.hypot(y1 - y0, z1 - z0);
  const ang = Math.atan2(y1 - y0, z1 - z0);
  return new BoxGeometry(w, h, len).rotateX(-ang).translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
}

export function buildCar(physicalPaint: boolean): CarParts {
  const root = new Group();
  root.name = 'player-car';
  const spin = new Group();
  spin.position.y = SPIN_Y;
  root.add(spin);
  const body = new Group();
  body.position.y = -SPIN_Y;
  spin.add(body);

  const paintMat: MeshStandardMaterial = physicalPaint
    ? new MeshPhysicalMaterial({ color: '#e8e9eb', metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, flatShading: true, side: DoubleSide })
    : new MeshStandardMaterial({ color: '#e8e9eb', metalness: 0.2, roughness: 0.35, flatShading: true, side: DoubleSide });
  const satinBlack = new MeshStandardMaterial({ color: '#0d0e10', metalness: 0.3, roughness: 0.5, flatShading: true, side: DoubleSide });
  const glassMat = physicalPaint
    ? new MeshPhysicalMaterial({ color: '#3b2817', metalness: 0.65, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.03, flatShading: true, side: DoubleSide })
    : new MeshStandardMaterial({ color: '#3b2817', metalness: 0.7, roughness: 0.08, flatShading: true, side: DoubleSide });
  const trimMat = new MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.5, flatShading: true });
  const chromeMat = new MeshStandardMaterial({ color: '#d7dade', metalness: 0.95, roughness: 0.18 });
  const cyanMat = new MeshBasicMaterial({ color: new Color(0.25, 3.2, 3.8) });
  const headMat = new MeshBasicMaterial({ color: new Color(3.4, 3.4, 3.6) });
  const brakeMat = new MeshBasicMaterial({ color: new Color(1.2, 0.05, 0.08) });
  const rubberMat = new MeshStandardMaterial({ color: '#141414', roughness: 0.92 });
  const discMat = new MeshStandardMaterial({ color: '#d4d7db', metalness: 0.55, roughness: 0.3 });
  const spokeMat = new MeshStandardMaterial({ color: '#111214', metalness: 0.4, roughness: 0.35 });
  for (const m of [paintMat, satinBlack, glassMat, trimMat, chromeMat, cyanMat, headMat, brakeMat, rubberMat, discMat, spokeMat] as Material[]) patchMaterial(m, 'atm');

  const add = (parent: Group, geo: BufferGeometry, mat: Material, shadow = true) => {
    const m = new Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    parent.add(m);
    return m;
  };

  // --- Carrocería: parte pintada (zócalo→centro) + parte baja negra (piso→zócalo) + techo de vidrio
  const profiles = zSamples().map((z) => ({ z, p: profileAt(z) }));
  add(body, loft(profiles, 3, 7, (pts) => (pts[3][1] + pts[7][1]) / 2), paintMat);
  add(body, loft(profiles, 0, 3, (pts) => (pts[0][1] + pts[3][1]) / 2), satinBlack);
  // Forro negro dentro de cada paso de rueda
  for (const z of [WHEEL.frontZ, WHEEL.rearZ]) {
    for (const side of [1, -1]) {
      const liner = new CylinderGeometry(ARCH_R - 0.01, ARCH_R - 0.01, 0.18, 24, 1, true).rotateZ(Math.PI / 2).translate(side * (WELL_X + 0.09), WHEEL.radius, z);
      add(body, liner, satinBlack, false);
    }
  }
  add(body, glasshouse(), glassMat);

  // --- Cola: labio "ducktail" que sobresale + panel trasero
  add(body, new BoxGeometry(1.96, 0.035, 0.16).translate(0, 0.925, 2.37), paintMat);

  // --- Negros: difusor con aletas, rejilla frontal, cámaras-espejo, corte de puerta
  add(
    body,
    merge([
      paint(new BoxGeometry(1.82, 0.4, 0.34).translate(0, 0.32, 2.18), '#0b0c0e'),
      ...[-0.9, -0.47, 0, 0.47, 0.9].map((x) => paint(new BoxGeometry(0.03, 0.2, 0.46).translate(x, 0.2, 2.24), '#17191c')),
      // Splitter bajo la trompa y ranura de toma de aire en la banda negra
      paint(new BoxGeometry(1.0, 0.025, 0.2).translate(0, 0.13, -2.28), '#08090a'),
      paint(new BoxGeometry(0.72, 0.03, 0.02).translate(0, 0.22, -2.325), '#25282d'),
      paint(new BoxGeometry(0.09, 0.06, 0.18).translate(1.0, 0.81, -0.72), '#0b0c0e'),
      paint(new BoxGeometry(0.09, 0.06, 0.18).translate(-1.0, 0.81, -0.72), '#0b0c0e'),
      paint(strip(1.003, 0.32, 0.5, 0.72, 0.62, 0.012, 0.012), '#202226'),
      paint(strip(-1.003, 0.32, 0.5, 0.72, 0.62, 0.012, 0.012), '#202226'),
    ]),
    trimMat,
  );

  // --- Luces: filete blanco en el borde del capot que sube por el frente de cada guardabarros en punta
  const nx = 0.58;
  const fx = 0.65;
  const ny = 0.385;
  const fy = 0.34;
  const slant = (side: number) =>
    new BoxGeometry(Math.hypot(fx - nx, fy - ny) + 0.02, 0.022, 0.03)
      .rotateZ(side * Math.atan2(fy - ny, fx - nx))
      .translate(side * (nx + fx) / 2, (ny + fy) / 2, -2.335);
  add(
    body,
    merge([paint(new BoxGeometry(nx * 2, 0.022, 0.03).translate(0, ny, -2.335), '#ffffff'), paint(slant(1), '#ffffff'), paint(slant(-1), '#ffffff')]),
    headMat,
    false,
  );
  // Barra roja trasera de lado a lado (se intensifica al frenar)
  add(body, new BoxGeometry(1.88, 0.04, 0.03).translate(0, 0.86, 2.335), brakeMat, false);

  // --- Propulsores traseros: cuatro toberas cromadas en el difusor (brillan al usarlas)
  const nozzles: [number, number, number][] = [
    [0.24, 0.4, 2.37],
    [-0.24, 0.4, 2.37],
    [0.68, 0.4, 2.37],
    [-0.68, 0.4, 2.37],
  ];
  const nozzleGlow: Mesh[] = [];
  const darkMat = patchMaterial(new MeshStandardMaterial({ color: '#050505', roughness: 0.9 }), 'atm');
  for (const [x, y, z] of nozzles) {
    add(body, new CylinderGeometry(0.095, 0.105, 0.14, 18).rotateX(Math.PI / 2).translate(x, y, z - 0.05), chromeMat);
    add(body, new CylinderGeometry(0.068, 0.068, 0.16, 18).rotateX(Math.PI / 2).translate(x, y, z - 0.04), darkMat, false);
    const glowMat = new MeshBasicMaterial({ color: new Color(0.3, 2.5, 3.2), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    nozzleGlow.push(add(body, new CylinderGeometry(0.064, 0.064, 0.02, 18).rotateX(Math.PI / 2).translate(x, y, z + 0.035), glowMat, false));
  }

  // --- Alerón activo: hoja al ras de la tapa trasera que se levanta con la velocidad
  const wing = new Group();
  wing.position.set(0, WING_BASE_Y, 2.06);
  body.add(wing);
  const wingStruts = add(
    wing,
    merge([paint(new BoxGeometry(0.035, 1, 0.08).translate(0.5, 0.5, 0.03), '#0b0c0e'), paint(new BoxGeometry(0.035, 1, 0.08).translate(-0.5, 0.5, 0.03), '#0b0c0e')]),
    trimMat,
  );
  wingStruts.position.y = -0.1;
  wingStruts.scale.y = 0.12;
  const wingBlade = new Group();
  wingBlade.position.y = 0.02;
  wing.add(wingBlade);
  add(wingBlade, new BoxGeometry(1.7, 0.025, 0.3).translate(0, 0, 0.06), paintMat);

  // --- Ruedas grandes: neumático, disco plateado con 6 rayos dobles negros
  const wheelGeo = new CylinderGeometry(WHEEL.radius, WHEEL.radius, 0.32, 28).rotateZ(Math.PI / 2);
  const discGeo = new CylinderGeometry(0.29, 0.29, 0.33, 28).rotateZ(Math.PI / 2);
  const spokeGeo = merge([
    ...[0, 1, 2, 3, 4, 5].flatMap((i) => {
      const a = (i * Math.PI * 2) / 6;
      return [-0.07, 0.07].map((o) => new BoxGeometry(0.345, 0.022, 0.29).translate(0.003, 0, 0.13).rotateX(a + o));
    }),
    new CylinderGeometry(0.055, 0.055, 0.35, 12).rotateZ(Math.PI / 2),
  ]);
  const wheels: CarParts['wheels'] = [];
  for (const [z, front] of [
    [WHEEL.frontZ, true],
    [WHEEL.rearZ, false],
  ] as const) {
    for (const side of [1, -1]) {
      const pivot = new Group();
      pivot.position.set(side * WHEEL.x, WHEEL.radius - SPIN_Y, z);
      spin.add(pivot);
      const wspin = new Group();
      pivot.add(wspin);
      add(wspin, wheelGeo, rubberMat);
      add(wspin, discGeo, discMat).position.x = side * 0.008;
      add(wspin, spokeGeo, spokeMat).position.x = side * 0.012;
      wheels.push({ pivot, spin: wspin, front, side });
    }
  }

  // Puntos de emisión de partículas (coordenadas del grupo spin)
  const trailPoints: [number, number, number][] = [
    [0.98, 0.9 - SPIN_Y, 2.3],
    [-0.98, 0.9 - SPIN_Y, 2.3],
  ];
  const jetPoints: [number, number, number][] = [
    [0.7, 0.12 - SPIN_Y, -1.0],
    [-0.7, 0.12 - SPIN_Y, -1.0],
    [0.7, 0.12 - SPIN_Y, 1.0],
    [-0.7, 0.12 - SPIN_Y, 1.0],
  ];

  return {
    root,
    spin,
    body,
    wheels,
    wing,
    wingBlade,
    wingStruts,
    nozzleGlow,
    brakeMat,
    headMat,
    cyanMat,
    paintMat,
    nozzles: nozzles.map(([x, y, z]) => [x, y - SPIN_Y, z + 0.05]),
    trailPoints,
    jetPoints,
  };
}

/** Cono aditivo de los chorros (se escala según la intensidad). */
export function makeJetCone(color: Color, length: number, radius: number): Mesh {
  // Base en el origen (tobera) y punta hacia −Y; brillo que se apaga hacia la punta.
  const geo = new ConeGeometry(radius, length, 16, 4, true).rotateX(Math.PI).translate(0, -length / 2, 0);
  const p = geo.attributes.position as BufferAttribute;
  const cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = 1 + p.getY(i) / length;
    cols.fill(t * t, i * 3, i * 3 + 3);
  }
  geo.setAttribute('color', new BufferAttribute(cols, 3));
  const mat = new MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity: 0.0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  patchMaterial(mat, 'atm');
  const m = new Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}
