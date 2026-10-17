import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RepeatWrapping, RGBAFormat, type WebGLProgramParametersWithUniforms } from 'three';
import { patchMaterial, replaceChunk } from '../core/shaderPatch';

/**
 * Textura de ruido de valor tileable (256², 32 celdas): reemplaza al ruido
 * procedural en los shaders del mundo. Una lectura de textura (con mipmaps,
 * que además evita aliasing a distancia) cuesta mucho menos que 4 hashes +
 * interpolación por píxel, clave en GPUs integradas y celulares.
 */
let noiseTex: DataTexture | null = null;
export function getNoiseTexture(): DataTexture {
  if (noiseTex) return noiseTex;
  const N = 256;
  const CELLS = 32;
  const lattice = (period: number, seed: number) => {
    const a = new Float32Array(period * period);
    let x = seed;
    for (let i = 0; i < a.length; i++) {
      x = (x * 1664525 + 1013904223) >>> 0;
      a[i] = x / 4294967296;
    }
    return a;
  };
  const sample = (lat: Float32Array, period: number, u: number, v: number) => {
    const x = u * period;
    const y = v * period;
    const i = Math.floor(x);
    const j = Math.floor(y);
    let fx = x - i;
    let fy = y - j;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const g = (a: number, b: number) => lat[((b % period) + period) % period * period + (((a % period) + period) % period)];
    const top = g(i, j) + (g(i + 1, j) - g(i, j)) * fx;
    const bot = g(i, j + 1) + (g(i + 1, j + 1) - g(i, j + 1)) * fx;
    return top + (bot - top) * fy;
  };
  const l1 = lattice(CELLS, 7);
  const l2 = lattice(CELLS, 91);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const k = (y * N + x) * 4;
      data[k] = Math.round(sample(l1, CELLS, u, v) * 255);
      data[k + 1] = Math.round(sample(l2, CELLS, u, v) * 255);
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
  }
  noiseTex = new DataTexture(data, N, N, RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = RepeatWrapping;
  noiseTex.magFilter = LinearFilter;
  noiseTex.minFilter = LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

/** GLSL compartido: ruido (textura), ondas antialiasadas y cajas. */
export const GLSL_UTILS = /* glsl */ `
uniform sampler2D uNoiseTex;
float gHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// Ruido de valor: 1 unidad = 1 celda (igual escala que la versión procedural).
float gNoise(vec2 p) { return texture2D(uNoiseTex, p * (1.0 / 32.0)).r; }
// Tren de pulsos filtrado (sin aliasing a distancia): x en periodos, d = ciclo de trabajo.
float pulseInt(float x, float d) { return floor(x) * d + min(fract(x), d); }
float pulse(float x, float d, float w) {
  w = max(w, 1e-4);
  return clamp((pulseInt(x + 0.5 * w, d) - pulseInt(x - 0.5 * w, d)) / w, 0.0, 1.0);
}
// Las derivadas (fw) se pasan desde una coordenada CONTINUA: calcular fwidth()
// sobre un fract() da saltos en el borde de cada celda y dibuja líneas fantasma.
float lineAA(float dist, float hw, float fw) {
  fw = max(fw, 1e-4);
  return 1.0 - smoothstep(hw - fw, hw + fw, abs(dist));
}
float boxAA(vec2 p, vec2 a, vec2 b, vec2 fw) {
  fw = max(fw, vec2(1e-4));
  vec2 s = smoothstep(a - fw, a + fw, p) * (1.0 - smoothstep(b - fw, b + fw, p));
  return s.x * s.y;
}
`;

/**
 * Agrega varyings de posición y normal en mundo (compatibles con instancing)
 * para shaders que pintan en coordenadas de mundo.
 */
export function worldVaryings(shader: WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uNoiseTex = { value: getNoiseTexture() };
  shader.vertexShader = replaceChunk(shader.vertexShader, '#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;');
  shader.vertexShader = replaceChunk(
    shader.vertexShader,
    '#include <project_vertex>',
    `#include <project_vertex>
  {
    #ifdef USE_INSTANCING
      mat4 wm = modelMatrix * instanceMatrix;
    #else
      mat4 wm = modelMatrix;
    #endif
    vWP = (wm * vec4(transformed, 1.0)).xyz;
    vWN = normalize(mat3(wm) * objectNormal);
  }`,
  );
  shader.fragmentShader = replaceChunk(shader.fragmentShader, '#include <common>', `#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\n${GLSL_UTILS}`);
}

/** Baldosas porteñas grises (tapa) + cordón de hormigón (laterales). */
export function makeSidewalkMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  return patchMaterial(m, 'sidewalk', (s) => {
    worldVaryings(s);
    s.fragmentShader = replaceChunk(
      s.fragmentShader,
      '#include <map_fragment>',
      `#include <map_fragment>
  {
    vec3 curb = vec3(0.36, 0.35, 0.33) * (0.85 + 0.2 * gNoise(vWP.xz * 3.0 + vWP.y * 5.0));
    vec2 t = vWP.xz / 0.4;
    vec2 f = fract(t);
    float grout = 1.0 - boxAA(f, vec2(0.04), vec2(0.96), fwidth(t));
    // dibujo "vainilla" de 9 puntos de la baldosa porteña
    vec2 g = fract(t * 3.0) - 0.5;
    float dots = 1.0 - smoothstep(0.17, 0.24, length(g));
    float tile = gHash(floor(t));
    vec3 base = vec3(0.30, 0.295, 0.28) * (0.88 + 0.22 * tile) * (0.9 + 0.15 * gNoise(vWP.xz * 0.6));
    base *= 1.0 - dots * 0.12;
    base = mix(base, vec3(0.16, 0.155, 0.15), grout * 0.85);
    float top = step(0.5, vWN.y);
    diffuseColor.rgb *= mix(curb, base, top);
  }`,
    );
  });
}

/** Cordón de canteros: hormigón claro con suciedad abajo. */
export function makeCurbMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  return patchMaterial(m, 'curb', (s) => {
    worldVaryings(s);
    s.fragmentShader = replaceChunk(
      s.fragmentShader,
      '#include <map_fragment>',
      `#include <map_fragment>
  {
    float n = gNoise(vWP.xz * 2.0 + vWP.y * 9.0);
    vec3 c = vec3(0.42, 0.41, 0.39) * (0.82 + 0.25 * n);
    c *= mix(0.55, 1.0, smoothstep(0.0, 0.16, vWP.y));
    diffuseColor.rgb *= c;
  }`,
    );
  });
}

/** Césped de cantero con pétalos de jacarandá caídos (octubre). */
export function makeGrassMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  return patchMaterial(m, 'grass', (s) => {
    worldVaryings(s);
    s.fragmentShader = replaceChunk(
      s.fragmentShader,
      '#include <map_fragment>',
      `#include <map_fragment>
  {
    vec2 p = vWP.xz;
    float n = gNoise(p * 0.5) * 0.6 + gNoise(p * 3.1) * 0.4;
    vec3 grass = mix(vec3(0.05, 0.11, 0.03), vec3(0.12, 0.2, 0.05), n);
    float petals = smoothstep(0.62, 0.8, gNoise(p * 0.45 + 3.0)) * step(0.55, gHash(floor(p * 9.0)));
    petals += smoothstep(0.7, 0.9, gNoise(p * 0.3 - 7.0)) * 0.6;
    grass = mix(grass, vec3(0.32, 0.17, 0.55), clamp(petals, 0.0, 1.0) * 0.85);
    vec3 side = vec3(0.09, 0.07, 0.05);
    diffuseColor.rgb *= mix(side, grass, step(0.5, vWN.y));
  }`,
    );
  });
}

export const PALETTE = {
  graphite: new Color('#3a3e45'),
  orange: new Color('#ff6a1a'),
  cyan: new Color('#2ef2ff'),
};
