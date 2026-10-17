import type { Object3D } from 'three';
import { CONFIG } from '../config';
import type { Player } from './Player';

/**
 * Loader OPCIONAL de modelos .glb para reemplazar el auto procedural más
 * adelante. Si `CONFIG.models.playerCarUrl` está vacío no se descarga nada
 * (GLTFLoader se importa de forma diferida, fuera del bundle principal).
 *
 * El modelo debe mirar hacia −Z, con el piso en y = 0 y medir ~4,6 m de largo.
 * Las ruedas, el alerón y los chorros procedurales siguen funcionando.
 */
export async function loadOptionalCarModel(player: Player, url: string = CONFIG.models.playerCarUrl): Promise<Object3D | null> {
  if (!url) return null;
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    model.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    player.replaceBody(model);
    return model;
  } catch (err) {
    console.warn('[models] No se pudo cargar el modelo .glb; se usa el procedural.', err);
    return null;
  }
}
