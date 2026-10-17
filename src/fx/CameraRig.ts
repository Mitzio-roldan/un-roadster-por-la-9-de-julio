import { PerspectiveCamera, Vector3 } from 'three';
import { CONFIG } from '../config';
import { clamp, damp, wrapAngle } from '../core/math';
import type { VehiclePhysics } from '../physics/VehiclePhysics';

export type CameraMode = 'chase' | 'hood';
const CC = CONFIG.camera;

/** Ruido 1D suave y barato para el temblor de cámara. */
function shakeNoise(t: number, seed: number): number {
  return Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.77 + seed * 3.1) * 0.2;
}

/**
 * Cámara de persecución suavizada:
 * - El offset detrás del auto se suaviza en el marco del auto (sin quedarse
 *   atrás a 300 km/h); el retraso en curvas viene de suavizar el yaw.
 * - Retraso vertical en los saltos, FOV dinámico con la velocidad y los
 *   propulsores, temblor (boost/aterrizaje/choque).
 * - En el salto con giro se aleja y sube para mostrar la maniobra.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'chase';
  private yawS = 0;
  private readonly offset = new Vector3(0, CC.chase.height, CC.chase.distance);
  private carYS = 0;
  private spinBlend = 0;
  private fovS: number = CC.baseFov;
  private shakeAmp = 0;
  private readonly look = new Vector3();
  private readonly desired = new Vector3();
  private t = 0;
  /** Ángulo del giratorio del menú. */
  menuAngle = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(CC.baseFov, aspect, CC.near, CC.far);
  }

  addShake(a: number): void {
    this.shakeAmp = Math.min(1.5, this.shakeAmp + a);
  }

  toggleMode(): void {
    this.mode = this.mode === 'chase' ? 'hood' : 'chase';
  }

  snap(ph: VehiclePhysics): void {
    this.yawS = ph.yaw;
    this.carYS = ph.pos.y;
    this.offset.set(0, CC.chase.height, CC.chase.distance);
    this.spinBlend = 0;
  }

  /** Cámara de pantalla de inicio: gira lento alrededor del auto (corrido a la derecha del título). */
  updateMenu(dt: number, target: Vector3, viewW: number, viewH: number): void {
    const shift = viewW > viewH ? -viewW * 0.17 : 0;
    if (this.camera.view?.offsetX !== shift) this.camera.setViewOffset(viewW, viewH, shift, 0, viewW, viewH);
    this.t += dt;
    this.menuAngle += dt * 0.12;
    const a = this.menuAngle + 0.6;
    const r = 7.6;
    this.camera.position.set(target.x + Math.sin(a) * r, 1.9 + Math.sin(this.t * 0.3) * 0.15, target.z + Math.cos(a) * r);
    this.look.set(target.x, 0.65, target.z);
    this.camera.lookAt(this.look);
    this.setFov(50, dt);
  }

  /**
   * Cámara de choque: sube por encima del tránsito (no queda dentro de un
   * colectivo que frena atrás) y orbita lento alrededor del auto.
   */
  updateCrash(dt: number, target: Vector3): void {
    this.t += dt;
    this.yawS += dt * 0.5;
    const r = 10;
    this.desired.set(target.x + Math.sin(this.yawS) * r, Math.max(target.y, 0) + 6.5, target.z + Math.cos(this.yawS) * r);
    const k = 1 - Math.exp(-4 * dt);
    this.camera.position.lerp(this.desired, k);
    this.look.set(target.x, target.y + 0.6, target.z);
    this.camera.lookAt(this.look);
    this.shakeAmp = damp(this.shakeAmp, 0, 3, dt);
    if (this.shakeAmp > 0.01) this.camera.position.y += shakeNoise(this.t * 22, 3) * this.shakeAmp * 0.3;
    this.setFov(CC.baseFov, dt);
  }

  update(dt: number, ph: VehiclePhysics, boost: number, spinning: boolean): void {
    if (this.camera.view?.enabled) this.camera.clearViewOffset();
    this.t += dt;
    const speedK = clamp(ph.speedKmh / CONFIG.car.normal.topSpeedKmh, 0, 1.2);
    this.spinBlend = damp(this.spinBlend, spinning ? 1 : 0, spinning ? 3 : 2, dt);
    this.yawS += wrapAngle(ph.yaw - this.yawS) * (1 - Math.exp(-CC.chase.yawLag * dt));
    this.carYS = damp(this.carYS, ph.pos.y, CC.chase.heightLag, dt);
    const hood = this.mode === 'hood' && this.spinBlend < 0.5;

    if (hood) {
      const s = Math.sin(ph.yaw);
      const c = Math.cos(ph.yaw);
      const hy = CC.hood.y + ph.pos.y;
      // Local (0, y, z) → mundo: el eje +Z local es (sin, 0, cos)
      this.camera.position.set(ph.pos.x + s * CC.hood.z, hy, ph.pos.z + c * CC.hood.z);
      this.look.set(ph.pos.x - s * 30, hy - 0.8, ph.pos.z - c * 30);
      this.camera.lookAt(this.look);
      this.setFov(CC.hood.fov + speedK * CC.speedFov * 0.7 + boost * CC.boostFov, dt);
    } else {
      const bs = Math.sin(this.yawS);
      const bc = Math.cos(this.yawS);
      const dist = CC.chase.distance + speedK * CC.chase.speedPull + this.spinBlend * CC.spin.pullBack;
      const h = CC.chase.height + this.spinBlend * CC.spin.raise;
      // Offset deseado detrás del auto (en mundo), suavizado sin arrastre por velocidad
      this.desired.set(bs * dist, h, bc * dist);
      this.offset.x = damp(this.offset.x, this.desired.x, CC.chase.posLag, dt);
      this.offset.y = damp(this.offset.y, this.desired.y, CC.chase.posLag, dt);
      this.offset.z = damp(this.offset.z, this.desired.z, CC.chase.posLag, dt);
      this.camera.position.set(ph.pos.x + this.offset.x, this.carYS + this.offset.y, ph.pos.z + this.offset.z);
      const ahead = CC.chase.lookAhead * (1 - this.spinBlend);
      this.look.set(ph.pos.x - bs * ahead, this.carYS * (1 - this.spinBlend) + ph.pos.y * this.spinBlend + CC.chase.lookHeight, ph.pos.z - bc * ahead);
      this.camera.lookAt(this.look);
      this.setFov(CC.baseFov + speedK * CC.speedFov + boost * CC.boostFov - this.spinBlend * 4, dt);
    }

    // Temblor
    this.shakeAmp = damp(this.shakeAmp, 0, 4, dt);
    const amp = this.shakeAmp + boost * CC.shake.boost * (0.5 + speedK);
    if (amp > 0.001) {
      const tt = this.t * 22;
      this.camera.position.x += shakeNoise(tt, 1) * amp * 0.25;
      this.camera.position.y += shakeNoise(tt, 7) * amp * 0.18;
      this.camera.rotation.z += shakeNoise(tt, 13) * amp * 0.02;
    }
  }

  private setFov(target: number, dt: number): void {
    this.fovS = damp(this.fovS, target, 5, dt);
    if (Math.abs(this.camera.fov - this.fovS) > 0.01) {
      this.camera.fov = this.fovS;
      this.camera.updateProjectionMatrix();
    }
  }
}
