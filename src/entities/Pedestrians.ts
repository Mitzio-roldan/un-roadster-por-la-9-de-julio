import { BoxGeometry, CapsuleGeometry, Color, MeshStandardMaterial, SphereGeometry } from 'three';
import { merge, paint } from '../core/geometry';
import { Rng } from '../core/rng';
import { patchMaterial, replaceChunk } from '../core/shaderPatch';
import { ChunkedLayer } from '../world/instanced';
import { X, type ChunkInfo } from '../world/layout';
import { signUniforms } from '../world/atlasMaterial';

const CLOTHES = ['#c0392b', '#2c3e50', '#16a085', '#f39c12', '#8e44ad', '#ecf0f1', '#34495e', '#d35400', '#27ae60', '#e84393', '#0984e3', '#636e72'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d9a066'];

/**
 * Peatones decorativos. Solo se ubican en veredas, isletas, puntas de cantero
 * y andenes del Metrobus: nunca pisan la calzada, así que no se los puede
 * atropellar. Tienen un leve balanceo para que no parezcan estatuas.
 */
export class Pedestrians {
  readonly bodies: ChunkedLayer;
  readonly heads: ChunkedLayer;

  constructor(slots: number) {
    const body = merge([
      paint(new BoxGeometry(0.15, 0.85, 0.18).translate(-0.1, 0.43, 0), '#3a3a40'),
      paint(new BoxGeometry(0.15, 0.85, 0.18).translate(0.1, 0.43, 0), '#3a3a40'),
      paint(new CapsuleGeometry(0.21, 0.5, 4, 8).scale(1.05, 1, 0.7).translate(0, 1.18, 0), '#ffffff'),
    ]);
    const head = merge([paint(new SphereGeometry(0.13, 10, 8).translate(0, 1.67, 0), '#ffffff'), paint(new SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, 1.4).translate(0, 1.7, -0.01), '#3b2a20')]);
    const sway = (key: string) => {
      const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
      return patchMaterial(m, key, (s) => {
        s.uniforms.uTime = signUniforms.uTime;
        s.vertexShader = replaceChunk(s.vertexShader, '#include <common>', '#include <common>\nuniform float uTime;');
        s.vertexShader = replaceChunk(
          s.vertexShader,
          '#include <begin_vertex>',
          `#include <begin_vertex>
  #ifdef USE_INSTANCING
    float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 0.9;
    transformed.x += sin(uTime * 1.6 + ph) * 0.025 * transformed.y;
  #endif`,
        );
      });
    };
    this.bodies = new ChunkedLayer(body, sway('ped-body'), 24, slots, { color: true, castShadow: true });
    this.heads = new ChunkedLayer(head, sway('ped-head'), 24, slots, { color: true, castShadow: false });
  }

  get meshes() {
    return [this.bodies.mesh, this.heads.mesh];
  }

  buildChunk(slot: number, info: ChunkInfo): void {
    this.bodies.beginSlot(slot);
    this.heads.beginSlot(slot);
    const rng = new Rng(info.index * 211 + 5);
    const c = new Color();
    const skin = new Color();
    const put = (x: number, z: number, faceZ: boolean) => {
      const rot = (faceZ ? (rng.chance(0.5) ? 0 : Math.PI) : rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) + rng.range(-0.5, 0.5);
      const s = rng.range(0.92, 1.08);
      c.set(rng.pick(CLOTHES));
      skin.set(rng.pick(SKIN));
      this.bodies.add(x, 0.18, z, rot, s, s, s, c);
      this.heads.add(x, 0.18, z, rot, s, s, s, skin);
    };
    for (const side of [1, -1]) {
      // Esquinas de vereda esperando cruzar la avenida
      for (const zc of [info.zCrossEnd - 2.2, info.z0 + 2.2]) {
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i++) put(side * rng.range(X.lateralEnd + 0.8, X.sidewalkEnd - 0.8), zc + rng.range(-1.2, 1.2), false);
      }
      // Puntas de cantero junto a las sendas
      for (const [a, b] of [
        [X.busEnd, X.sepInnerEnd],
        [X.mainEnd, X.sepOuterEnd],
      ]) {
        if (rng.chance(0.55)) put(side * rng.range(a + 0.7, b - 0.7), info.blockStart - rng.range(0.6, 1.4), false);
        if (rng.chance(0.4)) put(side * rng.range(a + 0.7, b - 0.7), info.blockEnd + rng.range(0.6, 1.4), false);
      }
      // Caminando por la vereda (quietos, mirando a lo largo)
      for (let i = 0; i < 2; i++) put(side * rng.range(X.lateralEnd + 2.5, X.sidewalkEnd - 0.6), rng.range(info.blockEnd, info.blockStart), true);
    }
    // Andén del Metrobus
    if (info.hasStation) {
      const zc = (info.blockStart + info.blockEnd) / 2;
      const n = rng.int(3, 6);
      for (let i = 0; i < n; i++) put(rng.range(-1.6, 1.6), zc + rng.range(-18, 18), false);
    }
    this.bodies.endSlot();
    this.heads.endSlot();
    this.bodies.flush();
    this.heads.flush();
  }
}
