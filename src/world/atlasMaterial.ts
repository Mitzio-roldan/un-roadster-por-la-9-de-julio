import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Side } from 'three';
import { patchMaterial, replaceChunk } from '../core/shaderPatch';
import type { Atlas } from './textures';

/** Uniforms globales de animación para pantallas LED y luminosidad nocturna. */
export const signUniforms = {
  uTime: { value: 0 },
  /** Multiplicador de brillo de pantallas/carteles iluminados (sube de noche → bloom). */
  uGlow: { value: 1 },
};

/**
 * Material que muestra UNA celda del atlas por instancia (atributo `aTile`).
 * Con `animated`, el atributo `aAnim` elige una animación tipo pantalla LED:
 * 0 = fijo, 1 = brillo que barre, 2 = marquesina, 3 = pulso de color.
 */
export function makeAtlasMaterial(
  atlas: Atlas,
  opts: { lit?: boolean; animated?: boolean; side?: Side; key: string; roughness?: number },
): MeshBasicMaterial | MeshStandardMaterial {
  const mat = opts.lit
    ? new MeshStandardMaterial({ map: atlas.texture, roughness: opts.roughness ?? 0.55, metalness: 0.05, side: opts.side ?? DoubleSide })
    : new MeshBasicMaterial({ map: atlas.texture, side: opts.side ?? DoubleSide });
  const { cols, rows } = atlas;
  return patchMaterial(mat, `atlas-${opts.key}-${cols}x${rows}-${opts.animated ? 'a' : 's'}-${opts.lit ? 'l' : 'b'}`, (s) => {
    s.uniforms.uTime = signUniforms.uTime;
    s.uniforms.uGlow = signUniforms.uGlow;
    s.vertexShader = replaceChunk(
      s.vertexShader,
      '#include <common>',
      `#include <common>
attribute float aTile;
${opts.animated ? 'attribute float aAnim;' : ''}
varying vec2 vLocalUv;
varying float vTile;
varying float vAnim;`,
    );
    s.vertexShader = replaceChunk(
      s.vertexShader,
      '#include <uv_vertex>',
      `#include <uv_vertex>
  vLocalUv = uv;
  vTile = aTile;
  vAnim = ${opts.animated ? 'aAnim' : '0.0'};`,
    );
    s.fragmentShader = replaceChunk(
      s.fragmentShader,
      '#include <common>',
      `#include <common>
uniform float uTime;
uniform float uGlow;
varying vec2 vLocalUv;
varying float vTile;
varying float vAnim;
vec2 atlasUv(vec2 luv) {
  float c = mod(vTile, ${cols}.0);
  float r = floor(vTile / ${cols}.0);
  return vec2((c + luv.x) / ${cols}.0, (${rows}.0 - r - 1.0 + luv.y) / ${rows}.0);
}`,
    );
    s.fragmentShader = replaceChunk(
      s.fragmentShader,
      '#include <map_fragment>',
      `
  vec2 luv = clamp(vLocalUv, 0.002, 0.998);
  ${opts.animated ? `if (vAnim > 1.5 && vAnim < 2.5) luv.x = fract(luv.x + uTime * 0.12);` : ''}
  vec4 sampledDiffuseColor = texture2D(map, atlasUv(luv));
  diffuseColor *= sampledDiffuseColor;
  ${
    opts.animated
      ? `
  if (vAnim > 0.5 && vAnim < 1.5) {
    float sw = fract(vLocalUv.x * 0.7 + vLocalUv.y * 0.3 - uTime * 0.35);
    diffuseColor.rgb += vec3(smoothstep(0.06, 0.0, abs(sw - 0.5))) * 0.6;
  } else if (vAnim > 2.5) {
    float h = 0.5 + 0.5 * sin(uTime * 2.2 + vTile);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(1.25, 0.8, 1.3), h);
  }
  // rejilla de LEDs
  vec2 px = fract(vLocalUv * vec2(160.0, 90.0));
  float ledFade = 1.0 - smoothstep(0.25, 0.6, fwidth(vLocalUv.x * 160.0));
  diffuseColor.rgb *= 1.0 - ledFade * 0.25 * (1.0 - smoothstep(0.5, 0.2, length(px - 0.5)));`
      : ''
  }
  ${opts.lit ? '' : 'diffuseColor.rgb *= uGlow;'}`,
    );
  });
}
