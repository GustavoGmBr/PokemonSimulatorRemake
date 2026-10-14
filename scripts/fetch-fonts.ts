/**
 * Baixa as fontes do jogo (Pixelify Sans e VT323) para apps/web/public/fonts, para o jogo funcionar offline.
 * Roda sozinho depois do `npm install` e antes do `npm run dev`; se já estiverem baixadas, não faz nada.
 * Sem internet, o jogo usa fontes do sistema (fica funcional, só menos bonito).
 *
 *   npm run fonts            baixa se faltar
 *   npm run fonts -- --force baixa de novo
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CSS_URL = 'https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400..700&family=VT323&display=swap';
/** O Google só entrega woff2 para navegadores modernos. */
const MODERN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const KEEP_SUBSETS = new Set(['latin', 'latin-ext']);

export interface RemoteFace {
  subset: string;
  family: string;
  style: string;
  weight: string;
  url: string;
  unicodeRange: string | null;
}

/** Lê o CSS do Google Fonts e devolve só as faixas de caracteres que usamos (latim). */
export function parseFontCss(css: string): RemoteFace[] {
  const faces: RemoteFace[] = [];
  const block = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const match of css.matchAll(block)) {
    const subset = match[1] ?? '';
    const body = match[2] ?? '';
    if (!KEEP_SUBSETS.has(subset)) continue;
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    const url = /src:[^;]*url\(([^)]+)\)\s*format\('woff2'\)/.exec(body)?.[1];
    if (!family || !url) continue;
    faces.push({
      subset,
      family,
      style: /font-style:\s*(\w+)/.exec(body)?.[1] ?? 'normal',
      weight: /font-weight:\s*([\d ]+);/.exec(body)?.[1]?.trim() ?? '400',
      url: url.replace(/['"]/g, ''),
      unicodeRange: /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? null,
    });
  }
  return faces;
}

export function localFileName(face: RemoteFace): string {
  const family = face.family.toLowerCase().replace(/\s+/g, '-');
  return `${family}-${face.subset}-${face.weight.replace(/\s+/g, '-')}.woff2`;
}

export function renderLocalCss(faces: RemoteFace[]): string {
  const blocks = faces.map((face) => [
    `/* ${face.family} · ${face.subset} */`,
    '@font-face {',
    `  font-family: '${face.family}';`,
    `  font-style: ${face.style};`,
    `  font-weight: ${face.weight};`,
    '  font-display: swap;',
    `  src: url('./${localFileName(face)}') format('woff2');`,
    ...(face.unicodeRange ? [`  unicode-range: ${face.unicodeRange};`] : []),
    '}',
  ].join('\n'));
  return `/* Gerado por scripts/fetch-fonts.ts — não edite. */\n${blocks.join('\n\n')}\n`;
}

export const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/public/fonts');

async function download(): Promise<void> {
  const cssResponse = await fetch(CSS_URL, { headers: { 'user-agent': MODERN_UA } });
  if (!cssResponse.ok) throw new Error(`Google Fonts respondeu ${cssResponse.status}`);
  const faces = parseFontCss(await cssResponse.text());
  if (faces.length === 0) throw new Error('Nenhuma fonte encontrada na resposta do Google Fonts.');

  mkdirSync(FONTS_DIR, { recursive: true });
  for (const face of faces) {
    const file = await fetch(face.url);
    if (!file.ok) throw new Error(`Falha ao baixar ${face.url} (${file.status})`);
    writeFileSync(path.join(FONTS_DIR, localFileName(face)), Buffer.from(await file.arrayBuffer()));
  }
  // o CSS só é escrito no fim: se algo falhar, na próxima vez tenta tudo de novo
  writeFileSync(path.join(FONTS_DIR, 'fonts.css'), renderLocalCss(faces));
  console.log(`Fontes baixadas: ${faces.length} arquivos em apps/web/public/fonts`);
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  if (!force && existsSync(path.join(FONTS_DIR, 'fonts.css'))) return;
  try {
    await download();
  } catch (error) {
    console.warn(`Não foi possível baixar as fontes (${(error as Error).message}).`);
    console.warn('O jogo funciona com fontes do sistema. Rode "npm run fonts" quando houver internet.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
