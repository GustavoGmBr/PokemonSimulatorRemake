import type {
  AutoWildResult, DoublesActRequest, DoublesTurnResult, DoublesView,
  BattleActRequest, HistoryState, MarketState, MissionClaimResult, MissionsState, PokemonView as MarketPokemon, CasinoActResult, CasinoResult, CasinoState, CasinoStakeInput, TournamentState, ChallengesState, TeamView, MoveOptions, BattleTurnResult, BattleView, BuyResult, DevKitResult, DevProgressResult, SearchWildRequest, ShopEntry, ThrowBallResult, UseItemResult, WildState,
  BoxView, CreateSaveRequest, DevGrantResult, HealthInfo, Item, Move, PokedexView, PokemonLocation, PokemonSearchResult,
  PokemonView, SaveDetail, SaveSummary, SearchPokemonQuery, Species, SpeciesIndexEntry, StarterRegion, TypeInfo,
  UpdatePokemonRequest, PokeapiItem,
} from '@pokesim/engine';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Não foi possível falar com o servidor do jogo. Ele está aberto?');
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Erro ${res.status}`);
  return json as T;
}

export const api = {
  exportSave: (id: string) => request<unknown>('GET', `/api/saves/${encodeURIComponent(id)}/export`),
  importSave: (data: unknown) => request<SaveDetail>('POST', '/api/saves/import', data),
  backups: () => request<{ dir: string | null; backups: { name: string; size: number; createdAt: string }[] }>('GET', '/api/backups'),
  listSaves: () => request<SaveSummary[]>('GET', '/api/saves'),
  getSave: (id: string) => request<SaveDetail>('GET', `/api/saves/${encodeURIComponent(id)}`),
  createSave: (input: CreateSaveRequest) => request<SaveDetail>('POST', '/api/saves', input),
  deleteSave: (id: string) => request<void>('DELETE', `/api/saves/${encodeURIComponent(id)}`),
  starters: () => request<StarterRegion[]>('GET', '/api/starters'),
  health: () => request<HealthInfo>('GET', '/api/health'),
  playTime: (id: string, seconds: number) => request<void>('POST', `/api/saves/${encodeURIComponent(id)}/playtime`, { seconds }),
  box: (id: string, box: number) => request<BoxView>('GET', `/api/saves/${encodeURIComponent(id)}/box/${box}`),
  search: (id: string, query: SearchPokemonQuery) =>
    request<PokemonSearchResult>('GET', `/api/saves/${encodeURIComponent(id)}/pokemon${queryString(query)}`),
  movePokemon: (id: string, pokemonId: string, to: PokemonLocation) =>
    request<void>('POST', `/api/saves/${encodeURIComponent(id)}/pokemon/${encodeURIComponent(pokemonId)}/move`, { to }),
  updatePokemon: (id: string, pokemonId: string, patch: UpdatePokemonRequest) =>
    request<PokemonView>('PATCH', `/api/saves/${encodeURIComponent(id)}/pokemon/${encodeURIComponent(pokemonId)}`, patch),
  pokedex: (id: string) => request<PokedexView>('GET', `/api/saves/${encodeURIComponent(id)}/pokedex`),
  devGrant: (id: string, count: number) =>
    request<DevGrantResult>('POST', `/api/saves/${encodeURIComponent(id)}/dev/grant`, { count }),
  wild: (id: string) => request<WildState>('GET', `/api/saves/${encodeURIComponent(id)}/wild`),
  wildSearch: (id: string, input: SearchWildRequest) => request<WildState>('POST', `/api/saves/${encodeURIComponent(id)}/wild/search`, input),
  wildSpin: (id: string, pay = false) => request<WildState>('POST', `/api/saves/${encodeURIComponent(id)}/wild/spin`, { pay }),
  wildAuto: (id: string) => request<AutoWildResult>('POST', `/api/saves/${encodeURIComponent(id)}/wild/auto`),
  wildLeave: (id: string) => request<WildState>('POST', `/api/saves/${encodeURIComponent(id)}/wild/leave`),
  wildChoose: (id: string, slot: number) => request<WildState>('POST', `/api/saves/${encodeURIComponent(id)}/wild/choose`, { slot }),
  wildFlee: (id: string) => request<WildState>('POST', `/api/saves/${encodeURIComponent(id)}/wild/flee`),
  battle: (id: string) => request<BattleView | null>('GET', `/api/saves/${encodeURIComponent(id)}/battle`),
  battleStart: (id: string) => request<BattleTurnResult>('POST', `/api/saves/${encodeURIComponent(id)}/battle/start`),
  battleAct: (id: string, action: BattleActRequest) => request<BattleTurnResult>('POST', `/api/saves/${encodeURIComponent(id)}/battle/act`, action),
  battle2: (id: string) => request<DoublesView | null>('GET', `/api/saves/${encodeURIComponent(id)}/battle2`),
  battle2Trainer: (id: string, difficulty: string) => request<DoublesTurnResult>('POST', `/api/saves/${encodeURIComponent(id)}/battle2/trainer`, { difficulty }),
  battle2Act: (id: string, action: DoublesActRequest) => request<DoublesTurnResult>('POST', `/api/saves/${encodeURIComponent(id)}/battle2/act`, action),
  challenges: (id: string) => request<ChallengesState>('GET', `/api/saves/${encodeURIComponent(id)}/challenges`),
  challengeStart: (id: string, challengeId: string) => request<BattleTurnResult>('POST', `/api/saves/${encodeURIComponent(id)}/battle/challenge`, { challengeId }),
  trainerStart: (id: string, difficulty: string) => request<BattleTurnResult>('POST', `/api/saves/${encodeURIComponent(id)}/battle/trainer`, { difficulty }),
  casino: (id: string) => request<CasinoState>('GET', `/api/saves/${encodeURIComponent(id)}/casino`),
  casinoChips: (id: string, amount: number) => request<CasinoState>('POST', `/api/saves/${encodeURIComponent(id)}/casino/chips`, { amount }),
  casinoPrize: (id: string, item: string, quantity = 1) => request<CasinoState>('POST', `/api/saves/${encodeURIComponent(id)}/casino/prize`, { item, quantity }),
  casinoPlay: (id: string, game: string, body: CasinoStakeInput & Record<string, unknown>) =>
    request<CasinoResult>('POST', `/api/saves/${encodeURIComponent(id)}/casino/${game}/play`, body),
  casinoStart: (id: string, game: string, body: CasinoStakeInput) => request<CasinoActResult>('POST', `/api/saves/${encodeURIComponent(id)}/casino/${game}/start`, body),
  casinoAct: (id: string, action: string, index?: number) => request<CasinoActResult>('POST', `/api/saves/${encodeURIComponent(id)}/casino/round/act`, { action, index }),
  casinoAbandon: (id: string) => request<CasinoActResult>('POST', `/api/saves/${encodeURIComponent(id)}/casino/round/abandon`),
  tournaments: (id: string) => request<TournamentState>('GET', `/api/saves/${encodeURIComponent(id)}/tournaments`),
  tournamentEnter: (id: string, tier: string, members: string[]) => request<BattleTurnResult | DoublesTurnResult>('POST', `/api/saves/${encodeURIComponent(id)}/tournaments/enter`, { tier, members }),
  tournamentNext: (id: string) => request<BattleTurnResult | DoublesTurnResult>('POST', `/api/saves/${encodeURIComponent(id)}/tournaments/next`),
  tournamentAbandon: (id: string) => request<TournamentState>('POST', `/api/saves/${encodeURIComponent(id)}/tournaments/abandon`),
  missions: (id: string) => request<MissionsState>('GET', `/api/saves/${encodeURIComponent(id)}/missions`),
  missionClaim: (id: string, period: number, index: number) => request<MissionClaimResult>('POST', `/api/saves/${encodeURIComponent(id)}/missions/claim`, { period, index }),
  history: (id: string) => request<HistoryState>('GET', `/api/saves/${encodeURIComponent(id)}/history`),
  market: (id: string) => request<MarketState>('GET', `/api/saves/${encodeURIComponent(id)}/market`),
  marketBuy: (id: string, stockId: string) => request<{ state: MarketState; pokemon: MarketPokemon; price: number }>('POST', `/api/saves/${encodeURIComponent(id)}/market/buy`, { id: stockId }),
  marketRefresh: (id: string) => request<MarketState>('POST', `/api/saves/${encodeURIComponent(id)}/market/refresh`),
  marketFavorite: (id: string, stockId: string, favorite: boolean) => request<MarketState>('POST', `/api/saves/${encodeURIComponent(id)}/market/favorite`, { id: stockId, favorite }),
  marketSell: (id: string, ids: string[]) => request<{ sold: number; money: number; state: MarketState }>('POST', `/api/saves/${encodeURIComponent(id)}/market/sell`, { ids }),
  transform: (id: string, pokemonId: string, form: string) =>
    request<PokemonView>('POST', `/api/saves/${encodeURIComponent(id)}/pokemon/${encodeURIComponent(pokemonId)}/transform`, { form }),
  teams: (id: string) => request<TeamView[]>('GET', `/api/saves/${encodeURIComponent(id)}/teams`),
  teamCreate: (id: string, name: string) => request<TeamView[]>('POST', `/api/saves/${encodeURIComponent(id)}/teams`, { name }),
  teamUpdate: (id: string, teamId: string, patch: { name?: string; useCurrent?: boolean }) =>
    request<TeamView[]>('PATCH', `/api/saves/${encodeURIComponent(id)}/teams/${encodeURIComponent(teamId)}`, patch),
  teamDelete: (id: string, teamId: string) => request<TeamView[]>('DELETE', `/api/saves/${encodeURIComponent(id)}/teams/${encodeURIComponent(teamId)}`),
  teamApply: (id: string, teamId: string) => request<TeamView[]>('POST', `/api/saves/${encodeURIComponent(id)}/teams/${encodeURIComponent(teamId)}/apply`),
  evolve: (id: string, pokemonId: string, speciesId: number) =>
    request<PokemonView>('POST', `/api/saves/${encodeURIComponent(id)}/pokemon/${encodeURIComponent(pokemonId)}/evolve`, { speciesId }),
  learnMove: (id: string, pokemonId: string, move: string, replace: number | null) =>
    request<PokemonView>('POST', `/api/saves/${encodeURIComponent(id)}/pokemon/${encodeURIComponent(pokemonId)}/learn`, { move, replace }),
  moveOptions: (id: string, pokemonId: string) => request<MoveOptions>('GET', `/api/saves/${encodeURIComponent(id)}/pokemon/${encodeURIComponent(pokemonId)}/moves`),
  buyTm: (id: string, pokemonId: string, move: string) =>
    request<MoveOptions>('POST', `/api/saves/${encodeURIComponent(id)}/pokemon/${encodeURIComponent(pokemonId)}/tm`, { move }),
  teachMove: (id: string, pokemonId: string, move: string, slot: number) =>
    request<PokemonView>('POST', `/api/saves/${encodeURIComponent(id)}/pokemon/${encodeURIComponent(pokemonId)}/teach`, { move, slot }),
  wildThrow: (id: string, ball: string) => request<ThrowBallResult>('POST', `/api/saves/${encodeURIComponent(id)}/wild/throw`, { ball }),
  shop: (id: string) => request<ShopEntry[]>('GET', `/api/saves/${encodeURIComponent(id)}/shop`),
  buy: (id: string, cart: { item: string; quantity: number }[]) => request<BuyResult>('POST', `/api/saves/${encodeURIComponent(id)}/shop/buy`, { cart }),
  useItem: (id: string, item: string, pokemonId: string) => request<UseItemResult>('POST', `/api/saves/${encodeURIComponent(id)}/items/use`, { item, pokemonId }),
  devKit: (id: string) => request<DevKitResult>('POST', `/api/saves/${encodeURIComponent(id)}/dev/kit`),
  devProgress: (id: string, all = false) => request<DevProgressResult>('POST', `/api/saves/${encodeURIComponent(id)}/dev/progress`, { all }),
  devHurt: (id: string) => request<{ hurt: number }>('POST', `/api/saves/${encodeURIComponent(id)}/dev/hurt`),
  pokeapiItems: cached('pokeapi-items', () => request<PokeapiItem[]>('GET', '/api/catalog/pokeapi-items')),
  speciesIndex: cached('species-index', () => request<SpeciesIndexEntry[]>('GET', '/api/catalog/species-index')),
  moves: cached('moves', () => request<Move[]>('GET', '/api/catalog/moves')),
  types: cached('types', () => request<TypeInfo[]>('GET', '/api/catalog/types')),
  items: cached('items', () => request<Item[]>('GET', '/api/catalog/items')),
  species: (id: number) => request<Species>('GET', `/api/species/${id}`),
};

function queryString(query: SearchPokemonQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Catálogos estáticos: baixados uma vez por sessão. */
function cached<T>(_name: string, load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    promise ??= load().catch((error: unknown) => {
      promise = null; // permite tentar de novo se o servidor estava fora
      throw error;
    });
    return promise;
  };
}

export type SpriteView = 'front' | 'back' | 'artwork' | 'animated' | 'animatedBack';

export function spriteUrl(speciesId: number, view: SpriteView = 'front', shiny = false): string {
  const ext = view.startsWith('animated') ? 'gif' : 'png';
  return `/assets/pokemon/${speciesId}-${view}${shiny ? 'Shiny' : ''}.${ext}`;
}

/** Sprite oficial do item (repositório PokeAPI/sprites); se não carregar, a interface mostra um quadrado. */
export function itemSpriteUrl(name: string): string {
  return `/assets/items/${name}.png`;
}
