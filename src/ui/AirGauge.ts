/**
 * Medidor de aire comprimido: dos barras (una por tanque) con recarga
 * animada; parpadea en rojo si se intentó usar aire sin tener suficiente.
 */
export class AirGauge {
  readonly root: HTMLDivElement;
  private readonly fills: HTMLDivElement[] = [];
  private readonly last = [-1, -1];

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'air';
    this.root.innerHTML = `<div class="air-bars"></div><div class="air-label">AIRE</div>`;
    const bars = this.root.querySelector('.air-bars')!;
    for (let i = 0; i < 2; i++) {
      const b = document.createElement('div');
      b.className = 'air-bar';
      const f = document.createElement('div');
      f.className = 'air-fill';
      b.appendChild(f);
      bars.appendChild(b);
      this.fills.push(f);
    }
  }

  update(tanks: [number, number], fail: boolean): void {
    for (let i = 0; i < 2; i++) {
      const v = Math.round(tanks[i] * 100) / 100;
      if (v !== this.last[i]) {
        this.last[i] = v;
        this.fills[i].style.transform = `scaleY(${v})`;
        this.fills[i].parentElement!.classList.toggle('full', v >= 1);
        this.fills[i].parentElement!.classList.toggle('empty', v <= 0.02);
      }
    }
    this.root.classList.toggle('fail', fail);
  }
}
