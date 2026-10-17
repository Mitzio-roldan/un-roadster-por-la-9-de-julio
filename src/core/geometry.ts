import { BufferAttribute, BufferGeometry, Color, type ColorRepresentation } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Helpers para armar modelos procedurales combinando primitivas en una sola
 * geometría con colores por vértice (1 draw call por modelo / por instancia).
 */

const _c = new Color();

/** Pinta toda la geometría con un color (atributo `color`) y la deja no indexada. */
export function paint(geo: BufferGeometry, color: ColorRepresentation, extra?: Record<string, number>): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  _c.set(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new BufferAttribute(arr, 3));
  if (extra) {
    for (const [name, value] of Object.entries(extra)) g.setAttribute(name, new BufferAttribute(new Float32Array(n).fill(value), 1));
  }
  return g;
}

/** Combina geometrías normalizando atributos (position, normal, uv, color + extras). */
export function merge(parts: BufferGeometry[], keep: string[] = []): BufferGeometry {
  const names = ['position', 'normal', 'uv', 'color', ...keep];
  const prepared = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (!names.includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    for (const k of keep) if (!g.attributes[k]) g.setAttribute(k, new BufferAttribute(new Float32Array(n), 1));
    return g;
  });
  const out = mergeGeometries(prepared, false);
  if (!out) throw new Error('merge: geometrías incompatibles');
  return out;
}
