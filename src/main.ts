import './ui/style.css';
import { Game } from './game/Game';
import { loadOptionalCarModel } from './entities/models';
import { isTouchDevice } from './ui/device';

/**
 * Punto de entrada: espera las fuentes (los carteles se dibujan con texto en
 * canvas), crea el juego y oculta la pantalla de carga.
 */
async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  if (isTouchDevice()) document.body.classList.add('touch-ui');
  const bootEl = document.getElementById('boot');

  // Prevenir zoom, scroll y menú contextual durante el juego (mobile)
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop);
  document.addEventListener('contextmenu', stop);
  document.addEventListener('dblclick', stop);
  document.addEventListener('touchmove', (e) => {
    if (!(e.target as HTMLElement).closest('.panel')) e.preventDefault();
  }, { passive: false });

  if (!webglAvailable()) {
    bootEl!.innerHTML = '<div class="boot-title">Tu navegador no soporta <span>WebGL2</span></div>';
    return;
  }
  // Si las fuentes fallan (bloqueadas por el navegador o la red), el juego arranca igual con la tipografía de respaldo
  const fonts = Promise.all([
    document.fonts.load('700 40px "Barlow Condensed"'),
    document.fonts.load('800 40px "Barlow Condensed"'),
    document.fonts.load('500 20px "Barlow Condensed"'),
  ]).catch(() => undefined);
  await Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]);

  let game: Game;
  try {
    game = new Game(app);
    game.start();
  } catch (err) {
    console.error(err);
    bootEl!.innerHTML = '<div class="boot-title">No se pudo iniciar <span>el juego</span></div><p style="text-align:center;opacity:.7;padding:0 24px">Probá abrir el link en Chrome o Safari (el navegador interno de algunas apps no soporta WebGL2).</p>';
    const detail = document.createElement('p');
    detail.style.cssText = 'text-align:center;opacity:.5;padding:0 24px;font-size:12px';
    detail.textContent = String((err as Error)?.message ?? err).slice(0, 160);
    bootEl!.appendChild(detail);
    return;
  }
  void loadOptionalCarModel(game.player);
  requestAnimationFrame(() => bootEl?.classList.add('hide'));
  setTimeout(() => bootEl?.remove(), 800);
  if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('og')) {
    // Título para la imagen Open Graph (scripts: ver README)
    const t = document.createElement('div');
    t.className = 'og-title';
    t.innerHTML = '<div class="brand-kicker">Juego 3D gratis · navegador · PC y celular</div><h1>SUBITE A UN ROADSTER <span>EN LA 9 DE JULIO</span></h1>';
    app.appendChild(t);
    document.querySelector<HTMLElement>('.corner')?.remove();
  }
}

function webglAvailable(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

void boot();
