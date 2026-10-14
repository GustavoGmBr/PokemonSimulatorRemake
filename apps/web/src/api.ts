import type { CreateSaveRequest, SaveDetail, SaveSummary, StarterRegion } from '@pokesim/engine';

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
};

export type SpriteView = 'front' | 'back' | 'artwork' | 'animated' | 'animatedBack';

export function spriteUrl(speciesId: number, view: SpriteView = 'front', shiny = false): string {
  const ext = view.startsWith('animated') ? 'gif' : 'png';
  return `/assets/pokemon/${speciesId}-${view}${shiny ? 'Shiny' : ''}.${ext}`;
}
