import { AdditiveBlending, BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial, type Blending, type Color } from 'three';

/**
 * Sistema de partículas con pool fijo (ring buffer) en un único THREE.Points.
 * Se simula en CPU (posición, velocidad, arrastre, gravedad, tamaño y alfa
 * interpolados) y se sube a GPU una vez por frame. Sin allocs en el loop.
 */
export class Particles {
  readonly points: Points;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly a0: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly geo: BufferGeometry;
  private cursor = 0;
  private alive = 0;
  readonly material: ShaderMaterial;

  constructor(capacity: number, additive: boolean) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity).fill(1);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    const blending: Blending = additive ? AdditiveBlending : NormalBlending;
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), 256.0);
          vColor = aColor;
          vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          if (a * vAlpha < 0.003) discard;
          gl_FragColor = vec4(vColor ${additive ? '* a * vAlpha, 1.0' : ', a * vAlpha'});
        }`,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  /** Escala de tamaño en píxeles: alto del framebuffer / (2·tan(fov/2)). */
  setScale(pixelsPerUnitAtOneMeter: number): void {
    this.material.uniforms.uScale.value = pixelsPerUnitAtOneMeter;
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    color: Color,
    alpha = 1,
    drag = 0,
    gravity = 0,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const j = i * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.vel[j] = vx;
    this.vel[j + 1] = vy;
    this.vel[j + 2] = vz;
    this.col[j] = color.r;
    this.col[j + 1] = color.g;
    this.col[j + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.a0[i] = alpha;
    this.drag[i] = drag;
    this.grav[i] = gravity;
    this.alive = Math.min(this.cap, this.alive + 1);
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    let any = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      any++;
      this.life[i] -= dt;
      const t = 1 - Math.max(this.life[i], 0) / this.maxLife[i];
      const j = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[j] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k - this.grav[i] * dt;
      this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.02 && this.vel[j + 1] < 0) {
        this.pos[j + 1] = 0.02;
        this.vel[j + 1] *= -0.3;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      // Entra rápido y se desvanece
      this.alpha[i] = this.a0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
    }
    this.alive = any;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    this.alive = 1;
    this.update(0);
  }
}
