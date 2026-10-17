/**
 * Velocímetro circular SVG: aguja animada, arco de progreso, número digital y
 * zona roja por encima de 330 km/h. Con propulsores la aguja se pone cian.
 */
const NS = 'http://www.w3.org/2000/svg';
const MAX = 400;
const RED_FROM = 330;
const START = 150;
const SWEEP = 240;
const C = 100;

const ang = (v: number) => START + (Math.min(Math.max(v, 0), MAX) / MAX) * SWEEP;
const pt = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};
function arc(r: number, a0: number, a1: number): string {
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export class Speedometer {
  readonly root: SVGSVGElement;
  private readonly needle: SVGGElement;
  private readonly value: SVGPathElement;
  private readonly digits: SVGTextElement;
  private readonly arcLen: number;
  private shown = -1;
  private needleV = 0;

  constructor() {
    const svg = (this.root = el('svg', { viewBox: '0 0 200 200', class: 'speedo' }));
    const defs = el('defs', {}, svg);
    const grad = el('linearGradient', { id: 'spdGrad', x1: '0', y1: '1', x2: '1', y2: '0' }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffffff', 'stop-opacity': '0.55' }, grad);
    el('stop', { offset: '0.75', 'stop-color': '#ffb070' }, grad);
    el('stop', { offset: '1', 'stop-color': '#ff6a1a' }, grad);

    el('circle', { cx: C, cy: C, r: 96, class: 'speedo-bg' }, svg);
    el('path', { d: arc(84, START, START + SWEEP), class: 'speedo-track' }, svg);
    el('path', { d: arc(84, ang(RED_FROM), START + SWEEP), class: 'speedo-red' }, svg);
    this.value = el('path', { d: arc(84, START, START + SWEEP), class: 'speedo-value', stroke: 'url(#spdGrad)' }, svg);
    this.arcLen = (84 * SWEEP * Math.PI) / 180;
    this.value.style.strokeDasharray = `${this.arcLen}`;
    this.value.style.strokeDashoffset = `${this.arcLen}`;

    // Marcas cada 10 km/h, mayores cada 50 y números cada 100
    for (let v = 0; v <= MAX; v += 10) {
      const major = v % 50 === 0;
      const a = ang(v);
      const [x0, y0] = pt(major ? 66 : 70, a);
      const [x1, y1] = pt(75, a);
      el('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: `speedo-tick${major ? ' major' : ''}${v > RED_FROM ? ' red' : ''}` }, svg);
      if (v % 100 === 0) {
        const [tx, ty] = pt(54, a);
        const t = el('text', { x: tx, y: ty + 4, class: 'speedo-num' }, svg);
        t.textContent = String(v);
      }
    }

    this.needle = el('g', { class: 'speedo-needle' }, svg);
    el('path', { d: `M ${C - 10} ${C - 2.2} L ${C + 78} ${C - 0.6} L ${C + 78} ${C + 0.6} L ${C - 10} ${C + 2.2} Z` }, this.needle);
    el('circle', { cx: C, cy: C, r: 7, class: 'speedo-hub' }, svg);

    this.digits = el('text', { x: C, y: C + 42, class: 'speedo-digits' }, svg);
    this.digits.textContent = '0';
    const unit = el('text', { x: C, y: C + 58, class: 'speedo-unit' }, svg);
    unit.textContent = 'km/h';
  }

  update(kmh: number, boost: boolean, dt: number): void {
    // Aguja con un poco de inercia
    this.needleV += (kmh - this.needleV) * (1 - Math.exp(-14 * dt));
    this.needle.setAttribute('transform', `rotate(${ang(this.needleV).toFixed(2)} ${C} ${C})`);
    const k = Math.min(this.needleV, MAX) / MAX;
    this.value.style.strokeDashoffset = `${(this.arcLen * (1 - k)).toFixed(1)}`;
    this.root.classList.toggle('boost', boost);
    this.root.classList.toggle('redline', kmh > RED_FROM);
    const v = Math.round(kmh);
    if (v !== this.shown) {
      this.shown = v;
      this.digits.textContent = String(v);
    }
  }
}
