import { BufferAttribute, BufferGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, BoxGeometry, SphereGeometry } from 'three';
import { merge, paint } from '../core/geometry';
import { patchMaterial } from '../core/shaderPatch';
import { CONFIG } from '../config';
import type { ChunkInfo } from './layout';

/**
 * El Obelisco de Buenos Aires con proporciones reales: 67,5 m de alto, base
 * cuadrada de 6,8 m que se afina hasta ~3,5 m, piramidión con ventanitas.
 * Hay uno solo y se reubica en la cuadra de Av. Corrientes que esté cerca.
 */
export const OBELISCO = { height: 67.5, base: 6.8, top: 3.5, pyramid: 4.2 };

/** Pirámide truncada de 4 caras con normales planas. */
function frustum(b: number, t: number, h: number, y0: number): BufferGeometry {
  const hb = b / 2;
  const ht = t / 2;
  const v: number[] = [];
  const quad = (a: number[], b2: number[], c: number[], d: number[]) => v.push(...a, ...b2, ...c, ...a, ...c, ...d);
  const P = (x: number, y: number, z: number) => [x, y, z];
  const B = [P(-hb, y0, hb), P(hb, y0, hb), P(hb, y0, -hb), P(-hb, y0, -hb)];
  const T = [P(-ht, y0 + h, ht), P(ht, y0 + h, ht), P(ht, y0 + h, -ht), P(-ht, y0 + h, -ht)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(B[i], B[j], T[j], T[i]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

export class Obelisco {
  readonly group = new Group();
  private readonly stone: MeshStandardMaterial;
  /** Posición actual (z) o null si no hay ninguno cerca. */
  z: number | null = null;

  constructor() {
    const O = OBELISCO;
    const shaftH = O.height - O.pyramid;
    const shaft = paint(frustum(O.base, O.top, shaftH, 0.6), '#ebe5d8');
    const pyr = paint(frustum(O.top, 0.02, O.pyramid, 0.6 + shaftH), '#e3dccd');
    // Ventanitas del piramidión (una por cara)
    const wins = [0, 1, 2, 3].map((i) => {
      const a = (i * Math.PI) / 2;
      const r = O.top / 2 - 0.12;
      return paint(new BoxGeometry(0.5, 0.7, 0.3).rotateY(a).translate(Math.sin(a) * r, 0.6 + shaftH + 1.0, Math.cos(a) * r), '#2a2a2e');
    });
    // Juntas horizontales de los bloques (sutiles)
    const bands = [12, 24, 36, 48].map((y) => {
      const w = O.base + (O.top - O.base) * (y / shaftH) + 0.04;
      return paint(new BoxGeometry(w, 0.08, w).translate(0, 0.6 + y, 0), '#d6cfbf');
    });
    const base = paint(new BoxGeometry(O.base + 1.4, 0.6, O.base + 1.4).translate(0, 0.3, 0), '#cfc8b8');
    const geo = merge([shaft, pyr, base, ...wins, ...bands]);
    this.stone = new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, flatShading: true, emissive: 0xfff2dd, emissiveIntensity: 0 });
    patchMaterial(this.stone, 'atm');
    const mesh = new Mesh(geo, this.stone);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Plaza de la República: césped oval + anillo de baldosas + canteros de flores
    const lawn = new Mesh(
      merge([
        paint(new CylinderGeometry(1, 1, 0.3, 40).scale(4.5, 1, 30).translate(0, 0.15, 0), '#2f4a1d'),
        paint(new CylinderGeometry(1, 1, 0.34, 40).scale(4.2, 1, 7).translate(0, 0.17, 0), '#bdb5a5'),
        ...[-18, -12, 12, 18].map((z) => paint(new SphereGeometry(1, 10, 6).scale(1.4, 0.35, 2.2).translate(0, 0.3, z), '#c2357a')),
        ...[-15, 15].map((z) => paint(new SphereGeometry(1, 10, 6).scale(1.2, 0.3, 1.8).translate(0, 0.3, z), '#f2c230')),
      ]),
      patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 'atm'),
    );
    lawn.receiveShadow = true;
    this.group.add(lawn);
    this.group.visible = false;
  }

  setNight(night: boolean): void {
    // De noche lo iluminan reflectores desde la base.
    this.stone.emissiveIntensity = night ? 0.22 : 0;
  }

  /** Coloca el Obelisco en la cuadra correspondiente (si está cargada). */
  place(info: ChunkInfo | null): void {
    if (!info) {
      this.group.visible = false;
      this.z = null;
      return;
    }
    this.z = info.zCrossEnd - CONFIG.world.crosswalkWidth - CONFIG.obeliscoOffset;
    this.group.position.set(0, 0.22, this.z);
    this.group.visible = true;
  }
}
