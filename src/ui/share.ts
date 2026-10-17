import { CONFIG } from '../config';

/** Abre el intent de X/Twitter con el puntaje y el link del juego. */
export function shareOnX(score: number, maxKmh: number, distance: number): void {
  const km = (distance / 1000).toFixed(2);
  const text = `Hice ${score.toLocaleString('es-AR')} puntos en Un Roadster por la 9 de Julio 🏁 ${Math.round(maxKmh)} km/h y ${km} km por la 9 de Julio esquivando colectivos. ¿Me superás?`;
  const url = location.origin + location.pathname;
  const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}&hashtags=${encodeURIComponent(CONFIG.share.hashtags)}`;
  window.open(intent, '_blank', 'noopener,noreferrer');
}
