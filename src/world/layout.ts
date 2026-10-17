import { CONFIG } from '../config';
import { hash01 } from '../core/rng';
import { wrap } from '../core/math';

/**
 * Geometría "de papel" de la avenida: corte transversal, carriles, cuadras y
 * fases de semáforos. Todo es función pura de la configuración y del índice de
 * cuadra, así el mundo, el tránsito, las colisiones y el shader del asfalto
 * comparten exactamente las mismas medidas.
 */

const L = CONFIG.layout;

/** Bordes (en |x|) de cada franja del medio perfil. */
export const X = (() => {
  const island = L.islandHalf;
  const busEnd = island + L.busLaneWidth * L.busLanes;
  const sepInnerEnd = busEnd + L.sepInner;
  const mainEnd = sepInnerEnd + L.mainLaneWidth * L.mainLanes;
  const sepOuterEnd = mainEnd + L.sepOuter;
  const lateralEnd = sepOuterEnd + L.lateralLaneWidth * L.lateralLanes;
  const sidewalkEnd = lateralEnd + L.sidewalk;
  const buildings = sidewalkEnd + L.buildingGap;
  return { island, busEnd, sepInnerEnd, mainEnd, sepOuterEnd, lateralEnd, sidewalkEnd, buildings };
})();

export type LaneKind = 'bus' | 'main' | 'lateral';

export interface Lane {
  id: number;
  kind: LaneKind;
  /** Centro del carril en x. */
  x: number;
  width: number;
  /** −1: circula hacia −Z (lado x>0). +1: hacia +Z (lado x<0). */
  dir: 1 | -1;
  /** Índice dentro de su calzada contado desde el centro de la avenida. */
  order: number;
  /** Cantidad de carriles en su calzada. */
  count: number;
}

export const LANES: Lane[] = (() => {
  const out: Lane[] = [];
  const add = (kind: LaneKind, start: number, w: number, n: number) => {
    for (const side of [1, -1] as const) {
      for (let i = 0; i < n; i++) {
        out.push({ id: out.length, kind, x: side * (start + w * (i + 0.5)), width: w, dir: side === 1 ? -1 : 1, order: i, count: n });
      }
    }
  };
  add('bus', X.island, L.busLaneWidth, L.busLanes);
  add('main', X.sepInnerEnd, L.mainLaneWidth, L.mainLanes);
  add('lateral', X.sepOuterEnd, L.lateralLaneWidth, L.lateralLanes);
  return out;
})();

/** Carril vecino en la misma calzada (o undefined). `delta` en orden desde el centro. */
export function neighborLane(lane: Lane, delta: number): Lane | undefined {
  const o = lane.order + delta;
  if (o < 0 || o >= lane.count) return undefined;
  return LANES.find((l) => l.kind === lane.kind && l.dir === lane.dir && l.order === o);
}

export const BLOCK = CONFIG.world.blockLength;
export const STREETS = CONFIG.streets;
export const STREET_COUNT = STREETS.length;
export const CROSSWALK = CONFIG.world.crosswalkWidth;

export interface ChunkInfo {
  index: number;
  streetIndex: number;
  streetName: string;
  /** Borde +Z del cruce (z0 = −index·BLOCK). El cruce ocupa [z0 − crossWidth, z0]. */
  z0: number;
  crossWidth: number;
  /** z del borde −Z del cruce. */
  zCrossEnd: number;
  /** Extremos de la cuadra (canteros) en z, sin las sendas. */
  blockStart: number;
  blockEnd: number;
  /** Sentido de la calle transversal (mano única): +1 hacia +X, −1 hacia −X. */
  crossDir: 1 | -1;
  hasObelisco: boolean;
  hasStation: boolean;
  hasGantry: boolean;
  /** Desfase del ciclo semafórico de este cruce (s). */
  lightOffset: number;
}

export function streetIndexOf(chunk: number): number {
  return wrap(chunk, STREET_COUNT);
}

export function crossWidthOf(streetIndex: number): number {
  return STREETS[streetIndex].avenue ? CONFIG.world.avenueCrossWidth : CONFIG.world.streetCrossWidth;
}

const OBELISCO_INDEX = STREETS.findIndex((s) => s.name === CONFIG.obeliscoStreet);

export function chunkInfo(index: number): ChunkInfo {
  const si = streetIndexOf(index);
  const z0 = -index * BLOCK;
  const w = crossWidthOf(si);
  const hasObelisco = si === OBELISCO_INDEX;
  return {
    index,
    streetIndex: si,
    streetName: STREETS[si].name,
    z0,
    crossWidth: w,
    zCrossEnd: z0 - w,
    blockStart: z0 - w - CROSSWALK,
    blockEnd: z0 - BLOCK + CROSSWALK,
    crossDir: si % 2 === 0 ? 1 : -1,
    hasObelisco,
    // Paradas de Metrobus cada dos cuadras (no en la del Obelisco: ahí está la plaza).
    hasStation: !hasObelisco && wrap(index, 2) === 1,
    hasGantry: wrap(index, 3) === 0 && !hasObelisco,
    lightOffset: hash01(si * 7919 + 13) * 40,
  };
}

/** Índice de cuadra que contiene la coordenada z. */
export function chunkIndexAt(z: number): number {
  return Math.floor(-z / BLOCK);
}

/* ------------------------------------------------------------------ */
/* Semáforos                                                            */
/* ------------------------------------------------------------------ */

export type LightColor = 'green' | 'yellow' | 'red';

export interface LightState {
  avenue: LightColor;
  cross: LightColor;
  /** Segundos hasta el próximo cambio de la avenida. */
  avenueRemaining: number;
  crossRemaining: number;
}

const TL = CONFIG.trafficLights;
export const LIGHT_CYCLE = TL.avenueGreen + TL.yellow + TL.allRed + TL.crossGreen + TL.yellow + TL.allRed;

/** Estado de un cruce en el tiempo global `t`. */
export function lightState(info: ChunkInfo, t: number, out: LightState): LightState {
  let p = (t + info.lightOffset) % LIGHT_CYCLE;
  if (p < 0) p += LIGHT_CYCLE;
  const a1 = TL.avenueGreen;
  const a2 = a1 + TL.yellow;
  const a3 = a2 + TL.allRed;
  const c1 = a3 + TL.crossGreen;
  const c2 = c1 + TL.yellow;
  if (p < a1) {
    out.avenue = 'green';
    out.avenueRemaining = a1 - p;
  } else if (p < a2) {
    out.avenue = 'yellow';
    out.avenueRemaining = a2 - p;
  } else {
    out.avenue = 'red';
    out.avenueRemaining = LIGHT_CYCLE - p;
  }
  if (p >= a3 && p < c1) {
    out.cross = 'green';
    out.crossRemaining = c1 - p;
  } else if (p >= c1 && p < c2) {
    out.cross = 'yellow';
    out.crossRemaining = c2 - p;
  } else {
    out.cross = 'red';
    out.crossRemaining = p < a3 ? a3 - p : LIGHT_CYCLE - p + a3;
  }
  return out;
}

/** z de la línea de detención para un carril de la avenida en el cruce `info`. */
export function stopLineZ(info: ChunkInfo, dir: 1 | -1): number {
  const g = CONFIG.world.stopLineGap;
  return dir === -1 ? info.z0 + CROSSWALK + g : info.zCrossEnd - CROSSWALK - g;
}

/** x de la línea de detención de la calle transversal (lado de entrada). */
export function crossStopLineX(info: ChunkInfo): number {
  const x = X.sidewalkEnd + CROSSWALK + CONFIG.world.stopLineGap;
  return info.crossDir === 1 ? -x : x;
}

/** Carriles (centros z) de la calle transversal. */
export function crossLanes(info: ChunkInfo): number[] {
  const n = Math.max(2, Math.floor(info.crossWidth / 3.2));
  const w = info.crossWidth / n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(info.z0 - w * (i + 0.5));
  return out;
}
