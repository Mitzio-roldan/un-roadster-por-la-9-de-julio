import { Vector3 } from 'three';
import { CONFIG, KMH } from '../config';
import { approach, clamp, damp, easeInOutCubic, smoothstep } from '../core/math';
import { accelAt, calibrateCurve, type AccelCurve } from './accel';
import { obbOverlap, aabbToObb, type Contact, type OBB } from './collision';
import type { AirTanks } from './AirTanks';
import type { StaticBox } from '../world/colliders';

const C = CONFIG.car;
const J = CONFIG.jump;

export interface DriveInput {
  throttle: number;
  brake: number;
  /** −1 izquierda … +1 derecha */
  steer: number;
  boost: boolean;
}

/** Eventos de un paso de física (los consume Game para FX/sonido/puntaje). */
export interface PhysicsEvents {
  landed: boolean;
  landingSpeed: number;
  spinLanded: boolean;
  spinPerfect: boolean;
  /** Impacto más fuerte contra estáticos en este paso (m/s normales). */
  wallImpact: number;
  wallKind: StaticBox['kind'] | null;
  wallNormal: Vector3;
  /** Pasó por el punto más alto de un salto con giro. */
  spinApex: boolean;
}

export type JumpKind = 'none' | 'jump' | 'spin';

/**
 * Modelo de manejo arcade ("bicicleta" de dos ejes) escrito a mano.
 *
 * - Longitudinal: curva de aceleración calibrada (normal o propulsores),
 *   freno, reversa, rodadura y arrastre aerodinámico al soltar.
 * - Dirección progresiva: el ángulo máximo de volante cae con la velocidad y
 *   el volante se mueve con una velocidad finita (teclado = rampa suave).
 * - Yaw = v·tan(δ)/L, limitado por una aceleración lateral máxima.
 * - Agarre lateral: la velocidad lateral (deslizamiento) decae
 *   exponencialmente; el coeficiente baja a alta velocidad → derrape leve.
 * - Aire: gravedad propia, control de yaw reducido, propulsores traseros
 *   siguen empujando. El giro de 360° se sincroniza con el tiempo de vuelo.
 */
export class VehiclePhysics {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  yaw = 0;
  yawRate = 0;
  steerAngle = 0;
  grounded = true;
  boosting = false;
  /** Aceleraciones para la dinámica visual de carrocería. */
  accelLong = 0;
  accelLatRight = 0;
  /** Salto actual. */
  jumpKind: JumpKind = 'none';
  jumpClock = 0;
  airTime = 0;
  spinAngle = 0;
  spinDir = 1;
  spinDuration = 1;
  spinElapsed = 0;
  private spinApexDone = false;
  /** Velocidad máxima alcanzada en la partida (km/h). */
  maxKmh = 0;

  readonly normalCurve: AccelCurve;
  readonly boostCurve: AccelCurve;
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();
  private readonly box: OBB = { x: 0, z: 0, hx: C.collisionHalf.x, hz: C.collisionHalf.z, yaw: 0 };
  private readonly other: OBB = { x: 0, z: 0, hx: 0, hz: 0, yaw: 0 };
  private readonly contact: Contact = { nx: 0, nz: 0, depth: 0 };

  constructor() {
    this.normalCurve = calibrateCurve(C.normal.zeroTo97Seconds, C.normal.topSpeedKmh, C.normal.curveExponent);
    this.boostCurve = calibrateCurve(C.boost.zeroTo97Seconds, C.boost.topSpeedKmh, C.boost.curveExponent);
  }

  reset(x: number, z: number, yaw = 0): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.grounded = true;
    this.jumpKind = 'none';
    this.spinAngle = 0;
    this.airTime = 0;
    this.maxKmh = 0;
    this.boosting = false;
  }

  forward(out: Vector3): Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  rightVec(out: Vector3): Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
  /** Velocidad a lo largo de la trompa (m/s, negativa en reversa). */
  get forwardSpeed(): number {
    return -Math.sin(this.yaw) * this.vel.x - Math.cos(this.yaw) * this.vel.z;
  }
  get speedKmh(): number {
    return Math.hypot(this.vel.x, this.vel.z) * 3.6;
  }
  /** Caja de colisión actual. */
  get obb(): OBB {
    this.box.x = this.pos.x;
    this.box.z = this.pos.z;
    this.box.yaw = this.yaw;
    return this.box;
  }

  /* ------------------------------------------------------------------ */
  /* Saltos                                                               */
  /* ------------------------------------------------------------------ */

  /** Espacio: salto simple con los propulsores inferiores. */
  tryJump(air: AirTanks, now: number): boolean {
    if (!this.grounded) return false;
    if (!air.consume(CONFIG.air.jumpCost, now)) return false;
    this.vel.y = Math.sqrt(2 * J.gravity * J.height);
    this.grounded = false;
    this.jumpKind = 'jump';
    this.jumpClock = 0;
    this.airTime = 0;
    return true;
  }

  /**
   * Doble Espacio: convierte el salto recién iniciado en un salto con giro.
   * No hay demora de entrada: el primer toque ya saltó; el segundo (dentro de
   * la ventana `doubleTapMs`) le suma altura y arranca el giro de 360°,
   * cuya duración se calcula para terminar justo antes de aterrizar.
   */
  tryUpgradeToSpin(air: AirTanks, now: number, steer: number): boolean {
    if (this.grounded || this.jumpKind !== 'jump') return false;
    if (this.jumpClock > J.doubleTapMs / 1000 + 0.05) return false;
    if (!air.consume(CONFIG.air.spinExtraCost, now)) return false;
    const g = J.gravity;
    // Velocidad vertical para que el ápice quede en spinHeight desde la altura actual.
    const vy = Math.sqrt(2 * g * Math.max(0.5, J.spinHeight - this.pos.y));
    this.vel.y = Math.max(this.vel.y, vy);
    const tUp = this.vel.y / g;
    const apex = this.pos.y + (this.vel.y * this.vel.y) / (2 * g);
    const tDown = Math.sqrt((2 * apex) / g);
    this.jumpKind = 'spin';
    this.spinElapsed = 0;
    this.spinDuration = (tUp + tDown) * J.spinCompleteFraction;
    this.spinDir = steer < -0.2 ? -1 : 1;
    this.spinApexDone = false;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Paso de simulación                                                   */
  /* ------------------------------------------------------------------ */

  step(dt: number, input: DriveInput, air: AirTanks, statics: StaticBox[], now: number, ev: PhysicsEvents): void {
    // Propulsores traseros: requieren aire; se cortan si el tanque se vacía.
    const wantsBoost = input.boost && (this.boosting || air.canBoost());
    this.boosting = wantsBoost && air.drain(dt, now);
    if (input.boost && !this.boosting && !wantsBoost) air.failAt = now;

    this.forward(this.fwd);
    this.rightVec(this.right);
    const vf = this.fwd.x * this.vel.x + this.fwd.z * this.vel.z;
    const vl = this.right.x * this.vel.x + this.right.z * this.vel.z;

    if (this.grounded) this.stepGround(dt, input, vf, vl);
    else this.stepAir(dt, input, vf, vl, ev);

    this.pos.addScaledVector(this.vel, dt);
    if (!this.grounded && this.pos.y <= 0 && this.vel.y <= 0) this.land(ev);
    this.resolveStatics(statics, ev, dt);
    this.maxKmh = Math.max(this.maxKmh, this.speedKmh);
  }

  private stepGround(dt: number, input: DriveInput, vf: number, vl: number): void {
    const curve = this.boosting ? this.boostCurve : this.normalCurve;
    const throttle = this.boosting ? 1 : input.throttle;
    let a = 0;
    if (throttle > 0) {
      if (vf >= -0.5) {
        a += accelAt(curve, vf) * throttle;
        // Por encima del tope de la curva (p. ej. al soltar los propulsores) vuelve con arrastre.
        if (vf > curve.vmax) a -= C.rollingResistance + C.aeroDrag * vf * vf;
      } else a += C.brakeDecel * throttle;
    }
    if (input.brake > 0) {
      if (vf > 0.5) a -= C.brakeDecel * input.brake;
      else if (throttle === 0 && vf > -C.reverseMaxKmh * KMH) a -= C.reverseAccel * input.brake;
    }
    if (throttle === 0 && Math.abs(vf) > 0.05) a -= Math.sign(vf) * (C.rollingResistance + C.aeroDrag * vf * vf);
    let vfNew = vf + a * dt;
    // El freno no invierte el sentido en el mismo paso: primero se detiene.
    if (input.brake > 0 && vf > 0 && vfNew < 0) vfNew = 0;
    if (throttle === 0 && input.brake === 0 && Math.sign(vfNew) !== Math.sign(vf)) vfNew = 0;
    this.accelLong = damp(this.accelLong, (vfNew - vf) / dt, 8, dt);

    // Dirección progresiva
    const speedK = clamp(Math.abs(vf) / (C.steer.fadeSpeedKmh * KMH), 0, 1);
    const maxSteer = C.steer.maxAngleLow + (C.steer.maxAngleHigh - C.steer.maxAngleLow) * (1 - (1 - speedK) * (1 - speedK));
    const target = -input.steer * maxSteer;
    const turningIn = Math.abs(target) > Math.abs(this.steerAngle) && Math.sign(target) === Math.sign(this.steerAngle || target);
    this.steerAngle = approach(this.steerAngle, target, (turningIn ? C.steer.rate : C.steer.returnRate) * maxSteer * dt);

    // Yaw de bicicleta limitado por aceleración lateral
    let yawTarget = (vfNew * Math.tan(this.steerAngle)) / C.wheelBase;
    const maxYaw = C.maxLateralAccel / Math.max(Math.abs(vfNew), 1);
    yawTarget = clamp(yawTarget, -maxYaw, maxYaw);
    this.yawRate = damp(this.yawRate, yawTarget, C.yawResponse, dt);
    this.yaw += this.yawRate * dt;
    this.accelLatRight = damp(this.accelLatRight, -vfNew * this.yawRate, 8, dt);

    // La velocidad queda "atrás" del nuevo rumbo → aparece deslizamiento lateral.
    const vx = this.fwd.x * vfNew + this.right.x * vl;
    const vz = this.fwd.z * vfNew + this.right.z * vl;
    this.forward(this.fwd);
    this.rightVec(this.right);
    const vf2 = this.fwd.x * vx + this.fwd.z * vz;
    let vl2 = this.right.x * vx + this.right.z * vz;
    const kmh = Math.abs(vf2) * 3.6;
    const grip = C.grip.low + (C.grip.high - C.grip.low) * smoothstep(C.grip.driftStartKmh, C.grip.driftFullKmh, kmh);
    vl2 *= Math.exp(-grip * dt);
    this.vel.set(this.fwd.x * vf2 + this.right.x * vl2, 0, this.fwd.z * vf2 + this.right.z * vl2);
  }

  private stepAir(dt: number, input: DriveInput, vf: number, vl: number, ev: PhysicsEvents): void {
    this.airTime += dt;
    this.jumpClock += dt;
    this.vel.y -= J.gravity * dt;
    // Control limitado en el aire y empuje de los propulsores traseros
    this.yawRate = damp(this.yawRate, -input.steer * J.airSteer, 4, dt);
    this.yaw += this.yawRate * dt;
    let vfNew = vf;
    if (this.boosting) vfNew += accelAt(this.boostCurve, vf) * 0.8 * dt;
    vfNew -= Math.sign(vf) * C.aeroDrag * vf * vf * dt;
    this.forward(this.fwd);
    this.rightVec(this.right);
    const vy = this.vel.y;
    this.vel.set(this.fwd.x * vfNew + this.right.x * vl * 0.995, vy, this.fwd.z * vfNew + this.right.z * vl * 0.995);
    this.accelLong = damp(this.accelLong, 0, 3, dt);
    this.accelLatRight = damp(this.accelLatRight, 0, 3, dt);

    // Giro de 360° sobre el eje longitudinal, sincronizado con el vuelo.
    if (this.jumpKind === 'spin') {
      this.spinElapsed += dt;
      const p = clamp(this.spinElapsed / this.spinDuration, 0, 1);
      this.spinAngle = this.spinDir * Math.PI * 2 * easeInOutCubic(p);
      if (!this.spinApexDone && this.vel.y <= 0) {
        this.spinApexDone = true;
        ev.spinApex = true;
      }
    }
  }

  private land(ev: PhysicsEvents): void {
    ev.landed = true;
    ev.landingSpeed = -this.vel.y;
    if (this.jumpKind === 'spin') {
      ev.spinLanded = true;
      ev.spinPerfect = this.spinElapsed >= this.spinDuration * 0.97;
    }
    this.pos.y = 0;
    this.vel.y = 0;
    this.grounded = true;
    this.jumpKind = 'none';
    this.spinAngle = 0;
  }

  /** Rebote al caer sobre el techo de un vehículo. */
  bounceOn(roofY: number): void {
    this.pos.y = roofY;
    this.vel.y = CONFIG.collision.roofBounce;
    this.jumpClock = 1;
    if (this.jumpKind === 'spin') {
      // Extiende el vuelo: recalcula la duración restante del giro.
      const g = J.gravity;
      const apex = roofY + (this.vel.y * this.vel.y) / (2 * g);
      const rest = this.vel.y / g + Math.sqrt((2 * apex) / g);
      this.spinDuration = Math.max(this.spinDuration, this.spinElapsed + rest * 0.9);
    } else this.jumpKind = 'jump';
  }

  /**
   * Choques contra estáticos (canteros, isla, manzanas, Obelisco).
   * Por encima de la altura del obstáculo se pasa volando. Si al caer queda
   * encima de un cantero, se lo empuja suavemente hacia el asfalto.
   */
  private resolveStatics(statics: StaticBox[], ev: PhysicsEvents, dt: number): void {
    const me = this.obb;
    for (const b of statics) {
      aabbToObb(b.minX, b.maxX, b.minZ, b.maxZ, this.other);
      if (!obbOverlap(me, this.other, this.contact)) continue;
      const c = this.contact;
      if (this.pos.y >= b.height) {
        // En el aire sobre un obstáculo bajo: empujón lateral para no caer encima.
        if (!this.grounded && b.kind === 'curb') {
          this.vel.x += c.nx * 26 * dt;
          this.vel.z += c.nz * 26 * dt;
        }
        continue;
      }
      this.pos.x += c.nx * c.depth;
      this.pos.z += c.nz * c.depth;
      me.x = this.pos.x;
      me.z = this.pos.z;
      const vn = this.vel.x * c.nx + this.vel.z * c.nz;
      if (vn < 0) {
        const impact = -vn;
        // Rebote leve + roce tangencial
        this.vel.x -= c.nx * vn * 1.25;
        this.vel.z -= c.nz * vn * 1.25;
        const fr = 1 - Math.min(0.35, impact * 0.02);
        this.vel.x *= fr;
        this.vel.z *= fr;
        // Alinear el auto con el muro (raspón)
        const along = Math.atan2(-this.vel.x, -this.vel.z);
        if (Math.hypot(this.vel.x, this.vel.z) > 3) {
          let d = along - this.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          if (Math.abs(d) < Math.PI / 2) this.yaw += d * 0.35;
        }
        if (impact > ev.wallImpact) {
          ev.wallImpact = impact;
          ev.wallKind = b.kind;
          ev.wallNormal.set(c.nx, 0, c.nz);
        }
      }
    }
  }
}

export function makeEvents(): PhysicsEvents {
  return { landed: false, landingSpeed: 0, spinLanded: false, spinPerfect: false, wallImpact: 0, wallKind: null, wallNormal: new Vector3(), spinApex: false };
}

export function clearEvents(ev: PhysicsEvents): void {
  ev.landed = false;
  ev.landingSpeed = 0;
  ev.spinLanded = false;
  ev.spinPerfect = false;
  ev.wallImpact = 0;
  ev.wallKind = null;
  ev.spinApex = false;
}
