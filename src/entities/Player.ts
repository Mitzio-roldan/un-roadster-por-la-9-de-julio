import {
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SpotLight,
  Vector3,
  type Scene,
} from 'three';
import { CONFIG } from '../config';
import { clamp, damp, smoothstep } from '../core/math';
import { patchMaterial } from '../core/shaderPatch';
import { AirTanks } from '../physics/AirTanks';
import { VehiclePhysics, type DriveInput } from '../physics/VehiclePhysics';
import type { Particles } from '../fx/Particles';
import { buildCar, makeJetCone, WHEEL, WING_BASE_Y, type CarParts } from './CarModel';
import { makeRadialTexture } from '../world/textures';

const CYAN = new Color(0.5, 2.6, 3.2);
const CYAN_SOFT = new Color(0.25, 1.1, 1.5);
const WHITE_HOT = new Color(2.2, 2.6, 2.8);
const DUST = new Color('#b8a58c');
const SMOKE = new Color('#cfcac2');

/**
 * El auto del jugador: conecta la física con el modelo visual (suspensión,
 * rolido, ruedas, alerón activo, luces), los chorros de los propulsores y la
 * emisión de partículas.
 */
export class Player {
  readonly physics = new VehiclePhysics();
  readonly air = new AirTanks();
  readonly parts: CarParts;
  readonly root: Object3D;
  private readonly rearJets: Mesh[] = [];
  private readonly downJets: Mesh[] = [];
  private readonly shadow: Mesh;
  readonly headlight: SpotLight;
  /** Intensidad visual 0..1 (suavizada) de propulsores. */
  boostVis = 0;
  private jumpJetT = 0;
  private suspY = 0;
  private suspV = 0;
  private pitch = 0;
  private roll = 0;
  private wingLift = 0;
  private wingAngle = 0;
  private wheelRot = 0;
  /** Inclinación extra por choque (s). */
  private wobble = 0;
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();

  constructor(
    scene: Scene,
    private readonly fxAdd: Particles,
    private readonly fxAlpha: Particles,
    physicalPaint: boolean,
  ) {
    this.parts = buildCar(physicalPaint);
    this.root = this.parts.root;
    scene.add(this.root);

    for (const [x, y, z] of this.parts.nozzles) {
      const cone = makeJetCone(new Color(0.35, 1.8, 2.4), 2.4, 0.1);
      cone.position.set(x, y, z);
      cone.rotation.x = -Math.PI / 2;
      this.parts.spin.add(cone);
      this.rearJets.push(cone);
      const core = makeJetCone(new Color(1.6, 2.2, 2.4), 1.1, 0.045);
      core.position.set(x, y, z);
      core.rotation.x = -Math.PI / 2;
      this.parts.spin.add(core);
      this.rearJets.push(core);
    }
    for (const [x, y, z] of this.parts.jetPoints) {
      const cone = makeJetCone(new Color(0.5, 1.6, 2.0), 1.5, 0.2);
      cone.position.set(x, y, z);
      this.parts.spin.add(cone);
      this.downJets.push(cone);
    }

    // Sombra de contacto (siempre, incluso sin shadow maps en calidad baja)
    const sm = new MeshBasicMaterial({ map: makeRadialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    patchMaterial(sm, 'atm');
    this.shadow = new Mesh(new PlaneGeometry(2.9, 5.6).rotateX(-Math.PI / 2), sm);
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);

    // Faros (solo de noche tienen intensidad; siempre presentes para no recompilar shaders)
    this.headlight = new SpotLight(0xdff4ff, 0, 90, 0.42, 0.5, 1.2);
    this.headlight.position.set(0, 0.7, -2.0);
    this.headlight.target.position.set(0, 0, -30);
    this.headlight.visible = false;
    this.root.add(this.headlight);
    this.root.add(this.headlight.target);
  }

  reset(x: number, z: number, yaw = 0): void {
    this.physics.reset(x, z, yaw);
    this.air.reset();
    this.suspY = this.suspV = this.pitch = this.roll = 0;
    this.boostVis = 0;
    this.wobble = 0;
    this.sync();
  }

  setNight(night: boolean): void {
    // Solo existe de noche: una luz extra encarece cada píxel iluminado.
    this.headlight.intensity = night ? 900 : 0;
    this.headlight.visible = night;
  }

  /** Disparar el chorro inferior visual + polvo (al saltar). */
  onJump(spin: boolean): void {
    this.jumpJetT = CONFIG.jump.jetTime * (spin ? 1.4 : 1);
    const p = this.physics.pos;
    for (let i = 0; i < (spin ? 50 : 30); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 7;
      this.fxAlpha.emit(p.x + Math.cos(a) * 1.2, 0.15, p.z + Math.sin(a) * 2, Math.cos(a) * s + this.physics.vel.x * 0.3, 0.6 + Math.random(), Math.sin(a) * s + this.physics.vel.z * 0.3, 0.9 + Math.random() * 0.6, 1.2, 4.5, SMOKE, 0.5, 2.2, -0.4);
    }
    this.suspV -= 2.5;
  }

  /** Polvo y rebote de suspensión al aterrizar. */
  onLand(speed: number, spin: boolean): void {
    const p = this.physics.pos;
    const n = Math.min(70, 20 + speed * 3 + (spin ? 30 : 0));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = 5 + Math.random() * 6 + speed * 0.4;
      this.fxAlpha.emit(p.x + Math.cos(a) * 1.3, 0.12, p.z + Math.sin(a) * 2.4, Math.cos(a) * s + this.physics.vel.x * 0.55, 0.4 + Math.random() * 1.2, Math.sin(a) * s + this.physics.vel.z * 0.55, 0.8 + Math.random() * 0.7, 1.0, 5 + speed * 0.12, DUST, 0.55, 2.4, -0.3);
    }
    this.suspV -= Math.min(6, speed * 0.32);
  }

  /** Chispas en un punto (choques / roces). */
  sparks(x: number, y: number, z: number, nx: number, nz: number, amount: number): void {
    const v = this.physics.vel;
    for (let i = 0; i < amount; i++) {
      const s = 4 + Math.random() * 14;
      const c = Math.random() < 0.5 ? new Color(4, 2.2, 0.6) : new Color(3, 1.2, 0.3);
      this.fxAdd.emit(
        x,
        y,
        z,
        v.x * 0.6 + nx * s + (Math.random() - 0.5) * 8,
        2 + Math.random() * 6,
        v.z * 0.6 + nz * s + (Math.random() - 0.5) * 8,
        0.35 + Math.random() * 0.45,
        0.09,
        0.02,
        c,
        1,
        1.5,
        16,
      );
    }
    this.wobble = Math.min(1, this.wobble + amount / 40);
  }

  update(dt: number, input: DriveInput, alive: boolean): void {
    const ph = this.physics;
    const kmh = ph.speedKmh;
    this.boostVis = damp(this.boostVis, ph.boosting ? 1 : 0, ph.boosting ? 14 : 6, dt);
    this.jumpJetT = Math.max(0, this.jumpJetT - dt);

    // Suspensión visual (resorte amortiguado) + cabeceo/rolido por aceleraciones
    const k = 140;
    const c = 14;
    this.suspV += (-k * this.suspY - c * this.suspV) * dt;
    this.suspY += this.suspV * dt;
    this.suspY = clamp(this.suspY, -0.12, 0.12);
    const pitchT = ph.grounded ? clamp(ph.accelLong * 0.0042, -0.06, 0.05) : clamp(ph.vel.y * -0.012, -0.12, 0.12);
    const rollT = ph.grounded ? clamp(ph.accelLatRight * 0.006, -0.07, 0.07) : 0;
    this.pitch = damp(this.pitch, pitchT, 7, dt);
    this.roll = damp(this.roll, rollT, 7, dt);
    this.wobble = Math.max(0, this.wobble - dt * 2);

    // Alerón activo: sube con la velocidad; al frenar fuerte hace de freno aerodinámico
    const W = CONFIG.car.wing;
    const wk = smoothstep(W.startKmh, W.fullKmh, kmh);
    const airBrake = input.brake > 0 && kmh > 120 && ph.grounded ? 1 : 0;
    this.wingLift = damp(this.wingLift, Math.max(wk, airBrake) * W.maxLift, 4, dt);
    this.wingAngle = damp(this.wingAngle, airBrake ? W.airBrakeAngle : wk * W.maxAngle, 6, dt);

    // Ruedas
    this.wheelRot += (ph.forwardSpeed / WHEEL.radius) * dt;

    // Luces de freno
    const braking = input.brake > 0 && ph.forwardSpeed > 0.5;
    this.parts.brakeMat.color.setRGB(braking ? 7 : 1.1, braking ? 0.25 : 0.05, braking ? 0.3 : 0.08);

    this.sync();
    if (alive) this.emit(dt);
  }

  /** Copia el estado de la física al modelo 3D. */
  private sync(): void {
    const ph = this.physics;
    const P = this.parts;
    P.root.position.copy(ph.pos);
    P.root.rotation.set(0, ph.yaw, 0);
    P.spin.rotation.z = ph.spinAngle;
    const wob = Math.sin(performance.now() * 0.05) * this.wobble * 0.05;
    P.body.position.y = -0.55 + this.suspY;
    P.body.rotation.set(this.pitch, 0, this.roll + wob);
    for (const w of P.wheels) {
      w.spin.rotation.x = -this.wheelRot;
      w.pivot.rotation.y = w.front ? ph.steerAngle * 1.6 : 0;
    }
    P.wing.position.y = WING_BASE_Y + this.wingLift;
    // Los soportes siguen anclados al auto: su base queda fija y la punta sube con la hoja
    P.wingStruts.position.y = -0.1 - this.wingLift;
    P.wingStruts.scale.y = 0.12 + this.wingLift;
    P.wingBlade.rotation.x = this.wingAngle;
    for (const g of P.nozzleGlow) (g.material as MeshBasicMaterial).opacity = Math.max(this.boostVis, this.jumpJetT > 0 ? 0.6 : 0);

    // Chorros: largo/titileo según intensidad
    const flick = 0.85 + Math.random() * 0.3;
    for (let i = 0; i < this.rearJets.length; i++) {
      const j = this.rearJets[i];
      const b = this.boostVis;
      j.scale.set(1 + b * 0.25, b * flick * (i % 2 ? 1.2 : 1), 1 + b * 0.25);
      (j.material as MeshBasicMaterial).opacity = b * 0.9;
      j.visible = b > 0.02;
    }
    const jj = this.jumpJetT / CONFIG.jump.jetTime;
    for (const j of this.downJets) {
      j.scale.set(1, Math.min(1.4, jj) * flick, 1);
      (j.material as MeshBasicMaterial).opacity = Math.min(1, jj);
      j.visible = jj > 0.02;
    }

    // Sombra de contacto: se achica y aclara con la altura
    const h = ph.pos.y;
    this.shadow.position.set(ph.pos.x, 0.03, ph.pos.z);
    this.shadow.rotation.y = ph.yaw;
    const s = 1 + h * 0.08;
    this.shadow.scale.set(s, 1, s);
    (this.shadow.material as MeshBasicMaterial).opacity = clamp(1 - h / 10, 0.15, 1);
  }

  private emit(dt: number): void {
    const ph = this.physics;
    const P = this.parts;
    P.root.updateMatrixWorld();
    const v = ph.vel;
    const fwd = ph.forward(this.tmp2);

    // Propulsores traseros: corriente de partículas hacia atrás
    if (this.boostVis > 0.1) {
      const n = Math.ceil((180 / P.nozzles.length) * dt * this.boostVis * 4);
      for (const [x, y, z] of P.nozzles) {
        for (let i = 0; i < n; i++) {
          this.tmp.set(x, y, z + 0.2);
          P.spin.localToWorld(this.tmp);
          const sp = 20 + Math.random() * 18;
          const c = Math.random() < 0.35 ? WHITE_HOT : CYAN;
          this.fxAdd.emit(
            this.tmp.x,
            this.tmp.y,
            this.tmp.z,
            v.x - fwd.x * sp + (Math.random() - 0.5) * 2.5,
            v.y + (Math.random() - 0.5) * 2,
            v.z - fwd.z * sp + (Math.random() - 0.5) * 2.5,
            0.18 + Math.random() * 0.22,
            0.32,
            0.9,
            c,
            0.55,
            3.5,
            0,
          );
        }
      }
    }
    // Chorros inferiores del salto
    if (this.jumpJetT > 0) {
      for (const [x, y, z] of P.jetPoints) {
        for (let i = 0; i < 3; i++) {
          this.tmp.set(x, y, z);
          P.spin.localToWorld(this.tmp);
          this.fxAdd.emit(this.tmp.x, this.tmp.y, this.tmp.z, v.x * 0.9 + (Math.random() - 0.5) * 3, -14 - Math.random() * 8, v.z * 0.9 + (Math.random() - 0.5) * 3, 0.25, 0.4, 1.4, CYAN_SOFT, 0.6, 2, 0);
        }
      }
    }
    // Estela de partículas durante el salto con giro
    if (ph.jumpKind === 'spin') {
      for (const [x, y, z] of P.trailPoints) {
        this.tmp.set(x, y, z);
        P.spin.localToWorld(this.tmp);
        for (let i = 0; i < 3; i++) this.fxAdd.emit(this.tmp.x, this.tmp.y, this.tmp.z, v.x * 0.92, v.y * 0.5, v.z * 0.92, 0.5, 0.35, 0.05, CYAN, 0.9, 0.5, 0);
      }
    }
    // Humo de neumáticos derrapando fuerte
    const lat = Math.abs(ph.vel.x * Math.cos(ph.yaw) - ph.vel.z * Math.sin(ph.yaw));
    if (ph.grounded && lat > 4 && ph.speedKmh > 40) {
      for (const w of P.wheels) {
        if (w.front || Math.random() > lat * 0.03) continue;
        w.pivot.getWorldPosition(this.tmp);
        this.fxAlpha.emit(this.tmp.x, 0.2, this.tmp.z, v.x * 0.4, 0.8, v.z * 0.4, 1.2, 0.6, 3.2, SMOKE, 0.25, 1.5, -0.2);
      }
    }
  }

  /** Para el modelo GLB opcional: reemplaza la carrocería procedural. */
  replaceBody(obj: Object3D): void {
    const P = this.parts;
    P.body.clear();
    P.body.add(obj);
  }
}

