/**
 * Origem das imagens do jogo (repositório PokeAPI/sprites) e nome dos arquivos locais.
 * Os nomes locais são os mesmos que a interface pede em /assets/pokemon/...
 */
export const SPRITES_BASE_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';

/** Itens do jogo que não existem no PokéAPI usam o sprite de um item parecido. */
export const ITEM_SPRITE_ALIAS: Record<string, string> = {
  'exp-candy-p': 'exp-candy-xs', 'exp-candy-g': 'exp-candy-l', 'exp-candy-gg': 'exp-candy-xl',
  'iv-hp': 'hp-up', 'iv-attack': 'protein', 'iv-defense': 'iron', 'iv-special-attack': 'calcium', 'iv-special-defense': 'zinc', 'iv-speed': 'carbos',
  'ultra-burst-stone': 'ultranecrozium-z', 'gmax-stone': 'max-mushrooms',
};

/** Última espécie com sprite animado (Geração V, Pokémon Black/White). */
export const LAST_ANIMATED_SPECIES = 649;

export interface SpriteSource {
  /** caminho relativo à pasta de sprites, ex.: pokemon/25-frontShiny.png */
  file: string;
  url: string;
  /** o arquivo pode não existir no repositório (ex.: animações depois da Geração V) */
  optional: boolean;
}

const VIEWS: { view: string; path: (id: number, shiny: boolean) => string; ext: string; animated?: boolean }[] = [
  { view: 'front', ext: 'png', path: (id, s) => `pokemon/${s ? 'shiny/' : ''}${id}.png` },
  { view: 'back', ext: 'png', path: (id, s) => `pokemon/back/${s ? 'shiny/' : ''}${id}.png` },
  { view: 'artwork', ext: 'png', path: (id, s) => `pokemon/other/official-artwork/${s ? 'shiny/' : ''}${id}.png` },
  { view: 'animated', ext: 'gif', animated: true, path: (id, s) => `pokemon/versions/generation-v/black-white/animated/${s ? 'shiny/' : ''}${id}.gif` },
  { view: 'animatedBack', ext: 'gif', animated: true, path: (id, s) => `pokemon/versions/generation-v/black-white/animated/back/${s ? 'shiny/' : ''}${id}.gif` },
];

/** Todas as imagens de uma espécie: 5 vistas × normal/shiny. */
export function pokemonSpriteSources(speciesId: number): SpriteSource[] {
  const list: SpriteSource[] = [];
  for (const shiny of [false, true]) {
    for (const v of VIEWS) {
      if (v.animated && speciesId > LAST_ANIMATED_SPECIES) continue;
      list.push({
        file: `pokemon/${speciesId}-${v.view}${shiny ? 'Shiny' : ''}.${v.ext}`,
        url: `${SPRITES_BASE_URL}/${v.path(speciesId, shiny)}`,
        optional: v.animated === true,
      });
    }
  }
  return list;
}

export function itemSpriteSource(name: string): SpriteSource {
  return { file: `items/${name}.png`, url: `${SPRITES_BASE_URL}/items/${ITEM_SPRITE_ALIAS[name] ?? name}.png`, optional: true };
}

/**
 * Para um pedido local (/assets/<arquivo>) ausente, devolve o endereço de origem.
 * Só aceita os nomes que o jogo gera; qualquer outra coisa retorna null.
 */
export function remoteSpriteUrl(file: string): string | null {
  let m = /^pokemon\/(\d{1,4})-(front|back|artwork|animated|animatedBack)(Shiny)?\.(png|gif)$/.exec(file);
  if (m) {
    const id = Number(m[1]);
    const hit = pokemonSpriteSources(id).find((s) => s.file === file);
    return hit?.url ?? null;
  }
  m = /^items\/([a-z0-9-]{1,60})\.png$/.exec(file);
  return m ? itemSpriteSource(m[1]!).url : null;
}
