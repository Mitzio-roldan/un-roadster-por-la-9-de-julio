import { BoxGeometry, CircleGeometry, Color, CylinderGeometry, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { merge, paint } from '../core/geometry';
import { patchMaterial } from '../core/shaderPatch';
import { ChunkedLayer } from './instanced';
import { X, chunkInfo, lightState, stopLineZ, crossStopLineX, type ChunkInfo, type LightColor, type LightState } from './layout';

/** Colores de lámpara encendida (HDR > 1 → bloom) y apagada. */
const ON: Record<LightColor, Color> = {
  red: new Color(6, 0.35, 0.2),
  yellow: new Color(5.5, 3.2, 0.25),
  green: new Color(0.25, 5, 2.2),
};
const OFF: Record<LightColor, Color> = {
  red: new Color(0.09, 0.015, 0.01),
  yellow: new Color(0.09, 0.06, 0.01),
  green: new Color(0.01, 0.07, 0.04),
};
const ORDER: LightColor[] = ['red', 'yellow', 'green'];

interface Bulb {
  index: number;
  group: 'avenue' | 'cross';
  color: LightColor;
}

/**
 * Semáforos funcionales: cabezales en canteros, isla, veredas y brazos sobre
 * la calzada. El estado sale de `lightState()` (función pura del tiempo y del
 * cruce), que es la misma que usa la IA del tránsito.
 */
export class TrafficLights {
  readonly poles: ChunkedLayer;
  readonly arms: ChunkedLayer;
  readonly heads: ChunkedLayer;
  readonly bulbs: ChunkedLayer;
  private readonly slotBulbs: Bulb[][] = [];
  private readonly slotChunk: number[] = [];
  private readonly state: LightState = { avenue: 'green', cross: 'red', avenueRemaining: 0, crossRemaining: 0 };

  constructor(slots: number) {
    const mat = patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 }), 'atm');
    this.poles = new ChunkedLayer(paint(new CylinderGeometry(0.09, 0.11, 1, 6).translate(0, 0.5, 0), '#2a2d31'), mat, 16, slots, { castShadow: true });
    this.arms = new ChunkedLayer(paint(new BoxGeometry(1, 0.16, 0.16).translate(0.5, 0, 0), '#2a2d31'), mat, 4, slots, { castShadow: true });
    const headGeo = merge([
      paint(new BoxGeometry(0.42, 1.12, 0.3), '#16181b'),
      paint(new BoxGeometry(0.56, 1.26, 0.04).translate(0, 0, -0.16), '#0f1012'),
      ...[0.34, 0, -0.34].map((y) => paint(new BoxGeometry(0.32, 0.05, 0.16).translate(0, y + 0.17, 0.2), '#101113')),
    ]);
    this.heads = new ChunkedLayer(headGeo, mat, 20, slots, { castShadow: true });
    this.bulbs = new ChunkedLayer(new CircleGeometry(0.13, 12), patchMaterial(new MeshBasicMaterial({ color: 0xffffff }), 'atm'), 60, slots, { color: true });
    for (let i = 0; i < slots; i++) {
      this.slotBulbs.push([]);
      this.slotChunk.push(-99999);
    }
  }

  get meshes() {
    return [this.poles.mesh, this.arms.mesh, this.heads.mesh, this.bulbs.mesh];
  }

  buildChunk(slot: number, info: ChunkInfo): void {
    const layers = [this.poles, this.arms, this.heads, this.bulbs];
    for (const l of layers) l.beginSlot(slot);
    const bulbs: Bulb[] = (this.slotBulbs[slot] = []);
    this.slotChunk[slot] = info.index;

    /** Cabezal mirando hacia `rotY` (0 = +Z). */
    const head = (x: number, y: number, z: number, rotY: number, group: Bulb['group']) => {
      this.heads.add(x, y, z, rotY, 1, 1, 1);
      const fx = Math.sin(rotY) * 0.16;
      const fz = Math.cos(rotY) * 0.16;
      ORDER.forEach((c, k) => {
        const idx = this.bulbs.add(x + fx, y + 0.34 - k * 0.34, z + fz, rotY, 1, 1, 1, OFF[c]);
        if (idx >= 0) bulbs.push({ index: idx, group, color: c });
      });
    };

    for (const side of [1, -1] as const) {
      const dir = side === 1 ? -1 : 1;
      const z = stopLineZ(info, dir) - dir * 0.6;
      const face = side === 1 ? 0 : Math.PI;
      // Cantero interno (Metrobus + carriles rápidos)
      const xi = side * (X.sepInnerEnd - 0.8);
      this.poles.add(xi, 0.2, z, 0, 1, 3.6, 1);
      head(xi, 3.2, z, face, 'avenue');
      // Isla del Metrobus
      const xs = side * (X.island - 0.8);
      this.poles.add(xs, 0.22, z, 0, 1, 3.5, 1);
      head(xs, 3.1, z, face, 'avenue');
      // Cantero externo con brazo sobre la calzada principal
      const xo = side * (X.mainEnd + 0.9);
      this.poles.add(xo, 0.2, z, 0, 1, 6.6, 1);
      const armLen = 9.5;
      this.arms.add(xo, 6.3, z, side === 1 ? Math.PI : 0, armLen, 1, 1);
      head(xo - side * 4.2, 5.55, z, face, 'avenue');
      head(xo - side * 8.4, 5.55, z, face, 'avenue');
      head(xo, 3.2, z, face, 'avenue');
      // Vereda para la calle lateral
      const xw = side * (X.lateralEnd + 0.6);
      this.poles.add(xw, 0.16, z, 0, 1, 3.6, 1);
      head(xw, 3.2, z, face, 'avenue');
    }
    // Calle transversal: semáforos en la esquina de entrada, mirando al tránsito que llega.
    const xs = crossStopLineX(info) + (info.crossDir === 1 ? 1.2 : -1.2);
    const faceX = info.crossDir === 1 ? -Math.PI / 2 : Math.PI / 2;
    for (const zc of [info.zCrossEnd - 0.8, info.z0 + 0.8]) {
      this.poles.add(xs, 0.16, zc, 0, 1, 3.6, 1);
      head(xs, 3.2, zc, faceX, 'cross');
    }
    for (const l of layers) {
      l.endSlot();
      l.flush();
    }
  }

  /** Actualiza los colores de todas las lámparas visibles. */
  update(time: number): void {
    const colors = this.bulbs.mesh.instanceColor;
    if (!colors) return;
    for (let s = 0; s < this.slotBulbs.length; s++) {
      const list = this.slotBulbs[s];
      if (!list.length) continue;
      lightState(chunkInfo(this.slotChunk[s]), time, this.state);
      for (const b of list) {
        const active = b.group === 'avenue' ? this.state.avenue : this.state.cross;
        const c = active === b.color ? ON[b.color] : OFF[b.color];
        colors.setXYZ(b.index, c.r, c.g, c.b);
      }
    }
    colors.needsUpdate = true;
  }
}
