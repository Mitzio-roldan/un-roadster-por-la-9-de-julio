import { BoxGeometry, Mesh, MeshStandardMaterial, PlaneGeometry, type Texture } from 'three';
import { CONFIG } from '../config';
import { patchMaterial, replaceChunk } from '../core/shaderPatch';
import { ChunkedLayer } from './instanced';
import { BLOCK, CROSSWALK, STREETS, STREET_COUNT, X, crossWidthOf, type ChunkInfo } from './layout';
import { makeCurbMaterial, makeGrassMaterial, makeSidewalkMaterial, worldVaryings } from './materials';

/**
 * Calzada de la 9 de Julio.
 *
 * El asfalto es UN plano que sigue al jugador; todas las marcas (líneas de
 * carril, sendas peatonales, líneas de detención, flechas, "BUS", hormigón del
 * Metrobus, parches y desgaste) se calculan en el fragment shader a partir de
 * la posición en el mundo. Ventajas: nítido a cualquier distancia (ondas
 * filtradas con fwidth), cero z-fighting y cero geometría por marca.
 */
export class Road {
  readonly ground: Mesh;
  readonly curbs: ChunkedLayer;
  readonly grass: ChunkedLayer;
  readonly sidewalks: ChunkedLayer;
  private readonly layers: ChunkedLayer[];

  constructor(slots: number, marks: Texture) {
    const L = CONFIG.layout;
    const defines = {
      NSTREETS: STREET_COUNT,
      BLOCK: BLOCK.toFixed(2),
      CW: CROSSWALK.toFixed(2),
      GAP: CONFIG.world.stopLineGap.toFixed(2),
      ISLAND: X.island.toFixed(2),
      BUS_END: X.busEnd.toFixed(2),
      SEPI_END: X.sepInnerEnd.toFixed(2),
      MAIN_END: X.mainEnd.toFixed(2),
      SEPO_END: X.sepOuterEnd.toFixed(2),
      LAT_END: X.lateralEnd.toFixed(2),
      SIDE_END: X.sidewalkEnd.toFixed(2),
      BUS_LW: L.busLaneWidth.toFixed(2),
      MAIN_LW: L.mainLaneWidth.toFixed(2),
      LAT_LW: L.lateralLaneWidth.toFixed(2),
      BUS_N: L.busLanes.toFixed(1),
      MAIN_N: L.mainLanes.toFixed(1),
      LAT_N: L.lateralLanes.toFixed(1),
    };
    const widths = STREETS.map((_, i) => crossWidthOf(i));
    const dirs = STREETS.map((_, i) => (i % 2 === 0 ? 1 : -1));

    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    patchMaterial(mat, 'road', (s) => {
      s.uniforms.uCrossW = { value: widths };
      s.uniforms.uCrossDir = { value: dirs };
      s.uniforms.uMarks = { value: marks };
      const defs = Object.entries(defines)
        .map(([k, v]) => `#define ${k} ${v}`)
        .join('\n');
      s.fragmentShader = replaceChunk(
        s.fragmentShader,
        '#include <common>',
        `#include <common>
${defs}
uniform float uCrossW[NSTREETS];
uniform float uCrossDir[NSTREETS];
uniform sampler2D uMarks;
float gRough;

// Distancia a la división de carril más cercana (o 1e3 si no hay).
float laneDivider(float ax, float start, float lw, float n) {
  float u = (ax - start) / lw;
  float k = floor(u + 0.5);
  if (k < 1.0 || k > n - 1.0) return 1e3;
  return (u - k) * lw;
}
// Índice de carril y coordenada local [0,1] dentro del carril.
vec2 laneCoord(float ax, float start, float lw) {
  float u = (ax - start) / lw;
  return vec2(floor(u), fract(u));
}
float markSample(float cell, vec2 uv) {
  uv = clamp(uv, 0.0, 1.0);
  return texture2D(uMarks, vec2((cell + uv.x) / 4.0, uv.y)).r;
}

vec3 groundShade(vec2 p) {
  float ax = abs(p.x);
  float side = p.x >= 0.0 ? 1.0 : -1.0;
  float s = -p.y;
  float bi = floor(s / BLOCK);
  float lz = s - bi * BLOCK;
  int si = int(mod(bi, float(NSTREETS)));
  float W = uCrossW[si];
  float cdir = uCrossDir[si];
  bool inCross = lz < W;
  // Derivadas en flujo uniforme (fwidth dentro de ramas es indefinido en algunas GPUs)
  float fwAx = fwidth(ax);
  float fwS = fwidth(s);
  vec2 pc = p / vec2(6.0, 13.0);
  vec2 fwPc = fwidth(pc);

  float n1 = gNoise(p * 0.31);
  float n2 = gNoise(p * 2.3 + 11.0);
  float n3 = gNoise(p * 11.0 - 5.0);
  vec3 col = vec3(0.058, 0.058, 0.062) * (0.8 + 0.28 * n1 + 0.12 * n2 + 0.08 * n3);
  gRough = 0.9 - n2 * 0.08;

  // Parches de bacheo
  if (gHash(floor(pc)) > 0.87) {
    float m = boxAA(fract(pc), vec2(0.18, 0.12), vec2(0.82, 0.7), fwPc);
    col = mix(col, col * 0.7 + 0.006, m * 0.85);
  }

  bool bus = ax >= ISLAND && ax < BUS_END;
  bool mainL = ax >= SEPI_END && ax < MAIN_END;
  bool lat = ax >= SEPO_END && ax < LAT_END;
  bool lanes = (bus || mainL || lat) && !inCross;

  float stopR = BLOCK - CW - GAP;
  float stopL = W + CW + GAP;
  // Tramo con líneas de carril (entre la senda de salida y la línea de detención)
  bool lined = side > 0.0 ? (lz > W + CW && lz < stopR) : (lz > stopL && lz < BLOCK - CW);
  bool solid = side > 0.0 ? (lz > stopR - 22.0) : (lz < stopL + 22.0);
  float distStop = side > 0.0 ? stopR - lz : lz - stopL;

  float paint = 0.0;
  vec3 paintCol = vec3(0.82, 0.81, 0.76);

  if (bus && !inCross) {
    // Carriles del Metrobus: losas de hormigón con juntas
    vec3 conc = vec3(0.2, 0.195, 0.185) * (0.85 + 0.18 * n1 + 0.1 * n3);
    float joints = lineAA((fract(s / 5.0 + 0.5) - 0.5) * 5.0, 0.025, fwS) + lineAA(fract((ax - ISLAND) / BUS_LW + 0.5) * BUS_LW - BUS_LW * 0.5, 0.025, fwAx);
    conc *= 1.0 - clamp(joints, 0.0, 1.0) * 0.45;
    vec2 lc = laneCoord(ax, ISLAND, BUS_LW);
    float wear = exp(-pow((abs(lc.y - 0.5) * BUS_LW - 0.95) / 0.35, 2.0));
    conc *= 1.0 - wear * 0.25;
    col = conc;
    gRough = 0.8;
  }

  if (lanes) {
    float lw = bus ? BUS_LW : mainL ? MAIN_LW : LAT_LW;
    float start = bus ? ISLAND : mainL ? SEPI_END : SEPO_END;
    float n = bus ? BUS_N : mainL ? MAIN_N : LAT_N;
    vec2 lc = laneCoord(ax, start, lw);
    if (!bus) {
      // Huellas de neumáticos y manchas de aceite
      float wp = exp(-pow((abs(lc.y - 0.5) * lw - 0.85) / 0.3, 2.0));
      col *= 1.0 - wp * 0.18 * (0.6 + 0.4 * n2);
      float oil = exp(-pow((lc.y - 0.5) * lw / 0.7, 2.0)) * smoothstep(0.6, 0.85, gNoise(p * vec2(0.9, 0.12)));
      col *= 1.0 - oil * 0.22;
    }
    if (lined) {
      float d = laneDivider(ax, start, lw, n);
      float dash = solid ? 1.0 : pulse(s / 9.0 + side * 0.25, 3.0 / 9.0, fwS / 9.0);
      paint = max(paint, lineAA(d, 0.075, fwAx) * dash);
      if (bus) paintCol = mix(paintCol, vec3(0.85, 0.62, 0.08), lineAA(d, 0.5, fwAx));
      // Flechas antes de la línea de detención
      if (distStop > 4.0 && distStop < 9.5 && !bus) {
        float v = (distStop - 4.0) / 5.5;
        v = 1.0 - v;
        float cell = (lc.x >= n - 1.0) ? (lat ? 2.0 : 1.0) : 0.0;
        float u = (lc.y * lw - (lw * 0.5 - 0.7)) / 1.4;
        float inside = boxAA(vec2(u, v), vec2(0.0), vec2(1.0), vec2(fwAx / 1.4, fwS / 5.5));
        paint = max(paint, markSample(cell, vec2(u, v)) * inside);
      }
      if (bus && distStop > 6.0 && distStop < 14.0) {
        float v = 1.0 - (distStop - 6.0) / 8.0;
        float u = (lc.y * lw - (lw * 0.5 - 1.1)) / 2.2;
        float inside = boxAA(vec2(u, v), vec2(0.0), vec2(1.0), vec2(fwAx / 2.2, fwS / 8.0));
        paint = max(paint, markSample(3.0, vec2(u, v)) * inside);
      }
    }
    // Línea de detención
    float stopBand = side > 0.0 ? lz - (stopR + 0.3) : lz - (stopL - 0.3);
    paint = max(paint, lineAA(stopBand, 0.25, fwS));
  }

  // Sendas peatonales (cebra) a ambos lados del cruce
  if (ax < SIDE_END && !inCross) {
    bool cw1 = lz > BLOCK - CW && lz < BLOCK;
    bool cw2 = lz > W && lz < W + CW;
    if ((cw1 || cw2) && (bus || mainL || lat)) {
      float zebra = pulse(p.x / 1.1, 0.5, fwAx / 1.1);
      paint = max(paint, zebra * (0.75 + 0.25 * smoothstep(0.2, 0.6, n3)));
    }
  }

  // Calle transversal más allá de la avenida
  if (ax >= SIDE_END) {
    if (inCross) {
      float cwx = ax - SIDE_END - 0.5;
      if (cwx > 0.0 && cwx < CW) paint = max(paint, pulse(lz / 1.1, 0.5, fwS / 1.1) * (0.75 + 0.25 * n3));
      float stopX = ax - (SIDE_END + 0.5 + CW + GAP + 0.3);
      if (side == -cdir) paint = max(paint, lineAA(stopX, 0.25, fwAx));
      // División de carriles de la transversal
      float nl = max(2.0, floor(W / 3.2));
      float lwc = W / nl;
      float u = lz / lwc;
      float k = floor(u + 0.5);
      if (k >= 1.0 && k <= nl - 1.0 && cwx > CW + GAP + 1.0) paint = max(paint, lineAA((u - k) * lwc, 0.07, fwS) * pulse(p.x / 9.0, 3.0 / 9.0, fwAx / 9.0));
    } else {
      col = vec3(0.22, 0.215, 0.2);
    }
  }

  // Cordón: canaleta más oscura junto a los bordes
  if (!inCross) {
    float g = 1e3;
    g = min(g, abs(ax - ISLAND));
    g = min(g, abs(ax - BUS_END));
    g = min(g, abs(ax - SEPI_END));
    g = min(g, abs(ax - MAIN_END));
    g = min(g, abs(ax - SEPO_END));
    g = min(g, abs(ax - LAT_END));
    col *= 0.78 + 0.22 * smoothstep(0.05, 0.45, g);
  }

  paint *= 0.82 + 0.18 * n3;
  gRough = mix(gRough, 0.55, paint);
  return mix(col, paintCol, paint);
}
`,
      );
      s.fragmentShader = replaceChunk(s.fragmentShader, '#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= groundShade(vWP.xz);');
      s.fragmentShader = replaceChunk(s.fragmentShader, '#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = gRough;');
      // Al final: inserta varyings + utilidades GLSL antes de las funciones del asfalto.
      worldVaryings(s);
    });

    const span = CONFIG.world.sideExtent * 2 + 40;
    const geo = new PlaneGeometry(span, BLOCK * (CONFIG.world.chunksAhead + CONFIG.world.chunksBehind + 2), 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.ground = new Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    this.ground.name = 'ground';

    const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.curbs = new ChunkedLayer(box, makeCurbMaterial(), 6, slots, { castShadow: false });
    this.grass = new ChunkedLayer(box.clone(), makeGrassMaterial(), 6, slots, { castShadow: false });
    this.sidewalks = new ChunkedLayer(box.clone(), makeSidewalkMaterial(), 4, slots, { castShadow: false });
    this.curbs.mesh.name = 'curbs';
    this.grass.mesh.name = 'grass';
    this.sidewalks.mesh.name = 'sidewalks';
    this.layers = [this.curbs, this.grass, this.sidewalks];
  }

  get meshes(): Mesh[] {
    return [this.ground, ...this.layers.map((l) => l.mesh)];
  }

  /** El plano se mueve con el jugador (el shader trabaja en coordenadas de mundo). */
  follow(z: number, travelDir: number): void {
    const len = (this.ground.geometry as PlaneGeometry).parameters.height;
    this.ground.position.z = z + travelDir * (len * 0.5 - BLOCK * 2);
  }

  buildChunk(slot: number, info: ChunkInfo): void {
    for (const l of this.layers) l.beginSlot(slot);
    const zA = info.blockStart;
    const zB = info.blockEnd;
    const len = zA - zB;
    const zc = (zA + zB) / 2;
    const ext = CONFIG.world.sideExtent;

    for (const side of [1, -1]) {
      // Canteros (separadores con césped)
      for (const [a, b] of [
        [X.busEnd, X.sepInnerEnd],
        [X.mainEnd, X.sepOuterEnd],
      ]) {
        const cx = side * (a + b) * 0.5;
        const w = b - a;
        this.curbs.add(cx, 0, zc, 0, w, 0.2, len);
        this.grass.add(cx, 0, zc, 0, w - 0.36, 0.24, len - 0.36);
      }
      // Manzana: vereda + baldosas bajo los edificios + veredas de transversales.
      const z1 = info.zCrossEnd;
      const z2 = info.z0 - BLOCK;
      this.sidewalks.add(side * (X.lateralEnd + ext) * 0.5, 0, (z1 + z2) / 2, 0, ext - X.lateralEnd, 0.16, z1 - z2);
    }
    // Isla central del Metrobus
    this.sidewalks.add(0, 0, zc, 0, X.island * 2, 0.22, len);
    for (const l of this.layers) {
      l.endSlot();
      l.flush();
    }
  }
}
