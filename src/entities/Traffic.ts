import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import { CONFIG } from '../config';
import { clamp, smoothstep } from '../core/math';
import { Rng } from '../core/rng';
import { patchMaterial, replaceChunk } from '../core/shaderPatch';
import { obbOverlap, type Contact, type OBB } from '../physics/collision';
import type { VehiclePhysics } from '../physics/VehiclePhysics';
import type { Score } from '../game/Score';
import {
  BLOCK,
  LANES,
  chunkIndexAt,
  chunkInfo,
  crossLanes,
  crossStopLineX,
  lightState,
  neighborLane,
  stopLineZ,
  type Lane,
  type LightColor,
  type LightState,
} from '../world/layout';
import { makeAtlasMaterial, signUniforms } from '../world/atlasMaterial';
import { BUS_LINES, makeBusSignAtlas } from '../world/textures';
import { buildVehicleModels, type VehicleModel, type VehicleType } from './TrafficModels';

const T = CONFIG.traffic;
const IDM = T.idm;

const CAR_COLORS = ['#e8e8e8', '#c9ccd1', '#2b2f36', '#7a828c', '#9e1b25', '#1f3f73', '#d9d4c7', '#3d5a40', '#5b4636', '#b8b8b0', '#14161a', '#8a96a3'];
const BUS_LIVERIES: [string, string][] = [
  ['#d93a2b', '#f2e6c9'],
  ['#1f5fae', '#ffffff'],
  ['#f2c230', '#1f7a4d'],
  ['#2a9d8f', '#f4f1de'],
  ['#e76f51', '#264653'],
  ['#6a4c93', '#f1c40f'],
  ['#ffffff', '#c0392b'],
  ['#1b998b', '#ff6f59'],
  ['#3a86ff', '#ffbe0b'],
  ['#8d99ae', '#ef233c'],
];
const DELIVERY = ['#ff4d2e', '#ffcc00', '#e01e5a', '#00b386', '#ff7a00'];
const SPEEDS: Record<VehicleType, [number, number]> = {
  car: [13, 17],
  taxi: [14, 18],
  bus: [11, 14],
  moto: [15, 20],
  van: [12, 15],
};

interface Vehicle {
  active: boolean;
  type: VehicleType;
  slot: number;
  cross: boolean;
  lane: Lane | null;
  fromLane: Lane | null;
  laneT: number;
  laneCooldown: number;
  blinkTimer: number;
  blinkDir: number;
  /** Cruce (índice de chunk) y sentido para tránsito transversal. */
  chunk: number;
  crossDir: number;
  crossZ: number;
  x: number;
  z: number;
  yaw: number;
  dirX: number;
  dirZ: number;
  speed: number;
  desired: number;
  accel: number;
  committed: boolean;
  hx: number;
  hz: number;
  h: number;
  color: Color;
  color2: Color;
  sign: number;
  // Casi-choques
  overlapping: boolean;
  minGap: number;
  wasOver: boolean;
  hitPlayer: boolean;
  phase: number;
}

/** Instancias de un tipo de vehículo: varias partes que comparten matriz. */
class TypeBatch {
  readonly meshes: InstancedMesh[] = [];
  private readonly paint: InstancedMesh;
  private readonly paint2: InstancedMesh | null;
  private readonly lightState: InstancedBufferAttribute;
  private readonly signTile: InstancedBufferAttribute | null;
  readonly free: number[] = [];
  private readonly zero = new Matrix4().makeScale(0, 0, 0);

  constructor(model: VehicleModel, readonly capacity: number, mats: { paint: Material; detail: Material; lights: Material; sign: Material | null }) {
    const mk = (g: BufferGeometry, m: Material, shadow: boolean) => {
      const im = new InstancedMesh(g, m, capacity);
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = shadow;
      im.receiveShadow = true;
      for (let i = 0; i < capacity; i++) im.setMatrixAt(i, this.zero);
      this.meshes.push(im);
      return im;
    };
    this.paint = mk(model.paint, mats.paint, true);
    this.paint.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.paint2 = model.paint2 ? mk(model.paint2, mats.paint, true) : null;
    if (this.paint2) this.paint2.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    mk(model.detail, mats.detail, true);
    this.lightState = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    model.lights.setAttribute('aLightState', this.lightState);
    mk(model.lights, mats.lights, false);
    this.signTile = null;
    if (model.sign && mats.sign) {
      this.signTile = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
      model.sign.setAttribute('aTile', this.signTile);
      mk(model.sign, mats.sign, false);
    }
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
  }

  write(i: number, m: Matrix4, v: Vehicle, brake: number, blinkL: number, blinkR: number): void {
    for (const im of this.meshes) im.setMatrixAt(i, m);
    this.paint.instanceColor!.setXYZ(i, v.color.r, v.color.g, v.color.b);
    this.paint2?.instanceColor!.setXYZ(i, v.color2.r, v.color2.g, v.color2.b);
    this.lightState.setXYZW(i, brake, blinkL, blinkR, v.phase);
    this.signTile?.setX(i, v.sign);
  }

  hide(i: number): void {
    for (const im of this.meshes) im.setMatrixAt(i, this.zero);
  }

  /** `count` = último slot usado + 1: no se procesan instancias ocultas. */
  flush(count: number): void {
    for (const im of this.meshes) {
      im.count = count;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.lightState.needsUpdate = true;
    if (this.signTile) this.signTile.needsUpdate = true;
  }
}

export interface VehicleHit {
  impact: number;
  crash: boolean;
  roof: boolean;
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
}

export interface NearMiss {
  over: boolean;
  type: VehicleType;
}

export interface HornEvent {
  type: VehicleType;
  distance: number;
}

/** Uniforms de luces de vehículos. */
const lightUniforms = { uNight: { value: 0 } };

/**
 * Tránsito con IA simple y creíble:
 * - Intelligent Driver Model: mantiene distancia y frena suave (luces de freno).
 * - Respeta semáforos (frena en amarillo si puede detenerse cómodo).
 * - Cambia de carril poniendo el guiño antes, si hay hueco.
 * - Tránsito transversal que cruza cuando la avenida está en rojo.
 * - La densidad crece con la distancia recorrida.
 */
export class Traffic {
  private readonly batches: Record<VehicleType, TypeBatch>;
  private readonly models: Record<VehicleType, VehicleModel>;
  private readonly vehicles: Vehicle[] = [];
  private readonly rng = new Rng(1234);
  private readonly crossTimers = new Map<number, number>();
  private readonly nearMisses: NearMiss[] = [];
  private readonly horns: HornEvent[] = [];
  private readonly ls: LightState = { avenue: 'green', cross: 'red', avenueRemaining: 0, crossRemaining: 0 };
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly up = new Vector3(0, 1, 0);
  private readonly obbA: OBB = { x: 0, z: 0, hx: 0, hz: 0, yaw: 0 };
  private readonly contact: Contact = { nx: 0, nz: 0, depth: 0 };
  private time = 0;
  private travelDir = -1;

  constructor(scene: Scene) {
    this.models = buildVehicleModels();
    const paintMat = patchMaterial(new MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.38 }), 'atm');
    const detailMat = patchMaterial(new MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.45 }), 'atm');
    const lightMat = new MeshBasicMaterial({ color: 0xffffff });
    patchMaterial(lightMat, 'veh-lights', (s) => {
      s.uniforms.uTime = signUniforms.uTime;
      s.uniforms.uNight = lightUniforms.uNight;
      s.vertexShader = replaceChunk(
        s.vertexShader,
        '#include <common>',
        `#include <common>
attribute float aLightType;
attribute vec4 aLightState;
uniform float uTime;
uniform float uNight;
varying vec3 vLight;`,
      );
      s.vertexShader = replaceChunk(
        s.vertexShader,
        '#include <begin_vertex>',
        `#include <begin_vertex>
  float blink = step(0.5, fract(uTime * 1.5 + aLightState.w));
  vec3 amber = vec3(5.0, 2.2, 0.2);
  if (aLightType < 0.5) vLight = vec3(1.0, 0.95, 0.85) * mix(0.9, 4.0, uNight);
  else if (aLightType < 1.5) vLight = vec3(0.55, 0.02, 0.02) * (1.0 + uNight) + aLightState.x * vec3(5.0, 0.2, 0.15);
  else if (aLightType < 2.5) vLight = mix(vec3(0.12, 0.06, 0.0), amber, aLightState.y * blink);
  else if (aLightType < 3.5) vLight = mix(vec3(0.12, 0.06, 0.0), amber, aLightState.z * blink);
  else vLight = vec3(2.2, 1.8, 0.4) * (0.6 + uNight);`,
      );
      s.fragmentShader = replaceChunk(s.fragmentShader, '#include <common>', '#include <common>\nvarying vec3 vLight;');
      s.fragmentShader = replaceChunk(s.fragmentShader, '#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = vLight;');
    });
    const signMat = makeAtlasMaterial(makeBusSignAtlas(), { key: 'bus-sign' });
    const cap = T.capacity;
    const types: VehicleType[] = ['car', 'taxi', 'bus', 'moto', 'van'];
    this.batches = {} as Record<VehicleType, TypeBatch>;
    for (const t of types) {
      const b = new TypeBatch(this.models[t], cap[t], { paint: paintMat, detail: detailMat, lights: lightMat, sign: t === 'bus' ? signMat : null });
      this.batches[t] = b;
      for (const im of b.meshes) {
        im.name = `traffic-${t}`;
        scene.add(im);
      }
    }
  }

  setNight(night: boolean): void {
    lightUniforms.uNight.value = night ? 1 : 0;
  }

  reset(): void {
    for (const v of this.vehicles) if (v.active) this.release(v);
    this.vehicles.length = 0;
    this.crossTimers.clear();
    this.nearMisses.length = 0;
    this.horns.length = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Alta / baja                                                          */
  /* ------------------------------------------------------------------ */

  private acquire(type: VehicleType): Vehicle | null {
    const b = this.batches[type];
    const slot = b.free.pop();
    if (slot === undefined) return null;
    const m = this.models[type];
    const r = this.rng;
    let v = this.vehicles.find((x) => !x.active);
    if (!v) {
      v = {} as Vehicle;
      this.vehicles.push(v);
    }
    const [s0, s1] = SPEEDS[type];
    Object.assign(v, {
      active: true,
      type,
      slot,
      cross: false,
      lane: null,
      fromLane: null,
      laneT: 1,
      laneCooldown: r.range(2, T.laneChange.minInterval),
      blinkTimer: 0,
      blinkDir: 0,
      chunk: 0,
      crossDir: 1,
      crossZ: 0,
      x: 0,
      z: 0,
      yaw: 0,
      dirX: 0,
      dirZ: -1,
      speed: 0,
      desired: r.range(s0, s1),
      accel: 0,
      committed: false,
      hx: m.hx,
      hz: m.hz,
      h: m.h,
      color: v.color ?? new Color(),
      color2: v.color2 ?? new Color(),
      sign: r.int(0, BUS_LINES.length - 1),
      overlapping: false,
      minGap: 99,
      wasOver: false,
      hitPlayer: false,
      phase: r.next(),
    });
    switch (type) {
      case 'taxi':
        v.color.set('#121212');
        v.color2.set('#f2c200');
        break;
      case 'bus': {
        const [a, b2] = r.pick(BUS_LIVERIES);
        v.color.set(a);
        v.color2.set(b2);
        break;
      }
      case 'moto':
        v.color.set(r.pick(DELIVERY));
        break;
      default:
        v.color.set(r.pick(CAR_COLORS));
        v.color2.copy(v.color);
    }
    return v;
  }

  private release(v: Vehicle): void {
    v.active = false;
    const b = this.batches[v.type];
    b.hide(v.slot);
    b.free.push(v.slot);
  }

  private pickType(lane: Lane | null): VehicleType {
    if (lane?.kind === 'bus') return 'bus';
    const t = this.rng.weighted(T.mix);
    if (lane?.kind === 'lateral' && t === 'bus') return 'car';
    return t;
  }

  private density(distance: number): number {
    return T.densityStart + (T.densityMax - T.densityStart) * smoothstep(0, T.densityRampMeters, distance);
  }

  private laneWeight(l: Lane): number {
    return l.kind === 'main' ? 1 : l.kind === 'lateral' ? 0.6 : 0.35;
  }

  private laneFree(lane: Lane, z: number, gap: number): boolean {
    for (const o of this.vehicles) {
      if (!o.active || o.cross) continue;
      const ol = o.lane;
      if ((ol === lane || o.fromLane === lane) && Math.abs(o.z - z) < gap + o.hz) return false;
    }
    return true;
  }

  private spawnAvenue(lane: Lane, z: number, speedK = 0.85): boolean {
    if (!this.laneFree(lane, z, 22)) return false;
    const v = this.acquire(this.pickType(lane));
    if (!v) return false;
    v.lane = lane;
    v.fromLane = lane;
    v.x = lane.x;
    v.z = z;
    v.dirX = 0;
    v.dirZ = lane.dir;
    v.yaw = lane.dir === -1 ? 0 : Math.PI;
    v.speed = v.desired * speedK;
    return true;
  }

  private spawnCross(chunk: number, x?: number): boolean {
    const info = chunkInfo(chunk);
    const lanes = crossLanes(info);
    const lz = this.rng.pick(lanes);
    const startX = x ?? -info.crossDir * T.cross.spawnX;
    for (const o of this.vehicles) if (o.active && o.cross && o.chunk === chunk && Math.abs(o.crossZ - lz) < 0.5 && Math.abs(o.x - startX) < 14) return false;
    const t = this.rng.weighted({ car: 0.45, taxi: 0.3, bus: 0.12, moto: 0.13 });
    const v = this.acquire(t);
    if (!v) return false;
    v.cross = true;
    v.chunk = chunk;
    v.crossDir = info.crossDir;
    v.crossZ = lz;
    v.x = startX;
    v.z = lz;
    v.dirX = info.crossDir;
    v.dirZ = 0;
    v.yaw = info.crossDir === 1 ? -Math.PI / 2 : Math.PI / 2;
    v.desired *= 0.85;
    v.speed = v.desired * 0.7;
    return true;
  }

  /** Población inicial alrededor del jugador (al empezar o reiniciar). */
  populate(z: number, distance: number): void {
    const d = this.density(distance);
    for (const lane of LANES) {
      const n = Math.round((d * this.laneWeight(lane) * (T.spawnAheadMax + 120)) / 1000);
      for (let i = 0; i < n; i++) {
        const zz = z - this.rng.range(-120, T.spawnAheadMax);
        // Dejar libre el arranque del jugador
        if (Math.abs(zz - z) < 45 && lane.kind === 'main' && lane.dir === -1) continue;
        this.spawnAvenue(lane, zz, this.rng.range(0.6, 1));
      }
    }
    const c = chunkIndexAt(z);
    for (let k = c - 1; k <= c + 6; k++) {
      const info = chunkInfo(k);
      for (let i = 0; i < 3; i++) this.spawnCross(k, -info.crossDir * this.rng.range(70, T.cross.spawnX));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Actualización                                                        */
  /* ------------------------------------------------------------------ */

  update(dt: number, time: number, player: VehiclePhysics, distance: number, _night: boolean): void {
    this.time = time;
    if (dt <= 0) {
      this.writeInstances();
      return;
    }
    const pz = player.pos.z;
    this.travelDir = Math.cos(player.yaw) > -0.2 ? -1 : 1;
    const ahead = this.travelDir;

    // Bajas
    for (const v of this.vehicles) {
      if (!v.active) continue;
      if (v.cross) {
        const out = Math.abs(v.x) > T.cross.spawnX + 5 && Math.sign(v.x) === v.crossDir;
        const rel = (v.z - pz) * ahead;
        if (out || rel < -T.cross.activeBehind - 40 || rel > T.cross.activeAhead + 200) this.release(v);
      } else {
        const rel = (v.z - pz) * ahead;
        if (rel < -T.despawnBehind || rel > T.despawnAhead) this.release(v);
      }
    }

    // Altas en la avenida (bajo la niebla, lejos adelante)
    const d = this.density(distance);
    let avenueCount = 0;
    for (const v of this.vehicles) if (v.active && !v.cross) avenueCount++;
    const windowKm = (T.spawnAheadMax + T.despawnBehind) / 1000;
    let target = 0;
    for (const l of LANES) target += d * this.laneWeight(l) * windowKm;
    target = Math.min(target, 150);
    for (let tries = 0; tries < 3 && avenueCount < target; tries++) {
      const lane = this.rng.pick(LANES);
      if (this.rng.next() > this.laneWeight(lane)) continue;
      const zz = pz + ahead * this.rng.range(T.spawnAheadMin, T.spawnAheadMax);
      if (this.spawnAvenue(lane, zz)) avenueCount++;
    }
    // Si el jugador va lento, también aparecen autos desde atrás en su sentido
    if (player.speedKmh < 30 && avenueCount < target && this.rng.chance(dt * 0.6)) {
      const lane = this.rng.pick(LANES.filter((l) => l.dir === this.travelDir && l.kind !== 'bus'));
      this.spawnAvenue(lane, pz - ahead * 150);
    }

    // Tránsito transversal en los cruces cercanos
    const c = chunkIndexAt(pz);
    const k0 = ahead < 0 ? c - 1 : c - 6;
    const k1 = ahead < 0 ? c + 6 : c + 1;
    for (let k = k0; k <= k1; k++) {
      const next = this.crossTimers.get(k);
      if (next === undefined) {
        this.crossTimers.set(k, time + this.rng.range(0, T.cross.intervalMax));
        continue;
      }
      if (time >= next) {
        this.spawnCross(k);
        const f = d / T.densityStart;
        this.crossTimers.set(k, time + this.rng.range(T.cross.intervalMin, T.cross.intervalMax) / Math.sqrt(f));
      }
    }
    for (const k of this.crossTimers.keys()) if (k < k0 - 2 || k > k1 + 2) this.crossTimers.delete(k);

    // IA
    for (const v of this.vehicles) if (v.active) this.drive(v, dt, player);
    this.writeInstances();

    // Bocinas ocasionales de colectivos y taxis cercanos
    if (this.rng.chance(T.hornChancePerSec * dt * 3)) {
      const cand = this.vehicles.filter((v) => v.active && (v.type === 'bus' || v.type === 'taxi') && Math.hypot(v.x - player.pos.x, v.z - pz) < 120);
      if (cand.length) {
        const v = this.rng.pick(cand);
        this.horns.push({ type: v.type, distance: Math.hypot(v.x - player.pos.x, v.z - pz) });
      }
    }
  }

  /** Conducción de un vehículo: IDM + semáforos + cambios de carril. */
  private drive(v: Vehicle, dt: number, player: VehiclePhysics): void {
    // Líder (vehículo, jugador u obstáculo transversal) delante
    let gap = 1e4;
    let leadSpeed = v.desired;
    const scan = (ox: number, oz: number, ohxW: number, ohzW: number, ovx: number, ovz: number) => {
      const dx = ox - v.x;
      const dz = oz - v.z;
      const along = dx * v.dirX + dz * v.dirZ;
      if (along <= 0 || along > 90) return;
      const lat = Math.abs(dx * v.dirZ - dz * v.dirX);
      const oAlong = Math.abs(v.dirX) * ohxW + Math.abs(v.dirZ) * ohzW;
      const oLat = Math.abs(v.dirZ) * ohxW + Math.abs(v.dirX) * ohzW;
      if (lat > v.hx + oLat + 0.35) return;
      const g = along - v.hz - oAlong;
      if (g < gap) {
        gap = g;
        leadSpeed = ovx * v.dirX + ovz * v.dirZ;
      }
    };
    for (const o of this.vehicles) {
      if (!o.active || o === v) continue;
      if (Math.abs(o.z - v.z) > 95 || Math.abs(o.x - v.x) > 95) continue;
      const hxW = o.cross ? o.hz : o.hx;
      const hzW = o.cross ? o.hx : o.hz;
      scan(o.x, o.z, hxW, hzW, o.dirX * o.speed, o.dirZ * o.speed);
    }
    if (player.pos.y < 2.5) scan(player.pos.x, player.pos.z, 1.4, 2.4, player.vel.x, player.vel.z);

    // Semáforo
    let mustStop = false;
    let stopGap = 1e4;
    if (v.cross) {
      const info = chunkInfo(v.chunk);
      lightState(info, this.time, this.ls);
      const front = v.x + v.dirX * v.hz;
      const dist = (crossStopLineX(info) - front) * v.dirX;
      if (dist > -0.5) {
        const col: LightColor = this.ls.cross === 'green' && this.ls.crossRemaining < 5 ? 'yellow' : this.ls.cross;
        mustStop = this.shouldStop(v, col, dist);
        stopGap = dist - 0.6;
      } else v.committed = false;
    } else if (v.lane) {
      const dir = v.lane.dir;
      const front = v.z + dir * v.hz;
      const c = chunkIndexAt(v.z);
      // Primer cruce con línea de detención todavía adelante
      for (const k of dir === -1 ? [c, c + 1] : [c, c - 1]) {
        const info = chunkInfo(k);
        const sz = stopLineZ(info, dir);
        const dist = (sz - front) * dir;
        if (dist > -0.5) {
          lightState(info, this.time, this.ls);
          mustStop = this.shouldStop(v, this.ls.avenue, dist);
          stopGap = dist - 0.6;
          break;
        }
      }
    }
    if (mustStop && stopGap < gap) {
      gap = stopGap;
      leadSpeed = 0;
    }

    // Intelligent Driver Model
    const s = Math.max(gap, 0.1);
    const dv = v.speed - leadSpeed;
    const sStar = IDM.s0 + Math.max(0, v.speed * IDM.T + (v.speed * dv) / (2 * Math.sqrt(IDM.a * IDM.b)));
    let a = IDM.a * (1 - Math.pow(v.speed / v.desired, 4) - (gap < 1e3 ? (sStar / s) * (sStar / s) : 0));
    a = clamp(a, -IDM.maxBrake, IDM.a);
    v.accel = a;
    v.speed = Math.max(0, v.speed + a * dt);

    if (v.cross) {
      v.x += v.dirX * v.speed * dt;
    } else {
      this.laneChange(v, dt, gap, leadSpeed, player);
      v.z += v.dirZ * v.speed * dt;
    }
  }

  private shouldStop(v: Vehicle, color: LightColor, dist: number): boolean {
    if (color === 'green') {
      v.committed = false;
      return false;
    }
    if (color === 'red') return !v.committed || dist > 2;
    // Amarillo: frena si puede detenerse con comodidad; si no, sigue.
    if (v.committed) return false;
    const comfortable = (v.speed * v.speed) / (2 * IDM.b);
    if (dist > comfortable) return true;
    v.committed = true;
    return false;
  }

  /** Cambio de carril con guiño previo y chequeo de hueco. */
  private laneChange(v: Vehicle, dt: number, gap: number, leadSpeed: number, player: VehiclePhysics): void {
    const lane = v.lane!;
    if (v.laneT < 1) {
      v.laneT = Math.min(1, v.laneT + dt / T.laneChange.duration);
      const k = v.laneT * v.laneT * (3 - 2 * v.laneT);
      v.x = v.fromLane!.x + (lane.x - v.fromLane!.x) * k;
      const lateralSpeed = ((lane.x - v.fromLane!.x) * 6 * v.laneT * (1 - v.laneT)) / T.laneChange.duration;
      v.yaw = (lane.dir === -1 ? 0 : Math.PI) + Math.atan2(-lateralSpeed, Math.max(v.speed, 2)) * (lane.dir === -1 ? 1 : -1);
      if (v.laneT >= 1) {
        v.fromLane = lane;
        v.blinkDir = 0;
        v.yaw = lane.dir === -1 ? 0 : Math.PI;
      }
      return;
    }
    if (v.blinkTimer > 0) {
      v.blinkTimer -= dt;
      if (v.blinkTimer <= 0) {
        const target = neighborLane(lane, v.blinkDir);
        if (target && this.gapOk(v, target, player)) {
          v.fromLane = lane;
          v.lane = target;
          v.laneT = 0;
        } else v.blinkDir = 0;
        v.laneCooldown = T.laneChange.minInterval;
      }
      return;
    }
    v.laneCooldown -= dt;
    if (v.laneCooldown > 0 || lane.count < 2) return;
    // No cambiar cerca de los cruces
    const lz = ((-v.z % BLOCK) + BLOCK) % BLOCK;
    if (lz < T.laneChange.noChangeNearCross || lz > BLOCK - T.laneChange.noChangeNearCross) return;
    const blocked = gap < 30 && leadSpeed < v.desired - 3;
    if (!blocked && !this.rng.chance(T.laneChange.chancePerSec * dt)) return;
    const options = [-1, 1].filter((d) => neighborLane(lane, d));
    if (!options.length) return;
    const d = this.rng.pick(options);
    const target = neighborLane(lane, d)!;
    if (!this.gapOk(v, target, player)) {
      v.laneCooldown = 1.5;
      return;
    }
    v.blinkDir = d;
    v.blinkTimer = T.laneChange.blinkerTime;
  }

  private gapOk(v: Vehicle, target: Lane, player: VehiclePhysics): boolean {
    for (const o of this.vehicles) {
      if (!o.active || o === v || o.cross) continue;
      if (o.lane !== target && o.fromLane !== target) continue;
      const rel = (o.z - v.z) * target.dir;
      if (rel > -14 && rel < 20) return false;
    }
    if (Math.abs(player.pos.x - target.x) < target.width && Math.abs(player.pos.z - v.z) < 25) return false;
    return true;
  }

  private writeInstances(): void {
    const used: Record<string, number> = { car: 0, taxi: 0, bus: 0, moto: 0, van: 0 };
    for (const v of this.vehicles) {
      if (!v.active) continue;
      used[v.type] = Math.max(used[v.type], v.slot + 1);
      this.q.setFromAxisAngle(this.up, v.yaw);
      this.p.set(v.x, 0, v.z);
      this.m.compose(this.p, this.q, this.s);
      const brake = v.accel < -1.2 || v.speed < 0.4 ? 1 : 0;
      // Guiño: dirección relativa al conductor (orden +1 = hacia afuera = derecha del conductor)
      let left = 0;
      let right = 0;
      if (v.blinkDir !== 0) {
        if (v.blinkDir > 0) right = 1;
        else left = 1;
      }
      this.batches[v.type].write(v.slot, this.m, v, brake, left, right);
    }
    for (const [t, b] of Object.entries(this.batches)) b.flush(used[t]);
  }

  /* ------------------------------------------------------------------ */
  /* Interacción con el jugador                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Choques jugador ↔ vehículos (SAT en XZ + altura). Por encima del techo no
   * hay choque; si cae sobre un techo, rebota. Devuelve el impacto más fuerte.
   */
  collide(player: VehiclePhysics, _score: Score): VehicleHit | null {
    const me = player.obb;
    const p = player.pos;
    let best: VehicleHit | null = null;
    const fwdX = -Math.sin(player.yaw);
    const fwdZ = -Math.cos(player.yaw);
    const kmh = player.speedKmh;
    for (const v of this.vehicles) {
      if (!v.active) continue;
      const dx = v.x - p.x;
      const dz = v.z - p.z;
      if (Math.abs(dx) > 16 || Math.abs(dz) > 16) {
        if (v.overlapping) v.overlapping = false;
        continue;
      }
      // Casi-choque: seguimiento mientras se superponen a lo largo del auto
      const along = dx * fwdX + dz * fwdZ;
      const lat = Math.abs(dx * -fwdZ + dz * fwdX);
      const vAlong = Math.abs(Math.cos(v.yaw - player.yaw)) * v.hz + Math.abs(Math.sin(v.yaw - player.yaw)) * v.hx;
      const vLat = Math.abs(Math.cos(v.yaw - player.yaw)) * v.hx + Math.abs(Math.sin(v.yaw - player.yaw)) * v.hz;
      const reach = CONFIG.car.collisionHalf.z + vAlong;
      if (Math.abs(along) < reach) {
        if (!v.overlapping) {
          v.overlapping = true;
          v.minGap = 99;
          v.wasOver = false;
        }
        const gapLat = lat - CONFIG.car.collisionHalf.x - vLat;
        v.minGap = Math.min(v.minGap, gapLat);
        if (p.y > v.h && gapLat < 0) v.wasOver = true;
      } else if (v.overlapping) {
        v.overlapping = false;
        if (along < -reach && !v.hitPlayer) {
          if (v.wasOver) this.nearMisses.push({ over: true, type: v.type });
          else if (v.minGap < CONFIG.score.nearMissDistance && v.minGap >= 0 && kmh > CONFIG.score.nearMissMinKmh) {
            this.nearMisses.push({ over: false, type: v.type });
            if ((v.type === 'bus' || v.type === 'taxi') && this.rng.chance(0.5)) this.horns.push({ type: v.type, distance: 10 });
          }
        }
      }

      if (p.y >= v.h) continue;
      this.obbA.x = v.x;
      this.obbA.z = v.z;
      this.obbA.hx = v.hx;
      this.obbA.hz = v.hz;
      this.obbA.yaw = v.yaw;
      if (!obbOverlap(me, this.obbA, this.contact)) continue;
      const c = this.contact;
      // Caída sobre el techo → rebote
      if (!player.grounded && player.vel.y < 0 && p.y > v.h - 0.9) {
        player.bounceOn(v.h);
        v.hitPlayer = true;
        best = { impact: 0, crash: false, roof: true, x: p.x, y: v.h, z: p.z, nx: 0, nz: 0 };
        continue;
      }
      const vvx = v.dirX * v.speed;
      const vvz = v.dirZ * v.speed;
      const rvx = player.vel.x - vvx;
      const rvz = player.vel.z - vvz;
      const vn = rvx * c.nx + rvz * c.nz;
      p.x += c.nx * c.depth;
      p.z += c.nz * c.depth;
      me.x = p.x;
      me.z = p.z;
      v.hitPlayer = true;
      if (vn >= 0) continue;
      const impact = -vn;
      player.vel.x -= c.nx * vn * 1.3;
      player.vel.z -= c.nz * vn * 1.3;
      const loss = 1 - CONFIG.collision.scrapeSpeedLoss * Math.min(1, impact / 6);
      player.vel.x *= loss;
      player.vel.z *= loss;
      v.speed *= 0.7;
      const crash = impact > CONFIG.collision.vehicleCrashSpeed;
      if (!best || impact > best.impact) best = { impact, crash, roof: false, x: p.x - c.nx * 1.0, y: 0.6, z: p.z - c.nz * 1.0, nx: c.nx, nz: c.nz };
    }
    return best;
  }

  drainNearMisses(): NearMiss[] {
    return this.nearMisses.splice(0, this.nearMisses.length);
  }

  drainHorns(): HornEvent[] {
    return this.horns.splice(0, this.horns.length);
  }

  /** ¿Hay un cruce cercano con la avenida en rojo (peatones cruzando)? */
  nearRedLight(z: number): boolean {
    const c = chunkIndexAt(z);
    for (const k of [c, c + 1]) {
      const info = chunkInfo(k);
      const mid = info.z0 - info.crossWidth / 2;
      if (Math.abs(z - mid) < 45) {
        lightState(info, this.time, this.ls);
        if (this.ls.avenue === 'red') return true;
      }
    }
    return false;
  }
}
