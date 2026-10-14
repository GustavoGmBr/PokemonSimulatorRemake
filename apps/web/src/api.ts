import type {
  BoxView, CreateSaveRequest, DevGrantResult, HealthInfo, Item, Move, PokedexView, PokemonLocation, PokemonSearchResult,
  PokemonView, SaveDetail, SaveSummary, SearchPokemonQuery, Species, SpeciesIndexEntry, StarterRegion, TypeInfo,
  UpdatePokemonRequest,
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
