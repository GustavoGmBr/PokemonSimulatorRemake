/**
 * Mapas dos habitats de selvagens, desenhados em pixel art no estilo GBA.
 * Cada mapa é uma grade de tiles de 16×16 pintados por código (sem imagens externas).
 */

export const TILE = 16;
export const COLS = 24;
export const ROWS = 14;

type Ctx = CanvasRenderingContext2D;

interface Tile {
  c: Ctx;
  x: number;
  y: number;
  col: number;
  row: number;
  /** aleatório fixo por tile (o mapa sempre sai igual) */
  r: () => number;
  at: (dx: number, dy: number) => string;
}
type Painter = (t: Tile) => void;

interface Theme {
  /** tile pintado por baixo de tudo */
  ground: Painter;
  /** pintores por caractere; os que não são "sólidos" são desenhados sobre o chão */
  tiles: Record<string, { draw: Painter; solid?: boolean }>;
  /** caracteres onde os Pokémon podem aparecer */
  walkable: string;
  /** caractere que preenche o mapa antes de `build` */
  fill: string;
  build: (g: Grid) => void;
  overlay?: (c: Ctx) => void;
}

// ---------------------------------------------------------------- aleatório e grade

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Grid {
  cells: string[][];
  rnd: () => number;
  constructor(fill: string, seed: number) {
    this.cells = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => fill));
    this.rnd = mulberry32(seed);
  }
  get(x: number, y: number): string {
    return this.cells[y]?.[x] ?? '#';
  }
  set(x: number, y: number, c: string): void {
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) (this.cells[y] as string[])[x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }
  blob(cx: number, cy: number, rx: number, ry: number, c: string, only?: string): void {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1 && (!only || only.includes(this.get(x, y)))) this.set(x, y, c);
      }
    }
  }
  scatter(c: string, count: number, only: string): void {
    let placed = 0;
    for (let tries = 0; tries < count * 40 && placed < count; tries++) {
      const x = Math.floor(this.rnd() * COLS);
      const y = Math.floor(this.rnd() * ROWS);
      if (only.includes(this.get(x, y))) { this.set(x, y, c); placed++; }
    }
  }
  /** linha poligonal com espessura */
  path(points: [number, number][], c: string, width = 1, only?: string): void {
    for (let k = 0; k + 1 < points.length; k++) {
      const [x0, y0] = points[k] as [number, number];
      const [x1, y1] = points[k + 1] as [number, number];
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 || 1;
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(x0 + ((x1 - x0) * s) / steps);
        const y = Math.round(y0 + ((y1 - y0) * s) / steps);
        for (let j = 0; j < width; j++) for (let i = 0; i < width; i++) {
          if (!only || only.includes(this.get(x + i, y + j))) this.set(x + i, y + j, c);
        }
      }
    }
  }
  /** moldura irregular nas bordas do mapa */
  border(c: string, min: number, max: number): void {
    for (let x = 0; x < COLS; x++) {
      const top = min + Math.floor(this.rnd() * (max - min + 1));
      const bottom = min + Math.floor(this.rnd() * (max - min + 1));
      for (let j = 0; j < top; j++) this.set(x, j, c);
      for (let j = 0; j < bottom; j++) this.set(x, ROWS - 1 - j, c);
    }
    for (let y = 0; y < ROWS; y++) {
      const left = min + Math.floor(this.rnd() * (max - min + 1));
      const right = min + Math.floor(this.rnd() * (max - min + 1));
      for (let i = 0; i < left; i++) this.set(i, y, c);
      for (let i = 0; i < right; i++) this.set(COLS - 1 - i, y, c);
    }
  }
  /** troca `from` por `to` nos tiles encostados em algo de `others` */
  ring(from: string, to: string, others: string): void {
    const marks: [number, number][] = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (this.get(x, y) !== from) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (others.includes(this.get(x + dx, y + dy))) { marks.push([x, y]); break; }
      }
    }
    for (const [x, y] of marks) this.set(x, y, to);
  }
}

// ---------------------------------------------------------------- primitivas de desenho

const rect = (t: Tile, color: string, x: number, y: number, w = 1, h = 1) => {
  t.c.fillStyle = color;
  t.c.fillRect(t.x + x, t.y + y, w, h);
};

const speckle = (t: Tile, colors: string[], n: number) => {
  for (let i = 0; i < n; i++) rect(t, colors[Math.floor(t.r() * colors.length)] as string, Math.floor(t.r() * TILE), Math.floor(t.r() * TILE));
};

const flat = (color: string, specks: string[], n = 8): Painter => (t) => {
  rect(t, color, 0, 0, TILE, TILE);
  speckle(t, specks, n);
};

const nothing: Painter = () => undefined;

/** elipse pixelada com contorno e brilho */
function ell(t: Tile, cx: number, cy: number, rx: number, ry: number, fill: string, line: string, hi?: string) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      let color = fill;
      if (d > 0.62) color = line;
      else if (hi && dx + dy < -0.45 && d < 0.5) color = hi;
      rect(t, color, x, y);
    }
  }
}

const shadow = (t: Tile, cx: number, cy: number, rx: number, ry: number, color = 'rgba(0,0,0,0.22)') => {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    if (dx * dx + dy * dy <= 1) rect(t, color, x, y);
  }
};

const round = (t: Tile, canopy: string, hi: string, line: string, trunk = '#6b4a2b') => {
  shadow(t, 8, 14, 6, 1.6);
  rect(t, line, 6, 10, 4, 5);
  rect(t, trunk, 7, 10, 2, 4);
  ell(t, 8, 6.5, 7, 6.3, canopy, line, hi);
};

const pine = (t: Tile, dark: string, mid: string, snow: string | null, line: string) => {
  shadow(t, 8, 14.5, 5, 1.4);
  rect(t, '#5a3a22', 7, 12, 2, 3);
  for (let y = 0; y < 13; y++) {
    const half = 1 + Math.floor((y / 12) * 6.2);
    for (let x = 8 - half; x < 8 + half; x++) {
      const edge = x === 8 - half || x === 8 + half - 1;
      const tier = y % 4 === 3;
      let color = edge || tier ? line : mid;
      if (!edge && !tier && x < 8 - half + 2) color = dark;
      if (snow && !edge && y % 4 === 0) color = snow;
      rect(t, color, x, y);
    }
  }
};

const boulder = (t: Tile, fill: string, hi: string, line: string) => {
  shadow(t, 8, 13, 6.5, 2);
  ell(t, 8, 9, 6.2, 5, fill, line, hi);
};

// ---------------------------------------------------------------- 1. floresta

const FOREST: Theme = {
  fill: '.',
  walkable: '.,gp',
  ground: flat('#6fb94a', ['#5da83d', '#82c957', '#5da83d'], 10),
  build(g) {
    g.scatter(',', 46, '.');
    g.blob(5, 5, 3, 2, 'g'); g.blob(18, 6, 3, 2, 'g'); g.blob(10, 11, 2.5, 1.5, 'g'); g.blob(21, 11, 2, 1.5, 'g');
    g.path([[12, 13], [11, 10], [10, 8], [12, 6], [13, 4], [12, 1]], 'p', 2);
    g.blob(18.5, 10.5, 2.2, 1.4, 'w');
    g.border('T', 1, 3);
    g.blob(4, 9, 1.8, 1.5, 'T'); g.blob(15, 3, 1.8, 1.4, 'T'); g.blob(22, 4, 1.2, 2, 'T'); g.blob(7, 1, 2, 1, 'T');
    g.scatter('b', 7, '.');
  },
  tiles: {
    '.': { draw: nothing },
    ',': { draw: (t) => { speckle(t, ['#f08aa0', '#f8e060', '#ffffff'], 3); } },
    g: { draw: (t) => {
      rect(t, '#3f8f34', 0, 5, TILE, 11);
      for (let x = 0; x < TILE; x += 2) { rect(t, '#2d7a2a', x, 3 + (x % 4), 1, 6); rect(t, '#58b04a', x + 1, 5 + (x % 3), 1, 5); }
      speckle(t, ['#2d7a2a'], 4);
    } },
    p: { draw: (t) => { rect(t, '#cdaa73', 0, 0, TILE, TILE); speckle(t, ['#b8935a', '#dcc08c'], 9); } },
    w: { solid: true, draw: (t) => {
      rect(t, '#3f8fd8', 0, 0, TILE, TILE);
      rect(t, '#6cb4f0', 2, 4, 5, 1); rect(t, '#6cb4f0', 9, 10, 5, 1);
      if (t.at(0, -1) !== 'w') rect(t, '#2c6fb0', 0, 0, TILE, 2);
    } },
    T: { solid: true, draw: (t) => { flat('#3c8a34', ['#2f7a2c', '#4c9c3e'], 8)(t); round(t, '#2f8a3c', '#58b45a', '#17481f'); } },
    b: { draw: (t) => { shadow(t, 8, 13, 5.5, 1.5); ell(t, 8, 9.5, 5.5, 4.2, '#3f9a3c', '#1d5a25', '#6cc45c'); } },
  },
};

// ---------------------------------------------------------------- 2. costa

const COAST: Theme = {
  fill: 's',
  walkable: 'sGiw',
  ground: flat('#f1d98f', ['#dcc075', '#ffe9a8'], 7),
  build(g) {
    g.rect(0, 0, COLS, 8, '~');
    for (let x = 0; x < COLS; x++) {
      const shore = 7 + Math.round(Math.sin(x * 0.7) * 0.9);
      for (let y = 7; y < 10; y++) g.set(x, y, y <= shore ? '~' : 's');
    }
    g.rect(0, 0, 7, 4, 'G'); g.rect(0, 4, 8, 1, 'c'); g.rect(7, 0, 1, 4, 'c'); g.rect(0, 5, 6, 1, 'c');
    g.blob(15, 3.5, 2.6, 1.7, 'i'); g.blob(20.5, 5.6, 1.6, 1, 'i'); g.blob(11.5, 5.4, 1.2, 0.8, 'i');
    g.scatter('r', 5, '~');
    g.set(15, 3, 'P'); g.set(20, 5, 'P'); g.set(3, 2, 'P');
    g.ring('~', 'w', 'sGicP');
    g.scatter('r', 4, 's');
    g.scatter('d', 8, 's');
  },
  tiles: {
    '~': { solid: true, draw: (t) => {
      rect(t, '#2b6cc4', 0, 0, TILE, TILE);
      const o = (t.col + t.row) % 2 === 0 ? 0 : 4;
      rect(t, '#4a8fe4', 2 + o, 3, 4, 1); rect(t, '#4a8fe4', 9 - o, 10, 4, 1); rect(t, '#1f55a8', 5, 7, 3, 1);
    } },
    w: { solid: true, draw: (t) => {
      rect(t, '#58aae8', 0, 0, TILE, TILE);
      rect(t, '#8cc8f4', 3, 5, 4, 1); rect(t, '#8cc8f4', 9, 11, 4, 1);
      const land = (c: string) => 'sGicP'.includes(c);
      if (land(t.at(0, 1))) { rect(t, '#ffffff', 0, 13, TILE, 1); rect(t, '#d8f0ff', 0, 12, TILE, 1); }
      if (land(t.at(0, -1))) rect(t, '#ffffff', 0, 2, TILE, 1);
      if (land(t.at(-1, 0))) rect(t, '#ffffff', 1, 0, 1, TILE);
      if (land(t.at(1, 0))) rect(t, '#ffffff', 14, 0, 1, TILE);
    } },
    s: { draw: nothing },
    d: { draw: (t) => { rect(t, '#8fb05a', 6, 8, 1, 4); rect(t, '#6a9040', 8, 6, 1, 6); rect(t, '#8fb05a', 10, 9, 1, 3); } },
    i: { draw: (t) => { rect(t, '#f6e3a0', 0, 0, TILE, TILE); speckle(t, ['#e0c680', '#fff2c4'], 8); } },
    P: { draw: (t) => {
      rect(t, '#f6e3a0', 0, 0, TILE, TILE);
      shadow(t, 8, 14, 5, 1.4);
      rect(t, '#7a5430', 7, 6, 2, 8); rect(t, '#7a5430', 8, 5, 1, 2);
      for (const [dx, dy, w] of [[-5, 2, 6], [0, 1, 7], [-3, -1, 4], [2, 3, 5]] as const) { rect(t, '#2c8a3a', 8 + dx, 3 + dy, w, 2); rect(t, '#4cb454', 8 + dx, 3 + dy, w, 1); }
    } },
    G: { solid: true, draw: (t) => flat('#6fb94a', ['#5da83d', '#82c957'], 8)(t) },
    c: { solid: true, draw: (t) => {
      rect(t, '#9a8a74', 0, 0, TILE, TILE);
      for (let y = 0; y < TILE; y += 4) rect(t, '#7c6c58', 0, y + 3, TILE, 1);
      for (let x = 1; x < TILE; x += 5) rect(t, '#b4a48c', x, 0, 1, TILE);
      if (t.at(0, -1) === 'G') { rect(t, '#4f9a38', 0, 0, TILE, 3); rect(t, '#2f6a28', 0, 3, TILE, 1); }
      if (t.at(0, 1) !== 'c') rect(t, '#5c4e3e', 0, 14, TILE, 2);
    } },
    r: { draw: (t) => { boulder(t, '#8a8f98', '#b4b9c2', '#3f434c'); } },
  },
};

// ---------------------------------------------------------------- 3. vulcão

const VOLCANO: Theme = {
  fill: '.',
  walkable: '.,o',
  ground: flat('#c98a5c', ['#b5764a', '#dba070', '#a96a42'], 10),
  build(g) {
    g.scatter(',', 40, '.');
    g.border('m', 1, 2);
    g.path([[0, 8], [5, 8], [7, 10], [7, 13]], 'x', 2, '.,');
    g.path([[16, 1], [15, 3], [18, 6], [23, 6]], 'x', 2, '.,m');
    g.blob(11, 5, 3.3, 2.5, 'o'); g.blob(11, 5, 2.3, 1.6, 'L');
    g.blob(19, 10.5, 3.3, 2.4, 'o'); g.blob(19, 10.5, 2.3, 1.5, 'L');
    g.blob(4, 3.5, 2, 1.5, 'o'); g.blob(4, 3.5, 1.2, 0.8, 'L');
    g.scatter('r', 9, '.');
  },
  tiles: {
    '.': { draw: nothing },
    ',': { draw: (t) => { rect(t, '#8a4f32', 2, 4, 6, 1); rect(t, '#8a4f32', 7, 5, 1, 4); rect(t, '#8a4f32', 8, 9, 5, 1); } },
    m: { solid: true, draw: (t) => {
      rect(t, '#7a4a38', 0, 0, TILE, TILE);
      for (let x = 0; x < TILE; x += 4) rect(t, '#5e3626', x, 0, 1, TILE);
      for (let y = 4; y < TILE; y += 6) rect(t, '#9a6048', 0, y, TILE, 1);
      speckle(t, ['#9a6048', '#4a281c'], 8);
      if (t.at(0, 1) !== 'm') rect(t, '#3f2418', 0, 13, TILE, 3);
    } },
    x: { solid: true, draw: (t) => {
      rect(t, '#2d1a14', 0, 0, TILE, TILE);
      rect(t, '#4a2a1e', 0, 0, TILE, 3); rect(t, '#1a0e0a', 0, 10, TILE, 6);
      speckle(t, ['#4a2a1e'], 6);
    } },
    o: { draw: (t) => { rect(t, '#8c5a40', 0, 0, TILE, TILE); speckle(t, ['#6a3e2a', '#a8745a'], 10); } },
    L: { solid: true, draw: (t) => {
      rect(t, '#e8481c', 0, 0, TILE, TILE);
      rect(t, '#ff8a2a', 2 + (t.col % 3) * 2, 3, 5, 2); rect(t, '#ffd050', 9, 10, 4, 1); rect(t, '#ff8a2a', 1, 11, 3, 2);
      if (t.at(0, -1) !== 'L') rect(t, '#b82a10', 0, 0, TILE, 2);
    } },
    r: { draw: (t) => boulder(t, '#6e5a4e', '#9a8272', '#2e211a') },
  },
};

// ---------------------------------------------------------------- 4. cordilheira

const mountainWall: Painter = (t) => {
  rect(t, '#6c7a96', 0, 0, TILE, TILE);
  for (let x = 0; x < TILE; x += 5) rect(t, '#55627c', x + (t.row % 2), 0, 1, TILE);
  rect(t, '#8794b0', 3, 6, 4, 1); rect(t, '#8794b0', 10, 11, 4, 1);
  const above = t.at(0, -1);
  if (above !== 'M' && above !== 'E' && above !== 'N') {
    rect(t, '#f4f8fc', 0, 0, TILE, 5); rect(t, '#c4d4e6', 0, 5, TILE, 1);
    for (let x = 1; x < TILE; x += 4) rect(t, '#f4f8fc', x, 5, 2, 2);
  }
  const below = t.at(0, 1);
  if (below !== 'M' && below !== 'E' && below !== 'N') rect(t, '#3e4860', 0, 14, TILE, 2);
};

const MOUNTAIN: Theme = {
  fill: 'n',
  walkable: 'ni=',
  ground: flat('#e8f1f8', ['#d0e0ee', '#ffffff', '#c0d4e6'], 9),
  build(g) {
    g.rect(0, 0, COLS, 3, 'M');
    for (let x = 0; x < COLS; x++) { if (g.rnd() < 0.5) g.set(x, 3, 'M'); if (g.rnd() < 0.18) g.set(x, 4, 'M'); }
    g.blob(5, 11, 3.5, 2, 'i'); g.blob(19, 8, 3.5, 2, 'i'); g.blob(12, 6.5, 2, 1, 'i');
    g.blob(1, 8, 1.8, 2.4, 'M'); g.blob(23, 12, 2.2, 2.4, 'M'); g.blob(9, 13, 2, 1, 'M');
    g.set(5, 2, 'E');
    g.set(18, 2, 'N');
    g.path([[18, 3], [18, 7]], '=', 1, 'ni');
    g.path([[18, 7], [14, 9], [11, 11]], '=', 1, 'ni');
    g.scatter('P', 11, 'n');
  },
  tiles: {
    n: { draw: nothing },
    i: { draw: (t) => {
      rect(t, '#a8d8f0', 0, 0, TILE, TILE);
      rect(t, '#d8f2ff', 2, 3, 6, 1); rect(t, '#ffffff', 3, 2, 2, 1); rect(t, '#d8f2ff', 8, 10, 5, 1); rect(t, '#78b8de', 0, 14, TILE, 2);
    } },
    M: { solid: true, draw: mountainWall },
    E: { solid: true, draw: (t) => {
      mountainWall(t);
      ell(t, 8, 12, 5.5, 8, '#142238', '#d8f2ff', '#1c3050');
      rect(t, '#a8d8f0', 4, 4, 1, 3); rect(t, '#a8d8f0', 11, 4, 1, 4); rect(t, '#d8f2ff', 7, 3, 2, 3);
    } },
    N: { solid: true, draw: (t) => {
      mountainWall(t);
      rect(t, '#6a4424', 2, 3, 12, 13); rect(t, '#0e0e14', 4, 5, 8, 11);
      rect(t, '#a8743c', 2, 3, 12, 2); rect(t, '#a8743c', 2, 3, 2, 13); rect(t, '#a8743c', 12, 3, 2, 13);
      rect(t, '#f8d84a', 7, 1, 2, 2);
    } },
    '=': { draw: (t) => {
      rect(t, '#6a4a2a', 3, 0, 10, 2); rect(t, '#6a4a2a', 3, 8, 10, 2);
      rect(t, '#9aa4b4', 4, 0, 1, TILE); rect(t, '#9aa4b4', 11, 0, 1, TILE);
    } },
    P: { draw: (t) => pine(t, '#1f5a4a', '#2c7a5e', '#f4f8fc', '#10382e') },
  },
};

// ---------------------------------------------------------------- 5. zona industrial

const INDUSTRIAL: Theme = {
  fill: '.',
  walkable: '.,sS',
  ground: flat('#8d939c', ['#7c828b', '#a0a6af', '#6e747d'], 9),
  build(g) {
    g.scatter(',', 30, '.');
    g.rect(1, 1, 6, 1, 'R'); g.rect(1, 2, 6, 2, '#'); g.set(2, 0, 'K'); g.set(5, 0, 'K');
    g.rect(16, 1, 7, 1, 'R'); g.rect(16, 2, 7, 3, '#'); g.set(18, 0, 'K'); g.set(21, 0, 'K');
    g.blob(5.5, 10.5, 3.6, 2.2, 's'); g.blob(17.5, 10.8, 4, 2.4, 's');
    g.scatter('S', 7, 's');
    g.set(12, 3, 'T'); g.set(11, 9, 'T'); g.set(21, 7, 'T');
    g.path([[9, 6], [14, 6]], 'f', 1, '.,');
    g.path([[0, 6], [5, 6]], 'p', 1, '.,');
    g.scatter('b', 6, '.');
  },
  tiles: {
    '.': { draw: nothing },
    ',': { draw: (t) => { rect(t, '#5f656e', 3, 5, 5, 1); rect(t, '#5f656e', 7, 6, 1, 4); rect(t, '#5f656e', 8, 10, 4, 1); } },
    R: { solid: true, draw: (t) => {
      rect(t, '#c0463c', 0, 0, TILE, TILE); rect(t, '#8a2c26', 0, 12, TILE, 4);
      for (let x = 0; x < TILE; x += 4) rect(t, '#a23830', x, 0, 1, 12);
    } },
    '#': { solid: true, draw: (t) => {
      rect(t, '#6a7280', 0, 0, TILE, TILE);
      for (let y = 0; y < TILE; y += 4) rect(t, '#58606c', 0, y + 3, TILE, 1);
      if (t.col % 2 === 0) { rect(t, '#20262e', 3, 4, 10, 7); rect(t, '#f2d85a', 4, 5, 3, 5); rect(t, '#3a4452', 8, 5, 4, 5); }
      if (t.at(0, 1) !== '#') rect(t, '#3e4550', 0, 14, TILE, 2);
    } },
    K: { draw: (t) => {
      rect(t, '#5a606c', 5, 0, 6, TILE); rect(t, '#3e4450', 5, 0, 1, TILE); rect(t, '#b0b6c0', 9, 0, 1, TILE);
      rect(t, '#c0463c', 5, 3, 6, 2); rect(t, '#e8e8f0', 5, 6, 6, 2);
    } },
    T: { draw: (t) => {
      shadow(t, 8, 15, 6, 1.2);
      for (let y = 0; y < 15; y++) {
        const half = 2 + Math.floor(y / 3);
        rect(t, '#3a4452', 8 - half, y, 1, 1); rect(t, '#3a4452', 7 + half, y, 1, 1);
        if (y % 3 === 0) rect(t, '#3a4452', 8 - half, y, half * 2, 1);
      }
      rect(t, '#f8e050', 7, 0, 2, 2);
    } },
    s: { solid: true, draw: (t) => {
      rect(t, '#7a4aa0', 0, 0, TILE, TILE);
      rect(t, '#a46cd0', 2, 4, 5, 1); rect(t, '#5c8a2c', 9, 9, 5, 1); rect(t, '#4e2e72', 0, 0, TILE, 1);
    } },
    S: { solid: true, draw: (t) => {
      rect(t, '#7a4aa0', 0, 0, TILE, TILE);
      rect(t, '#5c8a2c', 3, 4, 4, 1); ell(t, 10, 9, 3, 2.4, '#9ad03c', '#4e6e1c', '#d8f080');
    } },
    f: { draw: (t) => {
      rect(t, '#4a525e', 0, 5, TILE, 1); rect(t, '#4a525e', 0, 10, TILE, 1);
      for (let x = 1; x < TILE; x += 5) rect(t, '#2e343e', x, 3, 2, 11);
    } },
    p: { draw: (t) => {
      rect(t, '#3e454f', 0, 6, TILE, 5); rect(t, '#9aa2ae', 0, 7, TILE, 1); rect(t, '#2a2f37', 0, 10, TILE, 1);
      rect(t, '#c0463c', 7, 5, 2, 7);
    } },
    b: { draw: (t) => {
      shadow(t, 8, 14, 5, 1.4); rect(t, '#3a6ac0', 4, 3, 8, 11); rect(t, '#5a8ae0', 4, 3, 2, 11);
      rect(t, '#20386e', 4, 7, 8, 1); rect(t, '#20386e', 4, 11, 8, 1); rect(t, '#e8d84a', 7, 8, 2, 2);
    } },
  },
};

// ---------------------------------------------------------------- 6. ruínas

const RUINS: Theme = {
  fill: '.',
  walkable: '.,g',
  ground: flat('#6b6478', ['#5c566a', '#7c7588', '#4e4860'], 9),
  build(g) {
    g.scatter(',', 30, '.');
    g.rect(1, 6, 9, 6, 'g');
    for (let x = 1; x < 10; x++) { g.set(x, 6, 'f'); g.set(x, 11, 'f'); }
    for (let y = 6; y < 12; y++) { g.set(1, y, 'f'); g.set(9, y, 'f'); }
    g.set(5, 11, 'g');
    g.scatter('+', 10, 'g');
    g.rect(16, 2, 3, 1, 'u'); g.rect(16, 3, 3, 3, 'U'); g.set(17, 5, 'd');
    g.scatter('D', 5, '.');
    g.scatter('P', 8, '.');
    g.path([[11, 9], [14, 9]], 'B', 1, '.,'); g.path([[13, 12], [17, 12]], 'B', 1, '.,'); g.path([[20, 8], [20, 10]], 'B', 1, '.,');
  },
  overlay(c) {
    c.save();
    for (const [x, y, rx, ry, a] of [[60, 190, 150, 26, 0.22], [250, 120, 130, 22, 0.2], [330, 195, 110, 20, 0.22], [150, 60, 110, 18, 0.16], [300, 40, 70, 30, 0.3], [60, 30, 90, 14, 0.14]] as const) {
      const grad = c.createRadialGradient(x, y, 2, x, y, rx);
      grad.addColorStop(0, `rgba(226,230,245,${a})`);
      grad.addColorStop(1, 'rgba(226,230,245,0)');
      c.fillStyle = grad;
      c.save(); c.translate(x, y); c.scale(1, ry / rx); c.translate(-x, -y);
      c.fillRect(x - rx, y - rx, rx * 2, rx * 2);
      c.restore();
    }
    c.restore();
  },
  tiles: {
    '.': { draw: nothing },
    ',': { draw: (t) => { rect(t, '#4e4860', 3, 5, 4, 1); rect(t, '#4e4860', 6, 6, 1, 3); } },
    g: { solid: true, draw: (t) => flat('#4f5a4e', ['#434d42', '#5c685a', '#3a443a'], 9)(t) },
    f: { draw: (t) => {
      rect(t, '#2a2a34', 0, 5, TILE, 2); rect(t, '#2a2a34', 0, 10, TILE, 1);
      for (let x = 1; x < TILE; x += 4) { rect(t, '#1c1c24', x, 2, 2, 12); rect(t, '#1c1c24', x, 1, 1, 1); }
    } },
    '+': { draw: (t) => {
      shadow(t, 8, 14, 5, 1.2);
      rect(t, '#8d8a98', 4, 4, 8, 10); rect(t, '#8d8a98', 5, 2, 6, 2); rect(t, '#a9a6b6', 4, 4, 2, 10); rect(t, '#4a4858', 11, 4, 1, 10);
      rect(t, '#4a4858', 7, 6, 2, 1); rect(t, '#4a4858', 7, 8, 2, 1);
    } },
    D: { draw: (t) => {
      shadow(t, 8, 14.5, 5, 1.2);
      rect(t, '#3a2e2a', 7, 5, 2, 10); rect(t, '#3a2e2a', 4, 3, 1, 4); rect(t, '#3a2e2a', 5, 6, 3, 1); rect(t, '#3a2e2a', 9, 4, 4, 1); rect(t, '#3a2e2a', 12, 2, 1, 3); rect(t, '#3a2e2a', 8, 8, 4, 1);
    } },
    P: { draw: (t) => {
      shadow(t, 8, 15, 6, 1.4);
      rect(t, '#b8b4c4', 4, 6, 8, 9); rect(t, '#d6d2e0', 4, 6, 2, 9); rect(t, '#8a869a', 10, 6, 2, 9);
      rect(t, '#d6d2e0', 3, 4, 10, 2); rect(t, '#6a667a', 3, 6, 10, 1); rect(t, '#6a667a', 5, 10, 1, 3);
    } },
    B: { draw: (t) => { rect(t, '#a8a4b8', 0, 8, TILE, 6); rect(t, '#6a667a', 0, 13, TILE, 1); rect(t, '#c8c4d8', 0, 8, TILE, 1); rect(t, '#6b6478', 4, 7, 3, 2); rect(t, '#6b6478', 11, 8, 2, 2); } },
    u: { solid: true, draw: (t) => {
      flat('#6b6478', ['#5c566a'], 4)(t);
      rect(t, '#3a3450', 3, 0, 10, TILE); rect(t, '#554e72', 3, 0, 3, TILE); rect(t, '#2a2540', 12, 0, 1, TILE);
      rect(t, '#d85ae0', 7, 4, 2, 5); rect(t, '#ffffff', 7, 5, 1, 2);
    } },
    U: { solid: true, draw: (t) => {
      rect(t, '#3a3450', 0, 0, TILE, TILE);
      for (let y = 0; y < TILE; y += 4) rect(t, '#2c2840', 0, y + 3, TILE, 1);
      for (let x = 2; x < TILE; x += 5) rect(t, '#554e72', x, 0, 1, TILE);
    } },
    d: { solid: true, draw: (t) => {
      rect(t, '#3a3450', 0, 0, TILE, TILE);
      rect(t, '#16121e', 3, 4, 10, 12); ell(t, 8, 5, 5, 4, '#16121e', '#16121e');
      rect(t, '#554e72', 2, 3, 12, 1); rect(t, '#554e72', 1, 4, 2, 12); rect(t, '#554e72', 13, 4, 2, 12);
    } },
  },
};

// ---------------------------------------------------------------- 7. platô

const PLATEAU: Theme = {
  fill: '.',
  walkable: '.aSg',
  ground: flat('#b3a995', ['#a09681', '#c6bda9', '#8c8370'], 9),
  build(g) {
    g.scatter('g', 16, '.');
    g.border('c', 0, 2);
    g.rect(0, 0, COLS, 2, 'c');
    g.rect(9, 0, 6, 2, 'H');
    g.rect(10, 2, 4, 1, 'h');
    g.rect(11, 3, 2, 11, 'S');
    g.rect(10, 3, 1, 11, 'z'); g.rect(13, 3, 1, 11, 'z');
    g.blob(5, 9, 4.2, 3.2, 'A'); g.blob(5, 9, 3.4, 2.5, 'a');
    g.blob(19, 9.5, 3, 2.4, 'c'); g.blob(19, 9, 2.6, 1.6, '.');
    g.scatter('p', 6, '.');
  },
  tiles: {
    '.': { draw: nothing },
    g: { draw: (t) => { rect(t, '#6f9a4a', 3, 9, 1, 3); rect(t, '#6f9a4a', 5, 8, 1, 4); rect(t, '#8cb862', 9, 10, 1, 3); } },
    c: { solid: true, draw: (t) => {
      rect(t, '#8c7c68', 0, 0, TILE, TILE);
      for (let x = 0; x < TILE; x += 4) rect(t, '#6c5c4a', x + (t.row % 2) * 2, 0, 1, TILE);
      for (let y = 5; y < TILE; y += 6) rect(t, '#a89884', 0, y, TILE, 1);
      if (t.at(0, 1) !== 'c') rect(t, '#4e4234', 0, 13, TILE, 3);
    } },
    S: { solid: true, draw: (t) => {
      for (let y = 0; y < TILE; y += 4) { rect(t, '#d9cfba', 0, y, TILE, 2); rect(t, '#9a8e78', 0, y + 2, TILE, 1); rect(t, '#6f6552', 0, y + 3, TILE, 1); }
    } },
    z: { solid: true, draw: (t) => {
      rect(t, '#8c7c68', 0, 0, TILE, TILE);
      for (let y = 0; y < TILE; y += 4) rect(t, '#6c5c4a', 0, y + 3, TILE, 1);
      rect(t, '#a89884', t.col === 10 ? 12 : 0, 0, 4, TILE);
    } },
    a: { solid: true, draw: (t) => flat('#ead9a0', ['#d9c688', '#f6e8b8'], 8)(t) },
    A: { solid: true, draw: (t) => {
      flat('#b3a995', ['#a09681'], 4)(t);
      rect(t, '#d6c9a8', 1, 3, 14, 10); rect(t, '#8f836a', 1, 12, 14, 1); rect(t, '#efe4c2', 2, 4, 5, 2);
    } },
    H: { solid: true, draw: (t) => {
      const roof = t.row === 0;
      rect(t, roof ? '#b8402e' : '#e6dcc4', 0, 0, TILE, TILE);
      if (roof) { for (let x = 0; x < TILE; x += 3) rect(t, '#8a2c20', x, 0, 1, TILE); rect(t, '#f06850', 0, 0, TILE, 2); rect(t, '#7a2418', 0, 14, TILE, 2); }
      else { rect(t, '#c8bca0', 0, 0, TILE, 1); rect(t, '#b8402e', 2, 0, 3, TILE); rect(t, '#b8402e', 11, 0, 3, TILE); if (t.col === 11 || t.col === 12) rect(t, '#3a2418', 5, 3, 6, 13); }
    } },
    h: { solid: true, draw: (t) => { rect(t, '#e6dcc4', 0, 0, TILE, TILE); rect(t, '#c8bca0', 0, 0, TILE, 2); rect(t, '#d9cfba', 0, 6, TILE, 2); rect(t, '#9a8e78', 0, 8, TILE, 1); } },
    p: { draw: (t) => {
      shadow(t, 8, 15, 6, 1.3);
      rect(t, '#d9cfba', 4, 3, 8, 12); rect(t, '#efe4c2', 4, 3, 2, 12); rect(t, '#9a8e78', 10, 3, 2, 12); rect(t, '#efe4c2', 3, 2, 10, 2); rect(t, '#9a8e78', 3, 14, 10, 1);
    } },
  },
};

// ---------------------------------------------------------------- 8. bosque encantado

const GROVE: Theme = {
  fill: '.',
  walkable: '.,qs',
  ground: flat('#8fd3a0', ['#7cc28e', '#a6e4b4', '#c8a8ec'], 10),
  build(g) {
    g.scatter(',', 50, '.');
    g.border('T', 1, 3);
    g.blob(12, 6.5, 4.2, 2.8, 'c'); g.blob(12, 6.5, 3.5, 2.2, 'q');
    g.blob(19.5, 10.5, 3.4, 2.4, 'w');
    g.blob(4, 10, 1.5, 1.4, 'T'); g.blob(21, 3, 1.5, 1.2, 'T');
    g.scatter('M', 9, '.');
    g.scatter('s', 18, '.q');
  },
  tiles: {
    '.': { draw: nothing },
    ',': { draw: (t) => { speckle(t, ['#ff9ac8', '#ffffff', '#c8a8ec', '#ffe27a'], 4); } },
    T: { solid: true, draw: (t) => { flat('#6cb88a', ['#5aa678', '#7cc898'], 8)(t); round(t, '#d890d8', '#f6c4f0', '#7a3a8a', '#8a5a6a'); } },
    c: { solid: true, draw: (t) => {
      flat('#8fd3a0', ['#7cc28e'], 6)(t);
      if ((t.col + t.row) % 2 === 0) { rect(t, '#c8c4dc', 5, 6, 6, 6); rect(t, '#e8e4f8', 5, 6, 2, 6); rect(t, '#8a86a8', 10, 6, 1, 6); rect(t, '#ff9ae0', 7, 4, 2, 2); }
    } },
    q: { solid: true, draw: (t) => { flat('#c8e8d0', ['#b8dcc4', '#ffffff', '#f6d8f6'], 8)(t); } },
    w: { solid: true, draw: (t) => {
      rect(t, '#78d8f0', 0, 0, TILE, TILE);
      rect(t, '#b8f2ff', 2, 4, 5, 1); rect(t, '#ffffff', 3, 3, 1, 1); rect(t, '#b8f2ff', 9, 10, 4, 1); rect(t, '#ffffff', 11, 9, 1, 1);
      rect(t, '#a8a0f0', 5, 7, 2, 1);
      if (t.at(0, -1) !== 'w') rect(t, '#4cb4d8', 0, 0, TILE, 2);
    } },
    M: { draw: (t) => {
      shadow(t, 8, 14.5, 6, 1.4);
      rect(t, '#f6e8f0', 6, 8, 4, 7); rect(t, '#d8c0d4', 9, 8, 1, 7);
      ell(t, 8, 7, 7.5, 5.6, '#e060b8', '#7a2a6a', '#ff9ae0');
      rect(t, '#fff2a8', 5, 5, 2, 2); rect(t, '#fff2a8', 10, 7, 2, 2); rect(t, '#fff2a8', 8, 3, 2, 1);
    } },
    s: { draw: (t) => { rect(t, '#ffffff', 7, 5, 1, 3); rect(t, '#ffffff', 6, 6, 3, 1); rect(t, '#fff2a8', 7, 6, 1, 1); } },
  },
};

const THEMES: Record<string, Theme> = {
  forest: FOREST, coast: COAST, volcano: VOLCANO, mountain: MOUNTAIN,
  industrial: INDUSTRIAL, ruins: RUINS, plateau: PLATEAU, grove: GROVE,
};

const SEEDS: Record<string, number> = { forest: 11, coast: 22, volcano: 33, mountain: 44, industrial: 55, ruins: 66, plateau: 77, grove: 88 };

const gridCache = new Map<string, Grid>();
function gridOf(id: string): Grid {
  let grid = gridCache.get(id);
  if (!grid) {
    const theme = THEMES[id] as Theme;
    grid = new Grid(theme.fill, SEEDS[id] ?? 1);
    theme.build(grid);
    gridCache.set(id, grid);
  }
  return grid;
}

/** Desenha o mapa do habitat em um canvas (24×14 tiles de 16 px). */
export function drawHabitat(canvas: HTMLCanvasElement, habitat: string): void {
  const id = THEMES[habitat] ? habitat : 'forest';
  const theme = THEMES[id] as Theme;
  const grid = gridOf(id);
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const c = canvas.getContext('2d');
  if (!c) return;
  c.imageSmoothingEnabled = false;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const painter = theme.tiles[grid.get(col, row)];
      const tile: Tile = {
        c, x: col * TILE, y: row * TILE, col, row,
        r: mulberry32(col * 977 + row * 131 + (SEEDS[id] ?? 1)),
        at: (dx, dy) => grid.get(col + dx, row + dy),
      };
      if (!painter?.solid) theme.ground(tile);
      painter?.draw(tile);
    }
  }
  theme.overlay?.(c);
}

/**
 * Posições (em tiles) das vagas "soltas" do mapa: [coluna, linha dos pés]. Até 15 vagas (3 linhas × 5 colunas);
 * a ordem espalha o começo da lista, então mapas com poucos Pokémon não ficam amontoados num canto.
 */
const TARGETS: [number, number][] = [
  [7.4, 9.2], [16.6, 5.6], [12, 12.8], [2.8, 5.6], [21.2, 9.2],
  [2.8, 12.8], [12, 5.6], [21.2, 12.8], [7.4, 5.6], [16.6, 9.2],
  [2.8, 9.2], [21.2, 5.6], [7.4, 12.8], [12, 9.2], [16.6, 12.8],
];

const spawnCache = new Map<string, [number, number][]>();

/** Para cada vaga do mapa, o ponto (coluna, linha) dos pés do Pokémon, sempre em chão válido. */
export function habitatSpawns(habitat: string): [number, number][] {
  const id = THEMES[habitat] ? habitat : 'forest';
  const cached = spawnCache.get(id);
  if (cached) return cached;
  const theme = THEMES[id] as Theme;
  const grid = gridOf(id);
  const spots: [number, number][] = [];
  for (let row = 3; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (theme.walkable.includes(grid.get(col, row))) spots.push([col + 0.5, row + 0.9]);
  const chosen: [number, number][] = [];
  for (const [tx, ty] of TARGETS) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const spot of spots) {
      if (chosen.some(([x, y]) => Math.hypot(x - spot[0], (y - spot[1]) * 1.4) < 3)) continue;
      const d = Math.hypot(spot[0] - tx, spot[1] - ty);
      if (d < bestD) { bestD = d; best = spot; }
    }
    chosen.push(best ?? [tx, ty]);
  }
  spawnCache.set(id, chosen);
  return chosen;
}
