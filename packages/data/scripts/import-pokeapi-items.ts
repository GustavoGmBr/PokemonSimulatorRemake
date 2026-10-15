/**
 * Gera packages/data/catalog/pokeapi-items.json a partir dos dados oficiais do PokéAPI
 * (os mesmos que https://pokeapi.co/api/v2/item serve): ~2.200 itens com nome, categoria,
 * bolso, preço, efeito e texto.
 *
 * Os CSVs vêm do repositório PokeAPI/pokeapi (pasta data/v2/csv). Uso:
 *   npm run data:pokeapi -- <pasta data/v2/csv>
 * Sem argumento, clona o repositório (só essa pasta) em uma pasta temporária com o git.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../catalog/pokeapi-items.json');
const EN = '9';

/** CSV simples com aspas e quebras de linha dentro de campos. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === (head as string[]).length).map((r) => Object.fromEntries((head as string[]).map((h, i) => [h, r[i] as string])));
}

function csvDir(): string {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const dir = mkdtempSync(path.join(tmpdir(), 'pokeapi-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' });
  git('clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/PokeAPI/pokeapi.git', '.');
  git('sparse-checkout', 'set', 'data/v2/csv');
  return path.join(dir, 'data/v2/csv');
}

const dir = csvDir();
const read = (name: string) => {
  const file = path.join(dir, `${name}.csv`);
  if (!existsSync(file)) throw new Error(`Arquivo ausente: ${file}`);
  return parseCsv(readFileSync(file, 'utf8'));
};

const clean = (text: string) => text.replace(/[\n\f\r]+/g, ' ').replace(/\s+/g, ' ').trim();
const pockets = new Map(read('item_pockets').map((r) => [r.id as string, r.identifier as string]));
const categories = new Map(read('item_categories').map((r) => [r.id as string, { name: r.identifier as string, pocket: pockets.get(r.pocket_id as string) ?? 'misc' }]));
const names = new Map(read('item_names').filter((r) => r.local_language_id === EN).map((r) => [r.item_id, clean(r.name as string)]));
const effects = new Map(read('item_prose').filter((r) => r.local_language_id === EN).map((r) => [r.item_id, clean(r.short_effect as string)]));
const flavor = new Map<string, { group: number; text: string }>();
for (const r of read('item_flavor_text')) {
  if (r.language_id !== EN) continue;
  const group = Number(r.version_group_id);
  const best = flavor.get(r.item_id as string);
  if (!best || group > best.group) flavor.set(r.item_id as string, { group, text: clean(r.flavor_text as string) });
}

const items = read('items').map((r) => {
  const category = categories.get(r.category_id as string);
  const id = Number(r.id);
  return {
    id,
    name: r.identifier as string,
    en: names.get(r.id as string) ?? (r.identifier as string),
    category: category?.name ?? 'unknown',
    pocket: category?.pocket ?? 'misc',
    cost: Number(r.cost) || 0,
    fling: r.fling_power ? Number(r.fling_power) : null,
    effect: effects.get(r.id as string) ?? '',
    text: flavor.get(r.id as string)?.text ?? '',
  };
}).sort((a, b) => a.id - b.id).filter((item, i, list) => list.findIndex((other) => other.name === item.name) === i); // o PokéAPI repete a roseli-berry

writeFileSync(OUT, `${JSON.stringify(items)}\n`);
console.log(`${items.length} itens gravados em ${OUT}`);
