/**
 * SAT 2D (plano XZ) entre cajas orientadas. Las cajas estáticas son OBB con
 * yaw 0. Convención de yaw del juego: adelante = (−sin, −cos), derecha = (cos, −sin).
 */

export interface OBB {
  x: number;
  z: number;
  /** Semiancho (eje derecha) y semilargo (eje adelante/atrás). */
  hx: number;
  hz: number;
  yaw: number;
}

export interface Contact {
  /** Normal que empuja A fuera de B. */
  nx: number;
  nz: number;
  depth: number;
}

const axes = new Float32Array(8);

/** Devuelve true si A y B se superponen; llena `out` con la mínima separación. */
export function obbOverlap(a: OBB, b: OBB, out: Contact): boolean {
  const ca = Math.cos(a.yaw);
  const sa = Math.sin(a.yaw);
  const cb = Math.cos(b.yaw);
  const sb = Math.sin(b.yaw);
  // Ejes locales: derecha (cos, −sin) y largo (sin, cos)
  axes[0] = ca;
  axes[1] = -sa;
  axes[2] = sa;
  axes[3] = ca;
  axes[4] = cb;
  axes[5] = -sb;
  axes[6] = sb;
  axes[7] = cb;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const nx = axes[i * 2];
    const nz = axes[i * 2 + 1];
    const ra = a.hx * Math.abs(nx * ca + nz * -sa) + a.hz * Math.abs(nx * sa + nz * ca);
    const rb = b.hx * Math.abs(nx * cb + nz * -sb) + b.hz * Math.abs(nx * sb + nz * cb);
    const d = dx * nx + dz * nz;
    const overlap = ra + rb - Math.abs(d);
    if (overlap <= 0) return false;
    if (overlap < best) {
      best = overlap;
      // Empujar A en sentido opuesto a B
      const s = d > 0 ? -1 : 1;
      out.nx = nx * s;
      out.nz = nz * s;
      out.depth = overlap;
    }
  }
  return true;
}

/** Caja alineada a ejes → OBB reutilizable. */
export function aabbToObb(minX: number, maxX: number, minZ: number, maxZ: number, out: OBB): OBB {
  out.x = (minX + maxX) / 2;
  out.z = (minZ + maxZ) / 2;
  out.hx = (maxX - minX) / 2;
  out.hz = (maxZ - minZ) / 2;
  out.yaw = 0;
  return out;
}
