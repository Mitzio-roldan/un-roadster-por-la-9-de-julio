import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { Rng } from '../core/rng';
import { patchMaterial, replaceChunk } from '../core/shaderPatch';
import { ChunkedLayer } from './instanced';
import { BLOCK, X, type ChunkInfo } from './layout';
import { worldVaryings } from './materials';
import { makeAtlasMaterial } from './atlasMaterial';
import { ADS, type Atlas } from './textures';

/** Uniform de noche compartido por edificios (ventanas encendidas). */
export const buildingUniforms = { uNight: { value: 0 } };

// Paleta porteña: piedra París, beige, terracota, grises y alguna torre vidriada.
const FACADES = ['#d9cbb0', '#cbb894', '#e3d8c4', '#b9a58a', '#c99a78', '#a8a39a', '#d4c6ae', '#bfb4a3', '#9c8f80', '#e6dccb', '#b48a6a', '#8e8a84'];
const GLASS = ['#5d6b78', '#4f5d68', '#6b7880'];
const DOMES = ['#3f4a4e', '#4f6f68', '#5a5f63', '#3c5a55'];

/**
 * Edificios low-poly: cajas instanciadas con un shader que dibuja ventanas,
 * cornisas y locales a partir de la posición en el mundo. De noche, las
 * ventanas se encienden al azar (hash por ventana) con tonos cálidos y fríos.
 */
export class Buildings {
  readonly buildings: ChunkedLayer;
  readonly roofs: ChunkedLayer;
  readonly drums: ChunkedLayer;
  readonly domes: ChunkedLayer;
  readonly ads: ChunkedLayer;
  readonly adFrames: ChunkedLayer;
  private readonly layers: ChunkedLayer[];

  constructor(slots: number, adAtlas: Atlas) {
    const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.buildings = new ChunkedLayer(box, makeBuildingMaterial(), 56, slots, {
      color: true,
      attributes: { aStyle: 4 },
      castShadow: true,
      receiveShadow: true,
    });
    this.buildings.mesh.name = 'buildings';

    const roofMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    this.roofs = new ChunkedLayer(box.clone(), patchMaterial(roofMat, 'atm'), 60, slots, { color: true, castShadow: true });

    // Cúpula estilo porteño: tambor + cúpula + linterna + aguja
    const drum = mergeGeometries([new CylinderGeometry(1, 1.05, 0.9, 16).translate(0, 0.45, 0), new CylinderGeometry(1.12, 1.12, 0.12, 16).translate(0, 0.96, 0)]);
    const dome = mergeGeometries([
      new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 1).translate(0, 1.0, 0),
      new CylinderGeometry(0.22, 0.24, 0.5, 8).translate(0, 2.45, 0),
      new ConeGeometry(0.26, 0.9, 8).translate(0, 3.15, 0),
    ]);
    const domeMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.35, flatShading: true });
    this.drums = new ChunkedLayer(drum, patchMaterial(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), 'atm'), 8, slots, { color: true, castShadow: true });
    this.domes = new ChunkedLayer(dome, patchMaterial(domeMat, 'atm'), 8, slots, { color: true, castShadow: true });

    // Publicidades gigantes en medianeras/fachadas y pantallas LED en esquinas
    const plane = new PlaneGeometry(1, 1);
    this.ads = new ChunkedLayer(plane, makeAtlasMaterial(adAtlas, { animated: true, key: 'ads' }), 10, slots, { attributes: { aTile: 1, aAnim: 1 }, receiveShadow: false });
    this.ads.mesh.name = 'ads';
    const frameMat = patchMaterial(new MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.6, metalness: 0.5 }), 'atm');
    this.adFrames = new ChunkedLayer(box.clone(), frameMat, 10, slots, { castShadow: true });

    this.layers = [this.buildings, this.roofs, this.drums, this.domes, this.ads, this.adFrames];
  }

  get meshes() {
    return this.layers.map((l) => l.mesh);
  }

  buildChunk(slot: number, info: ChunkInfo): void {
    for (const l of this.layers) l.beginSlot(slot);
    const rng = new Rng(info.index * 1013 + 7);
    const z1 = info.zCrossEnd - 0.6; // borde de la manzana sobre la transversal
    const z2 = info.z0 - BLOCK + 0.6;
    const nearObelisco = info.hasObelisco || ((info.streetIndex + 1) % CONFIG.streets.length === CONFIG.streets.findIndex((s) => s.name === CONFIG.obeliscoStreet));
    const color = new Color();
    let adsLeft = rng.int(2, 4);

    for (const side of [1, -1]) {
      // --- Fila sobre la avenida
      let z = z1;
      let first = true;
      while (z > z2 + 6) {
        let w = rng.range(9, 24);
        if (z - w < z2 + 8) w = z - z2;
        const last = z - w <= z2 + 0.01;
        const depth = rng.range(22, 38);
        const tall = nearObelisco ? rng.range(28, 95) : rng.range(18, 70);
        const h = rng.chance(0.08) ? tall * 1.5 : tall;
        const glass = h > 55 && rng.chance(0.45);
        color.set(glass ? rng.pick(GLASS) : rng.pick(FACADES));
        const cx = side * (X.buildings + depth / 2);
        const cz = z - w / 2;
        this.addBuilding(cx, cz, depth, h, w, color, rng, glass);

        // Retiro superior escalonado
        if (!glass && h > 30 && rng.chance(0.45)) {
          const h2 = rng.range(5, 14);
          this.buildings.add(cx + side * 2.5, h, cz, 0, depth - 5, h2, w - 3, color.clone().multiplyScalar(0.95), { aStyle: [rng.next(), 0, 3.3, 0.55] });
        }

        // Cúpula en esquinas (típicas de Av. de Mayo / microcentro)
        if ((first || last) && !glass && rng.chance(0.45)) {
          const r = Math.min(w, depth) * rng.range(0.16, 0.24);
          const dzc = first ? -r - 1.2 : r + 1.2;
          const px = side * (X.buildings + r + 1.2);
          const pz = (first ? z : z - w) + dzc;
          this.drums.add(px, h, pz, 0, r, r * 1.3, r, color);
          this.domes.add(px, h + r * 0.33, pz, 0, r, r, r, new Color(rng.pick(DOMES)));
        }

        // Publicidad gigante sobre la fachada que mira a la avenida
        if (adsLeft > 0 && h > 26 && w > 12 && rng.chance(0.35)) {
          adsLeft--;
          const aw = Math.min(w - 3, rng.range(12, 18));
          const ah = aw * 0.5;
          const ay = rng.range(12, Math.max(13, h - ah - 4));
          const fx = side * (X.buildings - 0.35);
          this.adFrames.add(fx + side * 0.15, ay - 0.4, cz, 0, 0.5, ah + 0.8, aw + 0.8);
          this.ads.add(fx - side * 0.06, ay + ah / 2, cz, side > 0 ? -Math.PI / 2 : Math.PI / 2, aw, ah, 1, undefined, {
            aTile: rng.int(0, ADS.length - 1),
            aAnim: rng.pick([0, 0, 1, 2, 3]),
          });
        }
        // Pantalla LED vertical en la esquina, mirando al tránsito que se acerca
        if (first && h > 20 && rng.chance(0.55)) {
          const sw = 6;
          const sh = 9;
          // La cara +Z del primer edificio de la manzana mira al tránsito que viene hacia −Z.
          const px = side * (X.buildings + 4.5);
          this.ads.add(px, rng.range(9, Math.max(10, h - sh - 2)) + sh / 2, z + 0.45, 0, sw, sh, 1, undefined, {
            aTile: rng.int(0, ADS.length - 1),
            aAnim: rng.int(1, 3),
          });
        }
        first = false;
        z -= w + CONFIG.layout.buildingGap;
      }

      // --- Fila trasera (skyline y frentes sobre las transversales)
      let x = X.buildings + 40;
      while (x < CONFIG.world.sideExtent) {
        const wx = rng.range(22, 46);
        const h = rng.range(22, nearObelisco ? 120 : 95);
        const glass = h > 60 && rng.chance(0.5);
        color.set(glass ? rng.pick(GLASS) : rng.pick(FACADES));
        this.addBuilding(side * (x + wx / 2), (z1 + z2) / 2, wx - 1, h, z1 - z2, color, rng, glass);
        x += wx;
      }
    }
    for (const l of this.layers) {
      l.endSlot();
      l.flush();
    }
  }

  private addBuilding(cx: number, cz: number, sx: number, h: number, sz: number, color: Color, rng: Rng, glass: boolean): void {
    const style = glass ? 1 : rng.chance(0.25) ? 2 : 0;
    const floorH = style === 1 ? 3.6 : rng.range(3.1, 3.6);
    this.buildings.add(cx, 0, cz, 0, sx, h, sz, color, { aStyle: [rng.next(), style, floorH, rng.range(0.35, 0.7)] });
    // Tanques de agua / salas de máquinas en la terraza
    const n = rng.int(0, 2);
    for (let i = 0; i < n; i++) {
      const bw = rng.range(2.5, 5);
      this.roofs.add(cx + rng.range(-sx, sx) * 0.3, h, cz + rng.range(-sz, sz) * 0.3, 0, bw, rng.range(1.8, 3.5), bw * rng.range(0.7, 1.3), 0x77736d);
    }
  }
}

function makeBuildingMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  return patchMaterial(m, 'building', (s) => {
    s.uniforms.uNight = buildingUniforms.uNight;
    worldVaryings(s);
    s.vertexShader = replaceChunk(s.vertexShader, '#include <common>', '#include <common>\nattribute vec4 aStyle;\nvarying vec4 vStyle;');
    s.vertexShader = replaceChunk(s.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>\n  vStyle = aStyle;');
    s.fragmentShader = replaceChunk(
      s.fragmentShader,
      '#include <common>',
      `#include <common>
uniform float uNight;
varying vec4 vStyle;
float bWin; vec3 bEmit;`,
    );
    s.fragmentShader = replaceChunk(
      s.fragmentShader,
      '#include <map_fragment>',
      `#include <map_fragment>
  {
    vec3 N = normalize(vWN);
    float top = step(0.6, N.y);
    float u = abs(N.x) > 0.5 ? vWP.z : vWP.x;
    float y = vWP.y;
    float seed = vStyle.x;
    float type = vStyle.y;
    float floorH = vStyle.z;
    float groundH = 4.4;
    float fy = (y - groundH) / floorH;
    float fl = floor(fy);
    float ff = fract(fy);
    float spacing = type > 0.5 && type < 1.5 ? 1.8 : mix(2.7, 3.7, fract(seed * 7.13));
    float cu = u / spacing;
    float ci = floor(cu);
    float fu = fract(cu);
    vec2 a = type < 0.5 ? vec2(0.27, 0.22) : type < 1.5 ? vec2(0.05, 0.06) : vec2(0.08, 0.3);
    vec2 b = type < 0.5 ? vec2(0.73, 0.84) : type < 1.5 ? vec2(0.95, 0.97) : vec2(0.92, 0.82);
    float above = step(groundH + 0.3, y);
    // A distancia, las ventanas se promedian (cobertura) para evitar aliasing/moiré.
    float far = smoothstep(0.3, 0.9, max(fwidth(cu), fwidth(fy)));
    float cover = (b.x - a.x) * (b.y - a.y);
    float facade = above * (1.0 - top);
    float winN = boxAA(vec2(fu, ff), a, b, vec2(fwidth(cu), fwidth(fy))) * facade;
    float win = mix(winN, cover * facade, far);
    vec3 wall = diffuseColor.rgb;
    // cornisas / losas y pilastras
    if (type < 0.5) {
      wall *= 1.0 - (1.0 - smoothstep(0.04, 0.08, ff)) * 0.18 * above * (1.0 - far);
      wall *= 0.94 + 0.06 * step(0.5, fract(cu * 0.5 + 0.25));
    }
    wall *= 0.9 + 0.12 * gNoise(vWP.xy * 0.15 + vWP.zy * 0.15);
    // locales a nivel de vereda
    float shop = (1.0 - step(groundH - 0.7, y)) * step(0.4, y) * (1.0 - top) * step(0.25, fract(u / 7.0));
    float shopOn = step(0.4, gHash(vec2(floor(u / 7.0), seed * 13.0)));
    float h = gHash(vec2(ci + seed * 101.0, fl + seed * 37.0));
    vec3 glass = mix(vec3(0.1, 0.12, 0.15), vec3(0.2, 0.23, 0.28), h);
    vec3 col = mix(wall, glass, max(win, shop * 0.9));
    // terrazas
    col = mix(col, vec3(0.2, 0.19, 0.18) * (0.8 + 0.3 * gNoise(vWP.xz * 0.3)), top);
    // oclusión falsa al pie del edificio
    col *= mix(0.55, 1.0, smoothstep(0.0, 3.5, y));
    diffuseColor.rgb = col;
    bWin = max(win, shop);
    // Ventanas encendidas de noche
    float lit = mix(step(h, vStyle.w) * winN, vStyle.w * cover * facade, far);
    float tone = gHash(vec2(fl * 3.1 + seed, ci * 1.7));
    vec3 warm = mix(vec3(1.0, 0.6, 0.28), vec3(0.8, 0.88, 1.0), step(0.8, tone));
    bEmit = warm * lit * uNight * (0.55 + 0.9 * tone) + vec3(1.0, 0.72, 0.42) * shop * shopOn * uNight * 1.1;
  }`,
    );
    s.fragmentShader = replaceChunk(
      s.fragmentShader,
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.08, bWin);',
    );
    s.fragmentShader = replaceChunk(
      s.fragmentShader,
      '#include <metalnessmap_fragment>',
      '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.55, bWin);',
    );
    s.fragmentShader = replaceChunk(
      s.fragmentShader,
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance += bEmit;',
    );
  });
}

