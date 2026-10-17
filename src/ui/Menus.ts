import type { QualityLevel } from '../config';
import { isTouchDevice } from './device';
import { enterFullscreen, fullscreenSupported, isFullscreen, onFullscreenChange, toggleFullscreen } from './fullscreen';
import { shareOnX } from './share';

export interface MenuCallbacks {
  onPlay(): void;
  onRetry(): void;
  onContinue(): void;
  onResume(): void;
  onQuit(): void;
  onPause(): void;
  onToggleNight(): void;
  onToggleMute(): void;
  onQuality(q: QualityLevel | 'auto'): void;
  getState(): { night: boolean; muted: boolean; quality: QualityLevel | 'auto' };
}

export interface GameOverInfo {
  score: number;
  best: number;
  newRecord: boolean;
  distance: number;
  maxKmh: number;
  canContinue: boolean;
}

type Screen = 'menu' | 'controls' | 'pause' | 'gameover';

const QUALITY_LABEL: Record<QualityLevel | 'auto', string> = { auto: 'Auto', high: 'Alta', medium: 'Media', low: 'Baja' };
const fmt = (n: number) => Math.floor(n).toLocaleString('es-AR');

const PC_CONTROLS = `
  <div class="ctl"><kbd>W</kbd><kbd>↑</kbd><span>Acelerar</span></div>
  <div class="ctl"><kbd>S</kbd><kbd>↓</kbd><span>Frenar / reversa</span></div>
  <div class="ctl"><kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd><span>Girar</span></div>
  <div class="ctl"><kbd class="wide">Espacio</kbd><span>Salto</span></div>
  <div class="ctl"><kbd class="wide">Espacio ×2</kbd><span>Salto con giro 360°</span></div>
  <div class="ctl"><kbd class="wide">Shift</kbd><kbd>F</kbd><span>Propulsores traseros</span></div>
  <div class="ctl"><kbd>C</kbd><span>Cámara persecución / capó</span></div>
  <div class="ctl"><kbd>N</kbd><span>Atardecer / noche</span></div>
  <div class="ctl"><kbd>M</kbd><span>Sonido</span></div>
  <div class="ctl"><kbd>Esc</kbd><kbd>P</kbd><span>Pausa</span></div>`;
const MOBILE_CONTROLS = `
  <div class="ctl"><i class="ic stick"></i><span>Joystick izquierdo: dirección</span></div>
  <div class="ctl"><i class="ic gas"></i><span>ACELERAR / FRENO (mantener)</span></div>
  <div class="ctl"><i class="ic jump"></i><span>SALTO · doble toque = giro 360°</span></div>
  <div class="ctl"><i class="ic boost"></i><span>PROPULSORES (mantener)</span></div>
  <div class="ctl"><i class="ic multi"></i><span>Multitouch: acelerá, girá y usá propulsores a la vez</span></div>
  <p class="hint">Jugá con el celular en horizontal.</p>`;

/** Pantallas: inicio, controles, pausa y game over (+ botones flotantes). */
export class Menus {
  private readonly root: HTMLDivElement;
  private readonly screens: Record<Screen, HTMLDivElement>;
  private readonly corner: HTMLDivElement;
  private current: Screen | null = null;
  private last: GameOverInfo | null = null;
  private controlsMobile = isTouchDevice();
  private controlsBack: Screen = 'menu';

  constructor(container: HTMLElement, private readonly cb: MenuCallbacks) {
    const r = (this.root = document.createElement('div'));
    r.className = 'menus';
    r.innerHTML = `
      <section class="screen s-menu">
        <div class="brand">
          <div class="brand-kicker">Buenos Aires · octubre · 19:12</div>
          <h1>SUBITE A UN ROADSTER <span>EN LA 9 DE JULIO</span></h1>
          <div class="brand-sub">Hiperdeportivo eléctrico · propulsores de aire · la avenida más ancha del mundo</div>
        </div>
        <div class="menu-actions">
          <button class="btn primary" data-a="play">JUGAR</button>
          <button class="btn" data-a="controls">CONTROLES</button>
        </div>
        <div class="settings"></div>
        <div class="menu-best"></div>
      </section>
      <section class="screen s-controls panel">
        <h2>CONTROLES</h2>
        <div class="tabs"><button data-a="tab-pc">PC</button><button data-a="tab-mobile">Celular</button></div>
        <div class="ctl-list"></div>
        <button class="btn" data-a="back">VOLVER</button>
      </section>
      <section class="screen s-pause panel">
        <h2>PAUSA</h2>
        <button class="btn primary" data-a="resume">CONTINUAR</button>
        <button class="btn" data-a="retry">REINICIAR</button>
        <button class="btn" data-a="controls">CONTROLES</button>
        <div class="settings"></div>
        <button class="btn ghost" data-a="quit">MENÚ PRINCIPAL</button>
      </section>
      <section class="screen s-gameover panel">
        <div class="go-kicker">CHOQUE</div>
        <div class="go-score">0</div>
        <div class="go-record"></div>
        <div class="go-stats"></div>
        <button class="btn primary" data-a="retry">REINTENTAR</button>
        <button class="btn" data-a="continue">CONTINUAR DESDE EL OBELISCO</button>
        <button class="btn x" data-a="share"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.9-6.4L6.3 22H3.2l7.3-8.3L1 2h6.3l4.4 5.9L18.9 2Zm-1.1 18.1h1.7L6.4 3.8H4.6l13.2 16.3Z"/></svg> COMPARTIR EN X</button>
        <button class="btn ghost" data-a="quit">MENÚ</button>
      </section>
      <footer class="legal">Proyecto de fans, no afiliado a ninguna marca automotriz. Auto inspirado en un hiperdeportivo eléctrico presentado en 2026. Marcas de publicidad inventadas.</footer>
      <div class="rotate"><div class="rotate-phone"></div><p>Girá el celular para jugar en horizontal</p></div>`;
    container.appendChild(r);
    this.screens = {
      menu: r.querySelector('.s-menu')!,
      controls: r.querySelector('.s-controls')!,
      pause: r.querySelector('.s-pause')!,
      gameover: r.querySelector('.s-gameover')!,
    };

    // Botones flotantes durante el juego (pausa y sonido)
    this.corner = document.createElement('div');
    this.corner.className = 'corner hidden';
    this.corner.innerHTML = `<button class="cbtn" data-a="fs" aria-label="Pantalla completa">⛶</button><button class="cbtn" data-a="mute" aria-label="Sonido"></button><button class="cbtn" data-a="pause" aria-label="Pausa">❚❚</button>`;
    container.appendChild(this.corner);

    const onClick = (e: Event) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!t) return;
      const a = t.dataset.a!;
      switch (a) {
        case 'play':
          // En celular, entrar a pantalla completa con el mismo toque de "Jugar"
          if (isTouchDevice()) void enterFullscreen();
          cb.onPlay();
          break;
        case 'retry':
          cb.onRetry();
          break;
        case 'continue':
          cb.onContinue();
          break;
        case 'resume':
          cb.onResume();
          break;
        case 'quit':
          cb.onQuit();
          break;
        case 'pause':
          cb.onPause();
          break;
        case 'controls':
          this.controlsBack = this.current === 'pause' ? 'pause' : 'menu';
          this.show('controls');
          break;
        case 'back':
          this.show(this.controlsBack);
          break;
        case 'tab-pc':
          this.controlsMobile = false;
          this.renderControls();
          break;
        case 'tab-mobile':
          this.controlsMobile = true;
          this.renderControls();
          break;
        case 'night':
          cb.onToggleNight();
          break;
        case 'fs':
          void toggleFullscreen();
          break;
        case 'mute':
          cb.onToggleMute();
          this.refresh();
          break;
        case 'quality': {
          const order: (QualityLevel | 'auto')[] = ['auto', 'high', 'medium', 'low'];
          const q = cb.getState().quality;
          cb.onQuality(order[(order.indexOf(q) + 1) % order.length]);
          break;
        }
        case 'share':
          if (this.last) shareOnX(this.last.score, this.last.maxKmh, this.last.distance);
          break;
      }
    };
    r.addEventListener('click', onClick);
    this.corner.addEventListener('click', onClick);
    for (const el of [r, this.corner]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.renderControls();
    this.refresh();
    onFullscreenChange(() => this.refresh());
    this.corner.querySelector<HTMLElement>('[data-a="fs"]')!.hidden = !fullscreenSupported();
  }

  show(s: Screen | null): void {
    this.current = s;
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('on', k === s);
    this.root.classList.toggle('open', s !== null);
    this.root.classList.toggle('home', s === 'menu' || (s === 'controls' && this.controlsBack === 'menu'));
    this.corner.classList.toggle('hidden', s !== null);
    if (s === 'menu') this.updateBest();
    this.refresh();
    // Foco en el botón principal para jugar con Enter/teclado
    const primary = s ? this.screens[s].querySelector<HTMLButtonElement>('.btn.primary') : null;
    primary?.focus({ preventScroll: true });
  }

  showGameOver(info: GameOverInfo): void {
    this.last = info;
    const s = this.screens.gameover;
    s.querySelector('.go-score')!.textContent = fmt(info.score);
    const rec = s.querySelector('.go-record')!;
    rec.textContent = info.newRecord ? '¡NUEVO RÉCORD!' : `Récord: ${fmt(info.best)}`;
    rec.classList.toggle('new', info.newRecord);
    s.querySelector('.go-stats')!.innerHTML = `<div><b>${(info.distance / 1000).toFixed(2)} km</b><span>distancia</span></div><div><b>${Math.round(info.maxKmh)} km/h</b><span>vel. máxima</span></div>`;
    (s.querySelector('[data-a="continue"]') as HTMLElement).style.display = info.canContinue ? '' : 'none';
    this.show('gameover');
  }

  private updateBest(): void {
    let best = 0;
    try {
      best = Number(localStorage.getItem('ndjr.best')) || 0;
    } catch {
      /* sin storage */
    }
    this.screens.menu.querySelector('.menu-best')!.textContent = best > 0 ? `Récord: ${fmt(best)}` : '';
  }

  private renderControls(): void {
    const s = this.screens.controls;
    s.querySelector('.ctl-list')!.innerHTML = this.controlsMobile ? MOBILE_CONTROLS : PC_CONTROLS;
    s.querySelector('[data-a="tab-pc"]')!.classList.toggle('on', !this.controlsMobile);
    s.querySelector('[data-a="tab-mobile"]')!.classList.toggle('on', this.controlsMobile);
  }

  /** Refresca los toggles (noche, sonido, calidad). */
  refresh(): void {
    const st = this.cb.getState();
    const fs = fullscreenSupported();
    const html = `
      <button class="chip" data-a="night">${st.night ? '🌙 Noche' : '🌇 Atardecer'}</button>
      <button class="chip" data-a="quality">Calidad: ${QUALITY_LABEL[st.quality]}</button>
      <button class="chip" data-a="mute">${st.muted ? '🔇 Sonido' : '🔊 Sonido'}</button>${fs ? `<button class="chip" data-a="fs">${isFullscreen() ? '⛶ Salir de pantalla completa' : '⛶ Pantalla completa'}</button>` : ''}`;
    for (const el of this.root.querySelectorAll('.settings')) el.innerHTML = html;
    const mute = this.corner.querySelector('[data-a="mute"]')!;
    mute.textContent = st.muted ? '🔇' : '🔊';
  }
}
