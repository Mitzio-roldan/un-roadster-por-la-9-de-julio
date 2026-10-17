import { CONFIG } from '../config';
import { BLOCK, X, chunkInfo, type ChunkInfo } from './layout';
import { OBELISCO } from './Obelisco';

/** Caja estática alineada a ejes (en XZ) con altura. */
export interface StaticBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  /** curb: cordón/cantero (roce o choque según ángulo); wall: límite duro; monument: Obelisco. */
  kind: 'curb' | 'wall' | 'monument';
}

const cache = new Map<number, StaticBox[]>();

/**
 * Colisionadores de una cuadra, derivados de la misma geometría "de papel"
 * que usa el render: canteros, isla central (más alta donde hay parada),
 * manzanas (vereda + edificios), límites de calles transversales y Obelisco.
 */
export function chunkColliders(index: number): StaticBox[] {
  let list = cache.get(index);
  if (list) return list;
  const info: ChunkInfo = chunkInfo(index);
  list = [];
  const zA = info.blockStart;
  const zB = info.blockEnd;
  for (const side of [1, -1]) {
    for (const [a, b] of [
      [X.busEnd, X.sepInnerEnd],
      [X.mainEnd, X.sepOuterEnd],
    ]) {
      list.push(box(side * a, side * b, zB, zA, 1.1, 'curb'));
    }
    // Manzana (vereda + edificios): de la avenida hacia afuera
    list.push(box(side * X.lateralEnd, side * (CONFIG.world.sideExtent + 40), info.z0 - BLOCK, info.zCrossEnd, 3.2, 'curb'));
    // Fin jugable de la calle transversal
    const lim = CONFIG.world.crossStreetLimit;
    list.push(box(side * lim, side * (lim + 30), info.zCrossEnd - 1, info.z0 + 1, 200, 'wall'));
  }
  // Isla central (Metrobus). Con parada, el techo la hace más alta.
  if (info.hasStation) {
    const zc = (zA + zB) / 2;
    list.push(box(-X.island, X.island, zB, zc - 24, 1.1, 'curb'));
    list.push(box(-X.island, X.island, zc - 24, zc + 24, 3.9, 'curb'));
    list.push(box(-X.island, X.island, zc + 24, zA, 1.1, 'curb'));
  } else {
    list.push(box(-X.island, X.island, zB, zA, 1.1, 'curb'));
  }
  if (info.hasObelisco) {
    const zo = info.zCrossEnd - CONFIG.world.crosswalkWidth - CONFIG.obeliscoOffset;
    const h = (OBELISCO.base + 1.4) / 2;
    list.push(box(-h, h, zo - h, zo + h, OBELISCO.height, 'monument'));
  }
  if (cache.size > 64) cache.delete(cache.keys().next().value as number);
  cache.set(index, list);
  return list;
}

function box(x0: number, x1: number, z0: number, z1: number, height: number, kind: StaticBox['kind']): StaticBox {
  return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), height, kind };
}
