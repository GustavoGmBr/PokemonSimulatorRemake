/**
 * Baixa as imagens do jogo (Pokémon, itens) do repositório PokeAPI/sprites para a pasta de assets.
 *
 *   npm run sprites                      baixa o que falta
 *   npm run sprites -- --dir=D:\sprites  outra pasta (padrão: ASSETS_DIR, POKESIM_HOME/assets ou ./assets)
 *   npm run sprites -- --perfil=basico   só frente/costas e itens (~40 MB)
 *
 * Arquivos já baixados são mantidos; o que falhar é tentado de novo na próxima execução.
 * Sem internet o jogo continua funcionando: o servidor busca cada imagem na origem enquanto ela não existe aqui.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { itemSpriteSource, pokemonSpriteSources, type SpriteSource } from '@pokesim/engine';

export type SpriteProfile = 'completo' | 'basico';

export interface DownloadOptions {
  assetsDir: string;
  speciesIds: number[];
  itemNames: string[];
  profile?: SpriteProfile;
  concurrency?: number;
  retries?: number;
  /** desiste quando tantas imagens seguidas falham (provável falta de internet) */
  giveUpAfter?: number;
  report?: (message: string) => void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface DownloadResult {
  total: number;
  downloaded: number;
  alreadyThere: number;
  /** não existem na origem (ex.: animações de espécies novas); não são tentadas de novo */
  unavailable: number;
  failed: number;
  /** parou antes do fim por falhas seguidas; o restante fica para a próxima abertura */
  gaveUp: boolean;
}

const MISSING_FILE = '.indisponiveis.json';
const BASIC_VIEWS = /-(front|back)(Shiny)?\.png$/;

export function planSprites(speciesIds: number[], itemNames: string[], profile: SpriteProfile = 'completo'): SpriteSource[] {
  const list: SpriteSource[] = [];
  for (const id of speciesIds) {
    for (const source of pokemonSpriteSources(id)) {
      if (profile === 'basico' && !BASIC_VIEWS.test(source.file)) continue;
      list.push(source);
    }
  }
  for (const name of itemNames) list.push(itemSpriteSource(name));
  return list;
}

/** PNG/GIF de verdade? Evita gravar uma página de erro como se fosse imagem. */
export function looksLikeImage(file: string, bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  if (file.endsWith('.png')) return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (file.endsWith('.gif')) return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
  return false;
}

function readMissing(dir: string): Set<string> {
  try { return new Set(JSON.parse(readFileSync(path.join(dir, MISSING_FILE), 'utf8')) as string[]); } catch { return new Set(); }
}

export async function downloadSprites(options: DownloadOptions): Promise<DownloadResult> {
  const { assetsDir, report = () => {}, fetchImpl = fetch, signal } = options;
  const concurrency = options.concurrency ?? 16;
  const retries = options.retries ?? 3;
  const giveUpAfter = options.giveUpAfter ?? 40;
  let consecutiveFailures = 0;
  const plan = planSprites(options.speciesIds, options.itemNames, options.profile);
  const unavailableBefore = readMissing(assetsDir);
  const unavailable = new Set(unavailableBefore);

  const todo: SpriteSource[] = [];
  let alreadyThere = 0;
  for (const source of plan) {
    const target = path.join(assetsDir, source.file);
    if (existsSync(target) && statSync(target).size > 0) alreadyThere++;
    else if (!unavailable.has(source.file)) todo.push(source);
  }
  const result: DownloadResult = { total: plan.length, downloaded: 0, alreadyThere, unavailable: plan.filter((s) => unavailable.has(s.file)).length, failed: 0, gaveUp: false };
  if (!todo.length) {
    report('Sprites já instaladas.');
    return result;
  }

  report(`Primeiro uso: baixando ${todo.length} imagens. O jogo funciona normalmente enquanto isso.`);
  let next = 0;
  let done = 0;
  let lastReport = 0;

  async function fetchOne(source: SpriteSource): Promise<void> {
    const target = path.join(assetsDir, source.file);
    let lastError = 'erro desconhecido';
    for (let attempt = 0; attempt <= retries; attempt++) {
      signal?.throwIfAborted();
      try {
        const response = await fetchImpl(source.url, { signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]) });
        if (response.status === 404) {
          unavailable.add(source.file);
          result.unavailable++;
          consecutiveFailures = 0;
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!looksLikeImage(source.file, bytes)) throw new Error('resposta não é uma imagem');
        await mkdir(path.dirname(target), { recursive: true });
        const partial = `${target}.${process.pid}.part`;
        try {
          await writeFile(partial, bytes);
          await rename(partial, target);
        } finally {
          await rm(partial, { force: true });
        }
        result.downloaded++;
        consecutiveFailures = 0;
        return;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      }
    }
    result.failed++;
    if (++consecutiveFailures >= giveUpAfter) result.gaveUp = true;
    if (result.failed <= 3) report(`Falhou: ${source.file} (${lastError})`);
  }

  async function worker(): Promise<void> {
    while (next < todo.length && !result.gaveUp) {
      const source = todo[next++]!;
      await fetchOne(source);
      done++;
      if (Date.now() - lastReport >= 1500 || done === todo.length) {
        lastReport = Date.now();
        report(`Baixando sprites: ${Math.floor((done * 100) / todo.length)}% (${done} de ${todo.length})…`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  if (unavailable.size !== unavailableBefore.size) {
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(assetsDir, MISSING_FILE), JSON.stringify([...unavailable].sort()));
  }
  report(result.gaveUp
    ? 'Sem conexão com a origem das sprites. O jogo segue normal e tenta de novo na próxima abertura.'
    : result.failed
    ? `Sprites: ${result.downloaded} baixadas, ${result.failed} falharam (abra o jogo de novo com internet para completar).`
    : 'Sprites instaladas. As próximas partidas podem ser jogadas sem internet.');
  return result;
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const { loadGameData } = await import('@pokesim/data');
  const data = loadGameData();
  const home = process.env.POKESIM_HOME;
  const assetsDir = path.resolve(argValue('dir') ?? process.env.ASSETS_DIR ?? (home ? path.join(home, 'assets') : 'assets'));
  const profile = argValue('perfil') === 'basico' ? 'basico' : 'completo';
  const names = new Set([...data.items.map((item) => item.name), ...data.pokeapiItems.map((item) => item.name)]);
  console.log(`Pasta de sprites: ${assetsDir}`);
  const result = await downloadSprites({
    assetsDir,
    speciesIds: data.species.map((species) => species.id),
    itemNames: [...names],
    profile,
    report: (message) => console.log(message),
  });
  process.exitCode = result.failed || result.gaveUp ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(`Não foi possível baixar as sprites: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
