import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { atmosphereUniforms } from '../fx/atmosphere';

type Patch = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void;

interface PatchData {
  patches: Patch[];
  keys: string[];
}

/**
 * Encadena modificaciones de shader sobre materiales estándar de Three.
 * Cada patch tiene una clave única para que Three no reutilice programas
 * compilados entre materiales con shaders distintos. Todos los materiales
 * reciben además los uniforms de la niebla atmosférica (ver fx/atmosphere.ts).
 */
export function patchMaterial<T extends Material>(mat: T, key: string, patch?: Patch): T {
  const ud = mat.userData as { patchData?: PatchData };
  if (!ud.patchData) {
    const data: PatchData = { patches: [], keys: [] };
    ud.patchData = data;
    mat.onBeforeCompile = (shader, renderer) => {
      Object.assign(shader.uniforms, atmosphereUniforms);
      for (const p of data.patches) p(shader, renderer);
    };
    mat.customProgramCacheKey = () => data.keys.join('|') || 'atm';
  }
  if (patch && !ud.patchData.keys.includes(key)) {
    ud.patchData.patches.push(patch);
    ud.patchData.keys.push(key);
  }
  mat.needsUpdate = true;
  return mat;
}

/** Asegura que el material tenga los uniforms de niebla atmosférica. */
export function ensureAtmosphere(mat: Material): void {
  const ud = mat.userData as { patchData?: PatchData };
  if (!ud.patchData) patchMaterial(mat, 'atm');
}

/** Reemplazo de string que falla en desarrollo si el chunk no existe. */
export function replaceChunk(src: string, find: string, replacement: string): string {
  if (import.meta.env.DEV && !src.includes(find)) console.warn(`[shaderPatch] chunk no encontrado: ${find}`);
  return src.replace(find, replacement);
}
