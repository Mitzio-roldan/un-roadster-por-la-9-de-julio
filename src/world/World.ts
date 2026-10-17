import { Group, type Scene } from 'three';
import { CONFIG } from '../config';
import { Road } from './Road';
import { Buildings, buildingUniforms } from './Buildings';
import { Trees } from './Trees';
import { Props } from './Props';
import { TrafficLights } from './TrafficLights';
import { Obelisco } from './Obelisco';
import { Pedestrians } from '../entities/Pedestrians';
import { chunkColliders, type StaticBox } from './colliders';
import { chunkIndexAt, chunkInfo, type ChunkInfo } from './layout';
import { signUniforms } from './atlasMaterial';
import { makeAdAtlas, makeGantryAtlas, makeRoadMarkAtlas, makeRoadSignAtlas, makeStreetSignAtlas } from './textures';

interface ChunkBuilder {
  buildChunk(slot: number, info: ChunkInfo): void;
}

/**
 * Avenida infinita: un conjunto fijo de "slots" de chunk. Cuando el jugador
 * avanza, los chunks que quedan atrás se reasignan a las cuadras nuevas de
 * adelante y cada capa reescribe solo su rango de instancias. No se crea ni
 * se destruye geometría durante el juego (sin picos de GC ni de memoria).
 */
export class World {
  readonly group = new Group();
  readonly road: Road;
  readonly buildings: Buildings;
  readonly trees: Trees;
  readonly props: Props;
  readonly lights: TrafficLights;
  readonly obelisco: Obelisco;
  readonly pedestrians: Pedestrians;
  readonly slots: number;
  private readonly builders: ChunkBuilder[];
  /** chunk index → slot */
  private readonly assigned = new Map<number, number>();
  private readonly slotChunk: number[];
  private ahead: number = CONFIG.world.chunksAhead;
  private readonly behind: number = CONFIG.world.chunksBehind;

  constructor(scene: Scene) {
    this.slots = CONFIG.world.chunksAhead + CONFIG.world.chunksBehind + 1;
    const ads = makeAdAtlas();
    this.road = new Road(this.slots, makeRoadMarkAtlas().texture);
    this.buildings = new Buildings(this.slots, ads);
    this.trees = new Trees(this.slots);
    this.props = new Props(this.slots, { streets: makeStreetSignAtlas(), roadSigns: makeRoadSignAtlas(), gantry: makeGantryAtlas() });
    this.lights = new TrafficLights(this.slots);
    this.obelisco = new Obelisco();
    this.pedestrians = new Pedestrians(this.slots);
    this.builders = [this.road, this.buildings, this.trees, this.props, this.lights, this.pedestrians];
    for (const m of [...this.road.meshes, ...this.buildings.meshes, ...this.trees.meshes, ...this.props.meshes, ...this.lights.meshes, ...this.pedestrians.meshes]) this.group.add(m);
    this.group.add(this.obelisco.group);
    this.slotChunk = new Array(this.slots).fill(Number.NaN);
    scene.add(this.group);
  }

  /** Cantidad de chunks hacia adelante (se reduce en calidad baja). */
  setViewChunks(ahead: number): void {
    this.ahead = Math.min(CONFIG.world.chunksAhead, ahead);
  }

  setNight(night: boolean): void {
    buildingUniforms.uNight.value = night ? 1 : 0;
    signUniforms.uGlow.value = night ? 2.4 : 1.15;
    this.props.setNight(night);
    this.obelisco.setNight(night);
  }

  /**
   * Recicla chunks según la posición del jugador.
   * `travelDir` −1 = mirando hacia −Z (normal), +1 = dado vuelta.
   */
  update(z: number, travelDir: number, time: number): void {
    const pc = chunkIndexAt(z);
    const fwd = this.ahead;
    const back = this.behind;
    const lo = travelDir < 0 ? pc - back : pc - fwd;
    const hi = travelDir < 0 ? pc + fwd : pc + back;
    // Liberar slots fuera de rango
    const free: number[] = [];
    for (let s = 0; s < this.slots; s++) {
      const c = this.slotChunk[s];
      if (Number.isNaN(c) || c < lo || c > hi) {
        if (!Number.isNaN(c)) this.assigned.delete(c);
        this.slotChunk[s] = Number.NaN;
        free.push(s);
      }
    }
    // Asignar chunks nuevos (los más cercanos primero)
    let obeliscoInfo: ChunkInfo | null = null;
    for (let d = 0; d <= Math.max(fwd, back); d++) {
      for (const c of d === 0 ? [pc] : [pc - d, pc + d]) {
        if (c < lo || c > hi) continue;
        if (!this.assigned.has(c)) {
          const s = free.pop();
          if (s === undefined) continue;
          const info = chunkInfo(c);
          for (const b of this.builders) b.buildChunk(s, info);
          this.assigned.set(c, s);
          this.slotChunk[s] = c;
        }
      }
    }
    for (const c of this.assigned.keys()) {
      const info = chunkInfo(c);
      if (info.hasObelisco) obeliscoInfo = info;
    }
    this.obelisco.place(obeliscoInfo);
    this.road.follow(z, travelDir);
    this.lights.update(time);
    signUniforms.uTime.value = time;
  }

  /** Fuerza la regeneración completa (p. ej. al reiniciar). */
  reset(): void {
    this.assigned.clear();
    this.slotChunk.fill(Number.NaN);
  }

  /** Colisionadores estáticos de las cuadras alrededor de z. */
  collidersNear(z: number, out: StaticBox[]): StaticBox[] {
    out.length = 0;
    const c = chunkIndexAt(z);
    for (let i = c - 1; i <= c + 1; i++) for (const b of chunkColliders(i)) out.push(b);
    return out;
  }
}
