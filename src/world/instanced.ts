import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  Euler,
  type Material,
} from 'three';

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _e = new Euler();
const ZERO = new Matrix4().makeScale(0, 0, 0);

export interface LayerOptions {
  color?: boolean;
  /** Atributos por instancia extra (nombre → componentes). */
  attributes?: Record<string, number>;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * Un InstancedMesh dividido en "slots" de chunk: cada chunk de la avenida
 * escribe sus instancias en su propio rango. Al reciclar un chunk se
 * reescribe solo ese rango: cero draw calls extra y nada de alloc.
 */
export class ChunkedLayer {
  readonly mesh: InstancedMesh;
  private readonly attrs: Record<string, InstancedBufferAttribute> = {};
  private cursor = 0;
  private end = 0;
  private dirty = false;

  constructor(
    geometry: BufferGeometry,
    material: Material | Material[],
    readonly perChunk: number,
    readonly slots: number,
    opts: LayerOptions = {},
  ) {
    const count = perChunk * slots;
    this.mesh = new InstancedMesh(geometry, material, count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = opts.castShadow ?? false;
    this.mesh.receiveShadow = opts.receiveShadow ?? true;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, ZERO);
    if (opts.color) {
      this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
      this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    }
    for (const [name, size] of Object.entries(opts.attributes ?? {})) {
      const a = new InstancedBufferAttribute(new Float32Array(count * size), size);
      a.setUsage(DynamicDrawUsage);
      geometry.setAttribute(name, a);
      this.attrs[name] = a;
    }
  }

  /** Empieza a escribir el slot (borra lo anterior al terminar con `endSlot`). */
  beginSlot(slot: number): void {
    this.cursor = slot * this.perChunk;
    this.end = this.cursor + this.perChunk;
  }

  /** Agrega una instancia con rotación Y. Devuelve el índice o −1 si no hay lugar. */
  add(x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number, color?: Color | number, extra?: Record<string, number | number[]>): number {
    _e.set(0, rotY, 0);
    _q.setFromEuler(_e);
    return this.addTRS(_p.set(x, y, z), _q, _s.set(sx, sy, sz), color, extra);
  }

  addTRS(p: Vector3, q: Quaternion, s: Vector3, color?: Color | number, extra?: Record<string, number | number[]>): number {
    if (this.cursor >= this.end) {
      if (import.meta.env.DEV) console.warn('[ChunkedLayer] capacidad excedida', this.mesh.name);
      return -1;
    }
    const i = this.cursor++;
    _m.compose(p, q, s);
    this.mesh.setMatrixAt(i, _m);
    if (color !== undefined && this.mesh.instanceColor) {
      const c = typeof color === 'number' ? _tmpColor.setHex(color) : color;
      this.mesh.instanceColor.setXYZ(i, c.r, c.g, c.b);
    }
    if (extra) {
      for (const k in extra) {
        const a = this.attrs[k];
        const v = extra[k];
        if (!a) continue;
        if (typeof v === 'number') a.setX(i, v);
        else for (let j = 0; j < v.length; j++) a.array[i * a.itemSize + j] = v[j];
      }
    }
    this.dirty = true;
    return i;
  }

  /** Vacía el resto del slot (matrices en cero) y marca para subir a GPU. */
  endSlot(): void {
    while (this.cursor < this.end) this.mesh.setMatrixAt(this.cursor++, ZERO);
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    for (const k in this.attrs) this.attrs[k].needsUpdate = true;
    this.dirty = false;
  }
}

const _tmpColor = new Color();
