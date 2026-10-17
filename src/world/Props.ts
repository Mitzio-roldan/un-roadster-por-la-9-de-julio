import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  FrontSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { merge, paint } from '../core/geometry';
import { Rng } from '../core/rng';
import { patchMaterial } from '../core/shaderPatch';
import { ChunkedLayer } from './instanced';
import { X, stopLineZ, type ChunkInfo } from './layout';
import { makeAtlasMaterial } from './atlasMaterial';
import { makeRadialTexture, type Atlas } from './textures';

export interface PropAtlases {
  streets: Atlas;
  roadSigns: Atlas;
  gantry: Atlas;
}

const std = (color: number, roughness = 0.6, metalness = 0.3) => patchMaterial(new MeshStandardMaterial({ color, roughness, metalness }), 'atm');

/**
 * Mobiliario de la avenida: faroles (con charcos de luz de noche), carteles
 * verdes con nombres de calles, señales viales, pórticos sobre la calzada y
 * paradas del Metrobus con techo, bancos y cartel.
 */
export class Props {
  readonly lampPoles: ChunkedLayer;
  readonly lampHeads: ChunkedLayer;
  readonly lightPools: ChunkedLayer;
  readonly poles: ChunkedLayer;
  readonly streetPlates: ChunkedLayer;
  readonly roadSigns: ChunkedLayer;
  readonly gantryFrames: ChunkedLayer;
  readonly gantryPanels: ChunkedLayer;
  readonly stationRoofs: ChunkedLayer;
  readonly stationParts: ChunkedLayer;
  readonly stationGlass: ChunkedLayer;
  readonly lampHeadMat: MeshStandardMaterial;
  private readonly layers: ChunkedLayer[];
  private readonly at: PropAtlases;

  constructor(slots: number, atlases: PropAtlases) {
    this.at = atlases;
    // Farol doble típico de los canteros: poste alto + dos brazos.
    const lampGeo = merge([
      paint(new CylinderGeometry(0.1, 0.16, 10, 8).translate(0, 5, 0), '#3b3f45'),
      paint(new BoxGeometry(5.2, 0.12, 0.12).translate(0, 9.85, 0), '#3b3f45'),
      paint(new CylinderGeometry(0.22, 0.22, 0.5, 8).translate(0, 0.25, 0), '#2c2f33'),
    ]);
    this.lampPoles = new ChunkedLayer(lampGeo, patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }), 'atm'), 26, slots, { castShadow: true });
    this.lampHeadMat = new MeshStandardMaterial({ color: 0x8a8d90, emissive: 0xffc27a, emissiveIntensity: 0, roughness: 0.4 });
    patchMaterial(this.lampHeadMat, 'atm');
    this.lampHeads = new ChunkedLayer(new BoxGeometry(1.1, 0.22, 0.42), this.lampHeadMat, 52, slots, { castShadow: false });
    const poolMat = new MeshBasicMaterial({
      map: makeRadialTexture('rgba(255,190,120,0.32)', 'rgba(255,170,90,0)'),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.lightPools = new ChunkedLayer(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), patchMaterial(poolMat, 'atm'), 52, slots, { receiveShadow: false });
    this.lightPools.mesh.visible = false;
    this.lightPools.mesh.renderOrder = 2;

    this.poles = new ChunkedLayer(new CylinderGeometry(0.05, 0.06, 1, 6).translate(0, 0.5, 0), std(0x6d7278, 0.5, 0.6), 40, slots, { castShadow: true });
    this.streetPlates = new ChunkedLayer(new PlaneGeometry(1, 1), makeAtlasMaterial(atlases.streets, { lit: true, key: 'streets', side: FrontSide }), 40, slots, {
      attributes: { aTile: 1 },
    });
    const signMat = makeAtlasMaterial(atlases.roadSigns, { lit: true, key: 'road', side: FrontSide, roughness: 0.4 });
    signMat.alphaTest = 0.5;
    this.roadSigns = new ChunkedLayer(new PlaneGeometry(1, 1), signMat, 16, slots, { attributes: { aTile: 1 } });

    // Pórtico: dos columnas y viga reticulada simplificada
    const gantryGeo = merge([
      paint(new BoxGeometry(0.45, 7.4, 0.45).translate(-11.1, 3.7, 0), '#9aa0a6'),
      paint(new BoxGeometry(0.45, 7.4, 0.45).translate(11.1, 3.7, 0), '#9aa0a6'),
      paint(new BoxGeometry(22.6, 0.5, 0.5).translate(0, 7.2, 0), '#9aa0a6'),
      paint(new BoxGeometry(22.6, 0.3, 0.3).translate(0, 6.4, 0), '#8a9096'),
    ]);
    this.gantryFrames = new ChunkedLayer(gantryGeo, patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 }), 'atm'), 2, slots, { castShadow: true });
    this.gantryPanels = new ChunkedLayer(new PlaneGeometry(1, 1), makeAtlasMaterial(atlases.gantry, { lit: true, key: 'gantry', side: FrontSide, roughness: 0.35 }), 8, slots, {
      attributes: { aTile: 1 },
    });

    // Parada de Metrobus
    this.stationRoofs = new ChunkedLayer(
      merge([
        paint(new BoxGeometry(8.4, 0.28, 1).translate(0, 3.55, 0), '#e9ecef'),
        paint(new BoxGeometry(8.6, 0.12, 1).translate(0, 3.38, 0), '#2bbf8a'),
      ]),
      patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 }), 'atm'),
      1,
      slots,
      { castShadow: true },
    );
    this.stationParts = new ChunkedLayer(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), std(0xffffff, 0.5, 0.4), 40, slots, { castShadow: true, color: true });
    const glass = new MeshStandardMaterial({ color: 0x7fa8b8, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false });
    this.stationGlass = new ChunkedLayer(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), patchMaterial(glass, 'atm'), 8, slots);
    this.stationGlass.mesh.renderOrder = 1;

    this.layers = [
      this.lampPoles,
      this.lampHeads,
      this.lightPools,
      this.poles,
      this.streetPlates,
      this.roadSigns,
      this.gantryFrames,
      this.gantryPanels,
      this.stationRoofs,
      this.stationParts,
      this.stationGlass,
    ];
  }

  get meshes() {
    return this.layers.map((l) => l.mesh);
  }

  setNight(night: boolean): void {
    this.lampHeadMat.emissiveIntensity = night ? 3.2 : 0;
    this.lightPools.mesh.visible = night;
  }

  buildChunk(slot: number, info: ChunkInfo): void {
    for (const l of this.layers) l.beginSlot(slot);
    const rng = new Rng(info.index * 577 + 11);
    const zA = info.blockStart;
    const zB = info.blockEnd;

    // --- Faroles
    for (const side of [1, -1]) {
      for (const cx of [(X.busEnd + X.sepInnerEnd) / 2, (X.mainEnd + X.sepOuterEnd) / 2]) {
        for (let z = zA - 8; z > zB + 6; z -= 27) {
          this.lampPoles.add(side * cx, 0.2, z, 0, 1, 1, 1);
          for (const arm of [-1, 1]) {
            this.lampHeads.add(side * cx + arm * 2.45, 9.72, z, 0, 1, 1, 1);
            this.lightPools.add(side * cx + arm * 4.2, 0.04, z, 0, 15, 1, 15);
          }
        }
      }
    }

    // --- Carteles de nombre de calle en las cuatro esquinas de la vereda
    const tileStreet = this.at.streets.index[info.streetName] ?? 0;
    const tile9 = this.at.streets.index['9dejulio'];
    for (const side of [1, -1]) {
      for (const zc of [info.zCrossEnd - 1.2, info.z0 + 1.2]) {
        const x = side * (X.lateralEnd + 0.9);
        this.poles.add(x, 0.16, zc, 0, 1, 3.4, 1);
        // Placa con la calle transversal, mirando al tránsito de la avenida (ambas caras)
        this.streetPlates.add(x, 3.1, zc + 0.03, 0, 1.7, 0.42, 1, undefined, { aTile: tileStreet });
        this.streetPlates.add(x, 3.1, zc - 0.03, Math.PI, 1.7, 0.42, 1, undefined, { aTile: tileStreet });
        // Placa "Av. 9 de Julio", paralela a la avenida
        this.streetPlates.add(x + 0.03, 2.62, zc, Math.PI / 2, 1.7, 0.42, 1, undefined, { aTile: tile9 });
        this.streetPlates.add(x - 0.03, 2.62, zc, -Math.PI / 2, 1.7, 0.42, 1, undefined, { aTile: tile9 });
      }
    }

    // --- Señales viales sobre canteros y veredas
    const signs = this.at.roadSigns.index;
    for (const side of [1, -1] as const) {
      const dir = side === 1 ? -1 : 1;
      const zStop = stopLineZ(info, dir);
      const zAhead = side === 1 ? info.blockStart - 14 : info.blockEnd + 14; // a la salida del cruce
      const face = side === 1 ? 0 : Math.PI; // cara hacia el tránsito que se acerca
      // Velocidad máxima 60 en la vereda (cuadras pares)
      if (info.index % 2 === 0) {
        const x = side * (X.lateralEnd + 0.7);
        this.poles.add(x, 0.16, zAhead, 0, 1, 2.9, 1);
        this.roadSigns.add(x, 2.55, zAhead - dir * 0.05, face, 0.85, 0.85, 1, undefined, { aTile: signs.speed });
      }
      // Metrobus exclusivo junto a los carriles del centro
      {
        const x = side * (X.busEnd + 0.6);
        const z = zAhead - dir * 10;
        this.poles.add(x, 0.2, z, 0, 1, 2.9, 1);
        this.roadSigns.add(x, 2.5, z - dir * 0.05, face, 0.95, 0.95, 1, undefined, { aTile: signs.metrobus });
      }
      // Prohibido girar a la izquierda antes del cruce
      if (info.index % 3 === 1) {
        const x = side * (X.sepInnerEnd - 0.6);
        const z = zStop + (side === 1 ? 14 : -14);
        this.poles.add(x, 0.2, z, 0, 1, 2.8, 1);
        this.roadSigns.add(x, 2.45, z - dir * 0.05, face, 0.8, 0.8, 1, undefined, { aTile: signs.noLeft });
      }
      // Paso peatonal en el cantero externo
      {
        const x = side * (X.mainEnd + 0.6);
        const z = zStop + (side === 1 ? 2.5 : -2.5);
        this.poles.add(x, 0.2, z, 0, 1, 2.8, 1);
        this.roadSigns.add(x, 2.45, z - dir * 0.05, face, 0.75, 0.75, 1, undefined, { aTile: signs.pedestrian });
      }
    }

    // --- Pórtico de señalización sobre la calzada principal
    if (info.hasGantry) {
      const g = this.at.gantry.index;
      const zg = (zA + zB) / 2 + 12;
      for (const side of [1, -1] as const) {
        const cx = side * (X.sepInnerEnd + X.mainEnd) * 0.5;
        const z = zg + side * 20;
        this.gantryFrames.add(cx, 0, z, 0, 1, 1, 1);
        const face = side === 1 ? 0 : Math.PI;
        const tiles = side === 1 ? [g.retiro, rng.pick([g.puerto, g.microcentro, g.obelisco])] : [g.constitucion, rng.pick([g.au, g.metrobus, g.velocidad])];
        const off = side === 1 ? 0.3 : -0.3;
        this.gantryPanels.add(cx + side * 4.6, 6.1, z + off, face, 7.6, 1.9, 1, undefined, { aTile: tiles[0] });
        this.gantryPanels.add(cx - side * 4.6, 6.1, z + off, face, 7.6, 1.9, 1, undefined, { aTile: tiles[1] });
      }
    }

    // --- Parada de Metrobus en la isla central
    if (info.hasStation) {
      const len = 46;
      const zc = (zA + zB) / 2;
      const grey = new Color(0x8f979e);
      const green = new Color(0x2bbf8a);
      this.stationRoofs.add(0, 0.22, zc, 0, 1, 1, len);
      for (let i = 0; i <= 5; i++) {
        const z = zc - len / 2 + 2 + i * ((len - 4) / 5);
        this.stationParts.add(-2.6, 0.22, z, 0, 0.18, 3.2, 0.18, grey);
        this.stationParts.add(2.6, 0.22, z, 0, 0.18, 3.2, 0.18, grey);
      }
      // Bancos y tótems
      for (let i = 0; i < 4; i++) {
        const z = zc - 15 + i * 10;
        this.stationParts.add(0, 0.22, z, 0, 0.9, 0.45, 2.4, 0x5b4a3a);
        this.stationParts.add(0, 0.22, z + 4.5, 0, 0.35, 2.2, 0.35, green);
      }
      // Mamparas de vidrio en el eje de la isla
      this.stationGlass.add(0, 0.6, zc - 10, 0, 0.06, 2.2, 12);
      this.stationGlass.add(0, 0.6, zc + 10, 0, 0.06, 2.2, 12);
      // Barandas en los extremos
      this.stationParts.add(0, 0.22, zc - len / 2 - 0.5, 0, 6, 1.0, 0.1, grey);
      this.stationParts.add(0, 0.22, zc + len / 2 + 0.5, 0, 6, 1.0, 0.1, grey);
      // Cartel con el nombre de la parada, colgado del techo en ambos extremos
      const t = this.at.streets.index[`station:${info.streetName}`] ?? 16;
      for (const end of [1, -1]) {
        const z = zc + end * (len / 2 - 1);
        this.streetPlates.add(0, 2.85, z + end * 0.02, end > 0 ? 0 : Math.PI, 3.6, 0.9, 1, undefined, { aTile: t });
        this.streetPlates.add(0, 2.85, z - end * 0.02, end > 0 ? Math.PI : 0, 3.6, 0.9, 1, undefined, { aTile: t });
      }
    }

    for (const l of this.layers) {
      l.endSlot();
      l.flush();
    }
  }
}

