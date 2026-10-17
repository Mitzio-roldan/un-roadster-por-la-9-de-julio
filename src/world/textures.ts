import { CanvasTexture, SRGBColorSpace, type WebGLRenderer } from 'three';
import { CONFIG } from '../config';

/**
 * Todas las texturas del juego se dibujan con Canvas 2D al arrancar:
 * carteles de calles, señales, pórticos, publicidades (marcas inventadas),
 * carteles de colectivos y marcas viales. Sin assets externos.
 */

export const FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

export interface Atlas {
  texture: CanvasTexture;
  cols: number;
  rows: number;
  /** Índices con nombre para ubicar celdas. */
  index: Record<string, number>;
}

let maxAniso = 4;
export function setMaxAnisotropy(renderer: WebGLRenderer): void {
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Escribe texto ajustando el ancho para que entre en `maxW`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 700): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > 8) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  ctx.fillText(text, x, y);
}

/* ------------------------------------------------------------------ */
/* Carteles de calles (verdes) y nombres de paradas de Metrobus          */
/* ------------------------------------------------------------------ */

export function makeStreetSignAtlas(): Atlas {
  const cols = 4;
  const rows = 8;
  const cw = 512;
  const ch = 128;
  const [c, ctx] = makeCanvas(cols * cw, rows * ch);
  const index: Record<string, number> = {};
  const cell = (i: number) => [(i % cols) * cw, Math.floor(i / cols) * ch] as const;

  const plate = (i: number, text: string, sub: string) => {
    const [x, y] = cell(i);
    ctx.fillStyle = '#0d5b36';
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = '#f2f2ee';
    ctx.lineWidth = 6;
    roundRect(ctx, x + 8, y + 8, cw - 16, ch - 16, 10);
    ctx.stroke();
    ctx.fillStyle = '#f7f7f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, text, x + cw / 2, y + ch * 0.46, cw - 60, 64, 700);
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = '#cfe8da';
    ctx.fillText(sub, x + cw / 2, y + ch * 0.82);
  };

  CONFIG.streets.forEach((s, i) => {
    plate(i, s.name, `${(i + 3) * 100}–${(i + 3) * 100 + 99}`);
    index[s.name] = i;
  });
  plate(15, 'Av. 9 de Julio', 'Carlos Pellegrini · Cerrito');
  index['9dejulio'] = 15;

  // Paradas de Metrobus (celdas 16+).
  CONFIG.streets.forEach((s, i) => {
    const [x, y] = cell(16 + i);
    const g = ctx.createLinearGradient(x, y, x, y + ch);
    g.addColorStop(0, '#1d2a33');
    g.addColorStop(1, '#0f171d');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cw, ch);
    ctx.fillStyle = '#2bbf8a';
    ctx.fillRect(x, y, 22, ch);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(x + 22, y, 10, ch);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9fe9cf';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText('METROBUS · PARADA', x + 52, y + 32);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, s.name === 'Av. Corrientes' ? 'Obelisco' : s.name, x + 52, y + 82, cw - 80, 56, 700);
    index[`station:${s.name}`] = 16 + i;
  });
  return { texture: toTexture(c), cols, rows, index };
}

/* ------------------------------------------------------------------ */
/* Señales viales (celdas cuadradas)                                     */
/* ------------------------------------------------------------------ */

export function makeRoadSignAtlas(): Atlas {
  const cols = 4;
  const rows = 2;
  const s = 256;
  const [c, ctx] = makeCanvas(cols * s, rows * s);
  const index: Record<string, number> = {};
  const at = (i: number) => [(i % cols) * s, Math.floor(i / cols) * s] as const;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 0: velocidad máxima 60
  {
    const [x, y] = at(0);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s * 0.47, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d0202a';
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = `700 118px ${FONT}`;
    ctx.fillText('60', x + s / 2, y + s / 2 + 6);
    index.speed = 0;
  }
  // 1: Metrobus carril exclusivo
  {
    const [x, y] = at(1);
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x + 6, y + 6, s - 12, s - 12, 18);
    ctx.fill();
    ctx.fillStyle = '#1a5fb4';
    roundRect(ctx, x + 16, y + 16, s - 32, s - 32, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 44px ${FONT}`;
    ctx.fillText('METROBUS', x + s / 2, y + 62);
    // pictograma de colectivo
    ctx.fillRect(x + 64, y + 96, 128, 62);
    ctx.fillStyle = '#1a5fb4';
    ctx.fillRect(x + 74, y + 104, 30, 22);
    ctx.fillRect(x + 113, y + 104, 30, 22);
    ctx.fillRect(x + 152, y + 104, 30, 22);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + 92, y + 164, 12, 0, Math.PI * 2);
    ctx.arc(x + 164, y + 164, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText('EXCLUSIVO', x + s / 2, y + 208);
    index.metrobus = 1;
  }
  // 2: prohibido girar a la izquierda
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s * 0.47, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 150, y + 190);
    ctx.lineTo(x + 150, y + 110);
    ctx.quadraticCurveTo(x + 150, y + 86, x + 126, y + 86);
    ctx.lineTo(x + 92, y + 86);
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(x + 64, y + 86);
    ctx.lineTo(x + 100, y + 58);
    ctx.lineTo(x + 100, y + 114);
    ctx.fill();
    ctx.strokeStyle = '#d0202a';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s * 0.4, 0, Math.PI * 2);
    ctx.moveTo(x + s / 2 - s * 0.28, y + s / 2 - s * 0.28);
    ctx.lineTo(x + s / 2 + s * 0.28, y + s / 2 + s * 0.28);
    ctx.stroke();
    index.noLeft = 2;
  }
  // 3: paso peatonal
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#1a5fb4';
    roundRect(ctx, x + 10, y + 10, s - 20, s - 20, 16);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y + 30);
    ctx.lineTo(x + s - 36, y + s - 40);
    ctx.lineTo(x + 36, y + s - 40);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(x + s / 2, y + 100, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y + 116);
    ctx.lineTo(x + s / 2 - 6, y + 160);
    ctx.lineTo(x + s / 2 - 26, y + 196);
    ctx.moveTo(x + s / 2 - 6, y + 160);
    ctx.lineTo(x + s / 2 + 22, y + 194);
    ctx.stroke();
    index.pedestrian = 3;
  }
  // 4: dorso gris de las señales
  {
    const [x, y] = at(4);
    ctx.fillStyle = '#8b9096';
    ctx.fillRect(x, y, s, s);
    index.back = 4;
  }
  // 5: "Contramano"
  {
    const [x, y] = at(5);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s * 0.47, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d0202a';
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 50, y + s / 2 - 20, s - 100, 40);
    index.noEntry = 5;
  }
  return { texture: toTexture(c), cols, rows, index };
}

/* ------------------------------------------------------------------ */
/* Pórticos de señalización                                              */
/* ------------------------------------------------------------------ */

export function makeGantryAtlas(): Atlas {
  const cols = 2;
  const rows = 4;
  const cw = 1024;
  const ch = 256;
  const [c, ctx] = makeCanvas(cols * cw, rows * ch);
  const index: Record<string, number> = {};
  const entries: { key: string; bg: string; lines: [string, string]; arrow: 'up' | 'right' | 'left' }[] = [
    { key: 'retiro', bg: '#0e5a34', lines: ['RETIRO · PALERMO', 'Av. del Libertador'], arrow: 'up' },
    { key: 'constitucion', bg: '#0e5a34', lines: ['CONSTITUCIÓN', 'La Plata · AU 25 de Mayo'], arrow: 'up' },
    { key: 'au', bg: '#1a4f9c', lines: ['AU 25 DE MAYO', 'Ezeiza · Aeropuerto'], arrow: 'right' },
    { key: 'puerto', bg: '#0e5a34', lines: ['PUERTO MADERO', 'Costanera Sur'], arrow: 'left' },
    { key: 'metrobus', bg: '#1a4f9c', lines: ['METROBUS', 'Carril exclusivo · Centro'], arrow: 'up' },
    { key: 'obelisco', bg: '#0e5a34', lines: ['OBELISCO', 'Plaza de la República'], arrow: 'up' },
    { key: 'microcentro', bg: '#0e5a34', lines: ['MICROCENTRO', 'Plaza de Mayo'], arrow: 'right' },
    { key: 'velocidad', bg: '#1b1f24', lines: ['VELOCIDAD MÁXIMA 60', 'Control fotográfico'], arrow: 'up' },
  ];
  entries.forEach((e, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    ctx.fillStyle = e.bg;
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = '#f4f4f0';
    ctx.lineWidth = 8;
    roundRect(ctx, x + 12, y + 12, cw - 24, ch - 24, 14);
    ctx.stroke();
    // flecha
    ctx.save();
    ctx.translate(x + 120, y + ch / 2);
    ctx.rotate(e.arrow === 'up' ? 0 : e.arrow === 'right' ? Math.PI / 2 : -Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -78);
    ctx.lineTo(56, -14);
    ctx.lineTo(20, -14);
    ctx.lineTo(20, 74);
    ctx.lineTo(-20, 74);
    ctx.lineTo(-20, -14);
    ctx.lineTo(-56, -14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    fitText(ctx, e.lines[0], x + 230, y + 98, cw - 270, 96, 700);
    ctx.fillStyle = '#e0ece4';
    fitText(ctx, e.lines[1], x + 232, y + 186, cw - 270, 54, 500);
    index[e.key] = i;
  });
  return { texture: toTexture(c), cols, rows, index };
}

/* ------------------------------------------------------------------ */
/* Publicidades con marcas inventadas                                    */
/* ------------------------------------------------------------------ */

interface AdDef {
  brand: string;
  tag: string;
  bg: [string, string];
  fg: string;
  accent: string;
  motif: 'circle' | 'stripes' | 'bolt' | 'wave' | 'stars' | 'grid';
}

/** Marcas 100% inventadas para este proyecto. */
export const ADS: AdDef[] = [
  { brand: 'KOLIBRÍ COLA', tag: 'Refrescá la avenida', bg: ['#c8102e', '#7a0619'], fg: '#ffffff', accent: '#ffd23f', motif: 'wave' },
  { brand: 'MATE NÉBULA', tag: 'Energía yerbatera cósmica', bg: ['#2b0f4c', '#0f6b4a'], fg: '#d9ffe9', accent: '#b98cff', motif: 'stars' },
  { brand: 'ALFAJORES ÓRBITA', tag: 'Triple, como debe ser', bg: ['#4a2511', '#26120a'], fg: '#ffe2a8', accent: '#f0b44c', motif: 'circle' },
  { brand: 'ÑANDÚ PHONE 9', tag: 'Más rápido que la 9 de Julio', bg: ['#05070c', '#13202e'], fg: '#ffffff', accent: '#25e2ff', motif: 'grid' },
  { brand: 'LUNFARDO JEANS', tag: 'Vestite de barrio', bg: ['#1d3c6e', '#0d1d38'], fg: '#f4f1e8', accent: '#f08a24', motif: 'stripes' },
  { brand: 'FINANZAS TERO', tag: 'Cuidamos tu nido', bg: ['#0b4f8a', '#05284a'], fg: '#ffffff', accent: '#ffcf33', motif: 'circle' },
  { brand: 'VOLÁ TUCÁN', tag: 'Bariloche, Iguazú, Ushuaia', bg: ['#ff7a1a', '#c4370b'], fg: '#ffffff', accent: '#1f1f1f', motif: 'wave' },
  { brand: 'PIZZERÍA GRAVEDAD', tag: 'La muzza que no se cae', bg: ['#f2c14e', '#d9480f'], fg: '#2b1205', accent: '#ffffff', motif: 'circle' },
  { brand: 'CAFÉ PLASMA', tag: 'Despertá a 330 km/h', bg: ['#1a0f0a', '#4b2a1a'], fg: '#ffe6cf', accent: '#ff5fa2', motif: 'bolt' },
  { brand: 'TANGO STREAM', tag: 'Series para la noche porteña', bg: ['#3b0a57', '#12031f'], fg: '#ffffff', accent: '#ff3d7f', motif: 'grid' },
  { brand: 'SEGUROS ÁNCORA', tag: 'Tranqui, te cubrimos', bg: ['#e8eef3', '#b7c6d3'], fg: '#0b2a45', accent: '#0f7bd8', motif: 'stripes' },
  { brand: 'NEUMÁTICOS YAGUARETÉ', tag: 'Agarre de selva', bg: ['#151515', '#2e2e2e'], fg: '#ffcc00', accent: '#ffcc00', motif: 'stripes' },
  { brand: 'DULCE TÍA COCA', tag: 'El dulce de leche de siempre', bg: ['#f7e7c6', '#d9b98a'], fg: '#5a2d0c', accent: '#2f6eb5', motif: 'circle' },
  { brand: 'BONDIPASS', tag: 'Tu viaje, sin vueltas', bg: ['#00a37a', '#00664c'], fg: '#ffffff', accent: '#ffe14d', motif: 'bolt' },
  { brand: 'VOLTIO+', tag: 'La bebida que te carga', bg: ['#0a0a0a', '#1b2a00'], fg: '#c6ff00', accent: '#c6ff00', motif: 'bolt' },
  { brand: 'OBELISCO SONORO', tag: 'Festival · Noviembre 2026', bg: ['#ff2e63', '#08d9d6'], fg: '#ffffff', accent: '#252a34', motif: 'stars' },
];

export function makeAdAtlas(): Atlas {
  const cols = 4;
  const rows = 4;
  const cw = 512;
  const ch = 256;
  const [c, ctx] = makeCanvas(cols * cw, rows * ch);
  const index: Record<string, number> = {};
  ADS.forEach((ad, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cw, ch);
    ctx.clip();
    const g = ctx.createLinearGradient(x, y, x + cw, y + ch);
    g.addColorStop(0, ad.bg[0]);
    g.addColorStop(1, ad.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cw, ch);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = ad.accent;
    ctx.strokeStyle = ad.accent;
    switch (ad.motif) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(x + cw * 0.82, y + ch * 0.5, ch * 0.62, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'stripes':
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-0.5);
        for (let k = -10; k < 20; k++) ctx.fillRect(k * 54, -ch, 22, ch * 3);
        ctx.restore();
        break;
      case 'bolt':
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(x + cw * 0.86, y + 10);
        ctx.lineTo(x + cw * 0.72, y + ch * 0.55);
        ctx.lineTo(x + cw * 0.82, y + ch * 0.55);
        ctx.lineTo(x + cw * 0.7, y + ch - 10);
        ctx.lineTo(x + cw * 0.96, y + ch * 0.4);
        ctx.lineTo(x + cw * 0.86, y + ch * 0.4);
        ctx.closePath();
        ctx.fill();
        break;
      case 'wave':
        ctx.lineWidth = 18;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          for (let t = 0; t <= cw; t += 8) ctx.lineTo(x + t, y + ch * (0.7 + k * 0.12) + Math.sin(t / 50 + k) * 16);
          ctx.stroke();
        }
        break;
      case 'stars':
        for (let k = 0; k < 40; k++) {
          const sx = x + ((k * 97) % cw);
          const sy = y + ((k * 53) % ch);
          ctx.beginPath();
          ctx.arc(sx, sy, 2 + (k % 4), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'grid':
        ctx.lineWidth = 2;
        for (let k = 0; k < cw; k += 32) {
          ctx.beginPath();
          ctx.moveTo(x + k, y);
          ctx.lineTo(x + k, y + ch);
          ctx.stroke();
        }
        for (let k = 0; k < ch; k += 32) {
          ctx.beginPath();
          ctx.moveTo(x, y + k);
          ctx.lineTo(x + cw, y + k);
          ctx.stroke();
        }
        break;
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = ad.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 8;
    fitText(ctx, ad.brand, x + 30, y + ch * 0.52, cw - 60, 92, 800);
    ctx.shadowBlur = 0;
    ctx.fillStyle = ad.accent;
    ctx.fillRect(x + 32, y + ch * 0.6, 70, 8);
    ctx.fillStyle = ad.fg;
    fitText(ctx, ad.tag, x + 32, y + ch * 0.82, cw - 64, 40, 500);
    ctx.restore();
    index[ad.brand] = i;
  });
  return { texture: toTexture(c), cols, rows, index };
}

/* ------------------------------------------------------------------ */
/* Carteles LED de colectivos (números de línea inventados)              */
/* ------------------------------------------------------------------ */

export const BUS_LINES = ['512', '640', '777', '903', '588', '615', '731', '850', '529', '666', '702', '921', '544', '689', '818', '973'];
const BUS_DEST = ['Constitución', 'Retiro', 'Pompeya', 'La Boca', 'Palermo', 'Once', 'Barracas', 'Belgrano'];

export function makeBusSignAtlas(): Atlas {
  const cols = 4;
  const rows = 4;
  const cw = 256;
  const ch = 64;
  const [c, ctx] = makeCanvas(cols * cw, rows * ch);
  BUS_LINES.forEach((n, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    ctx.fillStyle = '#0b0b08';
    ctx.fillRect(x, y, cw, ch);
    ctx.fillStyle = '#ffb21c';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `700 50px ${FONT}`;
    ctx.fillText(n, x + 10, y + ch / 2 + 2);
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(BUS_DEST[i % BUS_DEST.length].toUpperCase(), x + 96, y + ch / 2 + 2);
  });
  return { texture: toTexture(c), cols, rows, index: {} };
}

/* ------------------------------------------------------------------ */
/* Marcas viales: flechas y "BUS" (alfa en canal rojo, sin sRGB)          */
/* ------------------------------------------------------------------ */

export function makeRoadMarkAtlas(): Atlas {
  // 4 celdas verticales de 128×512: recto, recto+derecha, derecha, BUS
  const cols = 4;
  const cw = 128;
  const ch = 512;
  const [c, ctx] = makeCanvas(cols * cw, ch);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  const shaft = (x: number) => {
    ctx.fillRect(x + 54, ch * 0.32, 20, ch * 0.62);
    ctx.beginPath();
    ctx.moveTo(x + 64, ch * 0.04);
    ctx.lineTo(x + 112, ch * 0.34);
    ctx.lineTo(x + 16, ch * 0.34);
    ctx.closePath();
    ctx.fill();
  };
  shaft(0);
  // recto + derecha
  shaft(cw);
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(cw + 64, ch * 0.74);
  ctx.quadraticCurveTo(cw + 64, ch * 0.56, cw + 94, ch * 0.56);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cw + 124, ch * 0.56);
  ctx.lineTo(cw + 92, ch * 0.47);
  ctx.lineTo(cw + 92, ch * 0.65);
  ctx.closePath();
  ctx.fill();
  // derecha
  {
    const x = cw * 2;
    ctx.fillRect(x + 40, ch * 0.42, 20, ch * 0.52);
    ctx.beginPath();
    ctx.moveTo(x + 50, ch * 0.44);
    ctx.quadraticCurveTo(x + 50, ch * 0.3, x + 86, ch * 0.3);
    ctx.lineWidth = 20;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 126, ch * 0.3);
    ctx.lineTo(x + 84, ch * 0.2);
    ctx.lineTo(x + 84, ch * 0.4);
    ctx.closePath();
    ctx.fill();
  }
  // BUS: letras estiradas a lo largo del carril
  {
    const x = cw * 3;
    ctx.save();
    ctx.translate(x + cw / 2, ch / 2);
    ctx.scale(1, 3.4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 54px ${FONT}`;
    ctx.fillText('BUS', 0, 2);
    ctx.restore();
  }
  return { texture: toTexture(c, false), cols, rows: 1, index: { straight: 0, straightRight: 1, right: 2, bus: 3 } };
}

/** Textura radial suave (luz de faroles en el piso, sombra de contacto). */
export function makeRadialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(c, false);
}
