/** Teclado: estado de teclas por `code` (independiente del layout) y eventos de flanco. */
export class Keyboard {
  private readonly down = new Set<string>();
  private readonly pressed: string[] = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  isDown(...codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Teclas apretadas desde la última llamada (sin auto-repetición). */
  drainPressed(): string[] {
    return this.pressed.splice(0, this.pressed.length);
  }
}
