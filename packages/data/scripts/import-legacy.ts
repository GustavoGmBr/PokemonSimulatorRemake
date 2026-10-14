/**
 * Converte o catálogo da versão anterior (backend/data/catalogo.json) para o
 * formato tipado do remake, em packages/data/catalog/*.json.
 *
 * Uso: npm run data:import -- "E:\Projetos\PokemonSimulator Sqlite"
 * Sem argumento, procura a pasta "PokemonSimulator Sqlite" ao lado deste projeto.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Catalog, EvolutionCondition, EvolutionNode, FormKind, GrowthRate, Item, ItemCategory, LearnMethod,
  Move, MoveCategory, Species, SpeciesForm, Stats, TypeInfo, TypeName,
} from '@pokesim/engine';
import { generationOf } from '@pokesim/engine';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const legacyRoot = path.resolve(process.argv[2] ?? path.join(repoRoot, '..', 'PokemonSimulator Sqlite'));
const legacyCatalog = path.join(legacyRoot, 'backend', 'data', 'catalogo.json');
const outDir = path.resolve(here, '../catalog');

if (!existsSync(legacyCatalog)) {
  console.error(`Catálogo antigo não encontrado em: ${legacyCatalog}`);
  process.exit(1);
}

// ---- formato antigo (somente o que usamos) ----
type LegacyStats = Record<'hp' | 'attack' | 'defense' | 'special-attack' | 'special-defense' | 'speed', number>;
interface LegacyCondition {
  gatilho: string; nivel: number | null; item: string | null; felicidade: number | null; periodo: string;
  tipoGolpeConhecido: string | null; itemSegurado: string | null;
}
interface LegacyEvolution { especieId: number; condicoes: LegacyCondition[]; evolucoes: LegacyEvolution[] }
interface LegacyForm { nome: string; nomeExibicao: string; itemId?: string | null; tipos: TypeName[]; atributosBase: LegacyStats; sprites?: { front?: string } }
interface LegacySpecies {
  id: number; nome: string; nomeExibicao: string; tipos: TypeName[]; atributosBase: LegacyStats; altura: number; peso: number;
  experienciaBase: number; taxaCaptura: number; felicidadeBase: number | null; proporcaoFemeas: number; lendario: boolean; mitico: boolean;
  habilidades: { nome: string; oculta: boolean }[]; crescimento: GrowthRate; evolucao: LegacyEvolution;
  golpesAprendidos: { golpe: string; metodo: string; nivel: number }[];
  formasMega?: LegacyForm[]; formasPrimal?: LegacyForm[]; formasGmax?: LegacyForm[]; formasFusao?: LegacyForm[];
}
interface LegacyMove {
  id: number; nome: string; tipo: TypeName; categoria: MoveCategory; poder: number | null; precisao: number | null; pp: number | null;
  prioridade: number; alvo: string;
  meta: null | { ailment?: { name: string }; ailment_chance?: number; flinch_chance?: number; crit_rate?: number; drain?: number; healing?: number; min_hits?: number | null; max_hits?: number | null; stat_chance?: number };
  alteracoesAtributos?: { atributo?: string; stat?: { name: string }; mudanca?: number; change?: number }[];
}
interface LegacyType { nome: TypeName; relacoesDano: { double_damage_to: TypeName[]; half_damage_to: TypeName[]; no_damage_to: TypeName[] } }
interface LegacyItem { id: number; nome: string; nomeExibicao: string; categoria: ItemCategory; descricao: string; precoLoja: number | null }
interface LegacyCatalog { pokemon: LegacySpecies[]; golpes: LegacyMove[]; tipos: LegacyType[]; itens: LegacyItem[] }

const legacy = JSON.parse(readFileSync(legacyCatalog, 'utf8')) as LegacyCatalog;

const stats = (s: LegacyStats): Stats => ({
  hp: s.hp, atk: s.attack, def: s.defense, spa: s['special-attack'], spd: s['special-defense'], spe: s.speed,
});

const titleCase = (name: string) => name.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

const condition = (c: LegacyCondition): EvolutionCondition => ({
  trigger: c.gatilho, level: c.nivel, item: c.item, happiness: c.felicidade,
  timeOfDay: c.periodo || null, knownMoveType: c.tipoGolpeConhecido, heldItem: c.itemSegurado,
});

const evolution = (node: LegacyEvolution): EvolutionNode => ({
  speciesId: node.especieId,
  conditions: node.condicoes.map(condition),
  evolvesTo: node.evolucoes.map(evolution),
});

const LEARN_METHODS = new Set<LearnMethod>(['level-up', 'machine', 'tutor', 'egg']);

function forms(entry: LegacySpecies): SpeciesForm[] {
  const groups: [FormKind, LegacyForm[] | undefined][] = [
    ['mega', entry.formasMega], ['primal', entry.formasPrimal], ['gmax', entry.formasGmax], ['fusion', entry.formasFusao],
  ];
  return groups.flatMap(([kind, list]) => (list ?? []).map((form) => {
    const spriteId = Number(/\/(\d+)-front/.exec(form.sprites?.front ?? '')?.[1] ?? entry.id);
    return {
      name: form.nome, displayName: form.nomeExibicao, kind, spriteId, requiredItem: form.itemId ?? null,
      types: form.tipos, baseStats: stats(form.atributosBase),
    };
  }));
}

const species: Species[] = legacy.pokemon.map((entry) => ({
  id: entry.id,
  name: entry.nome,
  displayName: entry.nomeExibicao,
  generation: generationOf(entry.id),
  types: entry.tipos,
  baseStats: stats(entry.atributosBase),
  height: entry.altura,
  weight: entry.peso,
  baseExp: entry.experienciaBase ?? 0,
  captureRate: entry.taxaCaptura,
  baseHappiness: entry.felicidadeBase ?? 70,
  femaleEighths: entry.proporcaoFemeas,
  legendary: entry.lendario,
  mythical: entry.mitico,
  growthRate: entry.crescimento,
  abilities: entry.habilidades.map((ability) => ({ name: ability.nome, hidden: ability.oculta })),
  learnset: entry.golpesAprendidos
    .filter((learned) => LEARN_METHODS.has(learned.metodo as LearnMethod))
    .map((learned) => ({ move: learned.golpe, method: learned.metodo as LearnMethod, level: learned.nivel })),
  evolutionChain: evolution(entry.evolucao),
  forms: forms(entry),
}));

const moves: Move[] = legacy.golpes.map((entry) => ({
  id: entry.id,
  name: entry.nome,
  displayName: titleCase(entry.nome),
  type: entry.tipo,
  category: entry.categoria,
  power: entry.poder ?? 0,
  accuracy: entry.precisao,
  pp: entry.pp ?? 5,
  priority: entry.prioridade ?? 0,
  target: entry.alvo,
  ailment: entry.meta?.ailment?.name && entry.meta.ailment.name !== 'none' ? entry.meta.ailment.name : null,
  ailmentChance: entry.meta?.ailment_chance ?? 0,
  flinchChance: entry.meta?.flinch_chance ?? 0,
  critRate: entry.meta?.crit_rate ?? 0,
  drain: entry.meta?.drain ?? 0,
  healing: entry.meta?.healing ?? 0,
  minHits: entry.meta?.min_hits ?? null,
  maxHits: entry.meta?.max_hits ?? null,
  statChanges: (entry.alteracoesAtributos ?? []).map((change) => ({
    stat: change.atributo ?? change.stat?.name ?? '',
    change: change.mudanca ?? change.change ?? 0,
  })).filter((change) => change.stat),
  statChance: entry.meta?.stat_chance ?? 0,
}));

const types: TypeInfo[] = legacy.tipos.map((entry) => ({
  name: entry.nome,
  doubleTo: entry.relacoesDano.double_damage_to,
  halfTo: entry.relacoesDano.half_damage_to,
  noneTo: entry.relacoesDano.no_damage_to,
}));

const items: Item[] = legacy.itens.map((entry) => ({
  id: entry.id,
  name: entry.nome,
  displayName: entry.nomeExibicao,
  category: entry.categoria,
  description: entry.descricao,
  price: entry.precoLoja ?? null,
}));

const catalog: Catalog = { species, moves, types, items };
mkdirSync(outDir, { recursive: true });
for (const [name, value] of Object.entries(catalog)) {
  writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(value)}\n`);
}
console.log(`Catálogo importado de ${legacyRoot}`);
console.log(`  ${species.length} espécies, ${moves.length} golpes, ${types.length} tipos, ${items.length} itens → ${outDir}`);
