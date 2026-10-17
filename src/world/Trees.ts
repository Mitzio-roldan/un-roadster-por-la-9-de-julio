import { Color, CylinderGeometry, IcosahedronGeometry, MeshStandardMaterial } from 'three';
import { merge, paint } from '../core/geometry';
import { Rng } from '../core/rng';
import { patchMaterial, replaceChunk } from '../core/shaderPatch';
import { ChunkedLayer } from './instanced';
import { X, type ChunkInfo } from './layout';
import { signUniforms } from './atlasMaterial';

const JACARANDA = ['#8a5cc7', '#9b6bd6', '#7d52b8', '#a57ad9', '#8c62c9'];
const GREEN = ['#4f7a2e', '#5d8a35', '#456b28'];

/**
 * Jacarandás en flor (octubre) en los canteros y algunos árboles verdes en las
 * veredas. Copas low-poly facetadas con un leve balanceo por viento en el
 * vertex shader.
 */
export class Trees {
  readonly trunks: ChunkedLayer;
  readonly crowns: ChunkedLayer;

  constructor(slots: number) {
    const trunk = merge([
      paint(new CylinderGeometry(0.16, 0.26, 3.4, 6).translate(0, 1.7, 0), '#4a3a2e'),
      paint(new CylinderGeometry(0.08, 0.13, 1.8, 5).rotateZ(0.6).translate(0.55, 3.6, 0), '#4a3a2e'),
      paint(new CylinderGeometry(0.08, 0.13, 1.8, 5).rotateZ(-0.7).translate(-0.6, 3.5, 0.1), '#4a3a2e'),
    ]);
    const crown = merge([
      paint(new IcosahedronGeometry(2.3, 1).scale(1.25, 0.72, 1.15).translate(0, 4.9, 0), '#ffffff'),
      paint(new IcosahedronGeometry(1.7, 0).scale(1.1, 0.75, 1).translate(1.4, 4.5, 0.6), '#e6e0f0'),
      paint(new IcosahedronGeometry(1.6, 0).scale(1.1, 0.7, 1.1).translate(-1.3, 4.6, -0.5), '#d8d0e8'),
      paint(new IcosahedronGeometry(1.4, 0).scale(1, 0.8, 1).translate(0.2, 5.8, -0.2), '#ffffff'),
    ]);
    const trunkMat = patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 'atm');
    const crownMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
    patchMaterial(crownMat, 'tree-sway', (s) => {
      s.uniforms.uTime = signUniforms.uTime;
      s.vertexShader = replaceChunk(s.vertexShader, '#include <common>', '#include <common>\nuniform float uTime;');
      s.vertexShader = replaceChunk(
        s.vertexShader,
        '#include <begin_vertex>',
        `#include <begin_vertex>
  #ifdef USE_INSTANCING
    float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
  #else
    float ph = 0.0;
  #endif
  float sway = (transformed.y - 3.5) * 0.035;
  transformed.x += sin(uTime * 1.3 + ph) * sway;
  transformed.z += cos(uTime * 1.1 + ph * 1.3) * sway * 0.6;`,
      );
    });
    this.trunks = new ChunkedLayer(trunk, trunkMat, 64, slots, { castShadow: true });
    this.crowns = new ChunkedLayer(crown, crownMat, 64, slots, { castShadow: true, color: true });
    this.trunks.mesh.name = 'trunks';
    this.crowns.mesh.name = 'crowns';
  }

  get meshes() {
    return [this.trunks.mesh, this.crowns.mesh];
  }

  buildChunk(slot: number, info: ChunkInfo): void {
    this.trunks.beginSlot(slot);
    this.crowns.beginSlot(slot);
    const rng = new Rng(info.index * 389 + 3);
    const c = new Color();
    const plant = (x: number, z: number, green: boolean, scale: number) => {
      const r = rng.range(0, Math.PI * 2);
      this.trunks.add(x, 0.2, z, r, scale, scale * rng.range(0.9, 1.15), scale);
      c.set(green ? rng.pick(GREEN) : rng.pick(JACARANDA)).multiplyScalar(rng.range(0.85, 1.1));
      this.crowns.add(x, 0.2, z, r, scale * rng.range(0.9, 1.1), scale, scale * rng.range(0.9, 1.1), c);
    };
    for (const side of [1, -1]) {
      for (const [a, b] of [
        [X.busEnd, X.sepInnerEnd],
        [X.mainEnd, X.sepOuterEnd],
      ]) {
        const cx = (a + b) / 2;
        let z = info.blockStart - rng.range(3, 7);
        while (z > info.blockEnd + 3) {
          // Dejamos libre el tramo de la parada del Metrobus/Obelisco para verlos bien.
          if (!(info.hasObelisco && a === X.busEnd && Math.abs(z - (info.zCrossEnd - 30)) < 26)) {
            plant(side * (cx + rng.range(-0.6, 0.6)), z, rng.chance(0.12), rng.range(0.85, 1.2));
          }
          z -= rng.range(8.5, 12.5);
        }
      }
      // Veredas: árboles sobre el cordón
      let z = info.zCrossEnd - rng.range(6, 12);
      while (z > info.z0 - 128) {
        plant(side * (X.lateralEnd + 1.3), z, rng.chance(0.6), rng.range(0.75, 1.0));
        z -= rng.range(14, 20);
      }
    }
    this.trunks.endSlot();
    this.crowns.endSlot();
    this.trunks.flush();
    this.crowns.flush();
  }
}
