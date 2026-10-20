/**
 * Formatos trocados entre a API (apps/server) e a interface (apps/web).
 * Mudou aqui, o TypeScript aponta os dois lados.
 */
import type { Gender, MoveCategory, Stats, TypeName } from './types.ts';
import type { IvStars } from './ivs.ts';
import type { RegionId } from './regions.ts';
import type { PokemonLocation, SortKey } from './collection.ts';
import type { DuelEvent, Pos, SlotRef } from './battle2.ts';
import type { BattleEvent, BattlePhase, BattleResult, StageKey, StatusKind } from './battle.ts';
import type { EvolutionChoice } from './evolution.ts';
import type { TransformChoice } from './transform.ts';
import type { CasinoGame, Card, RouletteColor, RouletteGroup, SlotLine, SlotSymbol } from './casino.ts';

/** Normal: nada se perde. Difícil: Pokémon que desmaia numa batalha é apagado (menos o inicial). */
export type SaveDifficulty = 'normal' | 'hard';

export interface SaveSummary {
  difficulty: SaveDifficulty;
  id: string;
  trainerName: string;
  money: number;
  chips: number;
  badges: number;
  pokedexCaught: number;
  playTimeSeconds: number;
  createdAt: string;
  updatedAt: string;
  /** primeiros Pokémon da equipe, para a prévia na tela de saves */
  teamPreview: { speciesId: number; shiny: boolean; level: number }[];
}

export interface CreateSaveRequest {
  trainerName: string;
  starterSpeciesId: number;
  difficulty?: SaveDifficulty;
}

export interface MoveView {
  name: string;
  displayName: string;
  type: TypeName;
  category: MoveCategory;
  power: number;
  accuracy: number | null;
  /** legado: o jogo não usa PP (golpes ilimitados) */
  pp: number;
  maxPp: number;
}

export interface PokemonView {
  id: string;
  speciesId: number;
  name: string;
  speciesName: string;
  nickname: string | null;
  types: TypeName[];
  level: number;
  exp: number;
  expProgress: number;
  shiny: boolean;
  gender: Gender;
  currentHp: number;
  stats: Stats;
  ivs: Stats;
  ivStars: IvStars;
  ivTotal: number;
  moves: MoveView[];
  generation: number;
  location: PokemonLocation;
  favorite: boolean;
  ball: string | null;
  caughtAt: string;
  /** evoluções que já podem ser feitas (o jogador clica em Evoluir) */
  evolutions: EvolutionChoice[];
  /** Mega, Primal, G-Max e fusões ao alcance (ou o que falta para elas) */
  forms: TransformChoice[];
  /** forma permanente atual (null = normal) */
  form: string | null;
  /** id dos arquivos de sprite (muda nas formas) */
  spriteId: number;
  /** golpes aprendidos ao subir de nível que esperam uma vaga */
  pendingMoves: MoveView[];
  friendship: number;
}

export interface InventoryEntry {
  item: string;
  displayName: string;
  category: string;
  quantity: number;
}

export interface SaveDetail extends SaveSummary {
  team: PokemonView[];
  inventory: InventoryEntry[];
}

export interface StarterOption {
  speciesId: number;
  name: string;
  types: TypeName[];
  baseStats: Stats;
}

export interface StarterRegion {
  region: RegionId;
  name: string;
  starters: StarterOption[];
}

export interface ApiError {
  error: string;
}

/** Uma caixa do PC: 30 posições, vazias como null. */
export interface BoxView {
  box: number;
  slots: (PokemonView | null)[];
  /** quantos Pokémon existem no PC inteiro */
  totalInBoxes: number;
  /** maior índice de caixa com algum Pokémon (-1 se o PC está vazio) */
  highestUsedBox: number;
}

export interface MovePokemonRequest {
  to: PokemonLocation;
}

export interface UpdatePokemonRequest {
  /** string vazia remove o apelido */
  nickname?: string;
  favorite?: boolean;
}

export interface SearchPokemonQuery {
  text?: string;
  type?: string;
  generation?: number;
  shiny?: boolean;
  minStars?: number;
  minLevel?: number;
  maxLevel?: number;
  favorite?: boolean;
  sort?: SortKey;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PokemonSearchResult {
  total: number;
  items: PokemonView[];
}

export interface PlayTimeRequest {
  seconds: number;
}

/** Resumo estático de uma espécie, para listas e para nomear a Pokédex sem baixar a ficha inteira. */
export interface SpeciesIndexEntry {
  id: number;
  name: string;
  types: TypeName[];
  generation: number;
  baseStatTotal: number;
}

/** 0 = não visto, 1 = visto, 2 = capturado; índice = número da Pokédex - 1. */
export type DexState = 0 | 1 | 2;

export interface PokedexView {
  total: number;
  seen: number;
  caught: number;
  states: DexState[];
  /** quantos exemplares do save existem por espécie (equipe + PC) */
  owned: Record<number, number>;
}

export interface HealthInfo {
  ok: boolean;
  species: number;
  /** ferramentas de teste habilitadas (apenas durante a alpha) */
  devTools: boolean;
  /** versão do jogo em execução */
  version?: string;
}

export interface DevGrantResult {
  added: number;
  inTeam: number;
  inBoxes: number;
}

// ---------------------------------------------------------------- selvagens e captura

/** Um selvagem no mapa. Só mostra o que o jogador pode ver: nome, nível, estrelas e brilho. */
export interface WildSlotView {
  slot: number;
  speciesId: number;
  name: string;
  level: number;
  shiny: boolean;
  ivStars: number;
  types: TypeName[];
  gender: Gender;
  /** a espécie já foi capturada neste save */
  caughtBefore: boolean;
}

export interface WildBoardView {
  slots: WildSlotView[];
  spinsLeft: number;
  /** giros que um mapa novo desta região recebe */
  spinsTotal: number;
  region: RegionId | 'all';
  regionName: string;
  /** mapa (habitat) desta procura */
  habitat: string;
  habitatName: string;
  /** procura por espécie específica (todos os 10 são ela) */
  targetSpeciesId: number | null;
  /** faixa de nível escolhida na procura */
  levelRange: [number, number];
}

/** Uma região na tela de busca. */
export interface WildRegionOption {
  /** 'all' = Todas as gerações (as regiões liberadas juntas) */
  id: RegionId | 'all';
  name: string;
  generation: number;
  unlocked: boolean;
  gyms: number;
  eliteMembers: number;
  elite: boolean;
  champion: boolean;
  /** nível máximo liberado para os selvagens */
  levelCap: number;
  /** giros de cada mapa nesta região */
  spins: number;
  /** Pokémon soltos no mapa (3 a 15, conforme os desafios da região) */
  mapSize: number;
  /** lendários podem aparecer (Elite dos 4 derrotada) */
  legendaries: boolean;
  /** busca por Pokémon específico liberada (campeão derrotado) */
  specific: boolean;
  /** pode escolher o mapa (habitat): os 8 ginásios da região vencidos */
  chooseHabitat: boolean;
}

export interface BallOption {
  item: string;
  displayName: string;
  description: string;
  quantity: number;
  /** chance de captura (0–1) contra o selvagem escolhido; null sem encontro */
  chance: number | null;
}

/** Resposta de GET /wild. `board` é null sem procura em andamento; `chosen` é o selvagem enfrentado. */
export interface WildState {
  board: WildBoardView | null;
  chosen: number | null;
  balls: BallOption[];
  regions: WildRegionOption[];
  money: number;
  /** preço de renovar o mapa sem giros */
  refreshCost: number;
  shinyCharm: boolean;
  catchingCharm: boolean;
}

export interface SearchWildRequest {
  region: RegionId | 'all';
  /** busca específica: id da espécie (exige o campeão da região derrotado) */
  speciesId?: number;
  /** escolher o mapa (exige os 8 ginásios da região) */
  habitat?: string;
  minLevel?: number;
  maxLevel?: number;
}

export interface ChooseWildRequest {
  slot: number;
}

export interface ThrowBallRequest {
  ball: string;
}

export interface ThrowBallResult {
  shakes: 0 | 1 | 2 | 3;
  caught: boolean;
  chance: number;
  /** o Pokémon capturado, já com o lugar onde foi parar */
  pokemon: PokemonView | null;
  state: WildState;
}

// ---------------------------------------------------------------- itens, loja e Centro Pokémon

export interface ShopEntry {
  item: string;
  displayName: string;
  category: string;
  description: string;
  price: number;
  /** quantos o jogador já tem */
  owned: number;
}

export interface BuyRequest {
  cart: { item: string; quantity: number }[];
}

export interface BuyResult {
  spent: number;
  money: number;
  /** Bolas Premier ganhas de brinde */
  premier: number;
}

export interface UseItemRequest {
  item: string;
  pokemonId: string;
}

export interface UseItemResult {
  pokemon: PokemonView;
  healed: number;
  remaining: number;
  /** frase pronta para mostrar (Essência, Doce…) */
  message?: string;
}

export interface DevKitResult {
  balls: number;
}

export interface DevProgressResult {
  /** o desafio liberado agora (ex.: "kanto:gym3"); null se tudo já estava feito */
  granted: string | null;
}

// ---------------------------------------------------------------- batalha

export interface BattleMonView {
  index: number;
  speciesId: number;
  /** id dos arquivos de sprite (formas Mega etc.) */
  spriteId: number;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  status: StatusKind | null;
  confused: boolean;
  shiny: boolean;
  types: TypeName[];
  /** só estágios diferentes de zero */
  stages: Partial<Record<StageKey, number>>;
  expProgress: number;
}

export interface BattleMoveView extends Omit<MoveView, 'pp' | 'maxPp'> {
  slot: number;
  /** multiplicador de tipo contra o oponente em campo (null = golpe de status) */
  effectiveness: number | null;
}

export interface BattleItemOption {
  item: string;
  displayName: string;
  quantity: number;
}

export interface BattleOutcome {
  result: BattleResult;
  money: number;
  caught: PokemonView | null;
  /** nomes dos Pokémon que ganharam XP, com o nível final */
  levels: { name: string; level: number }[];
  /** Pokémon que ficaram com golpes pendentes */
  pending: string[];
  /** prêmios em itens (treinadores aleatórios) */
  rewards: { item: string; name: string; quantity: number }[];
  /** insígnia/troféu do desafio vencido (id), se foi a primeira vez */
  badge: string | null;
  trainerName: string | null;
  /** modo difícil: Pokémon perdidos para sempre nesta batalha */
  fallen?: string[];
  /** batalha de torneio: andamento da copa */
  tournament?: TournamentProgress | null;
}

export interface BattleView {
  /** treinador do outro lado (null = selvagem: dá para fugir e capturar) */
  trainer: { name: string; title: string; skill: number; bagLeft: number } | null;
  phase: BattlePhase;
  turn: number;
  player: { active: number; team: BattleMonView[]; moves: BattleMoveView[] };
  foe: { active: number; team: BattleMonView[]; caughtBefore: boolean };
  balls: BallOption[];
  heals: BattleItemOption[];
  outcome: BattleOutcome | null;
}

export type BattleActRequest =
  | { kind: 'move'; slot: number }
  | { kind: 'switch'; to: number }
  | { kind: 'run' }
  | { kind: 'ball'; item: string }
  | { kind: 'item'; item: string; target: number };

/** Resposta de iniciar ou agir: os eventos para animar e o estado depois deles. */
export interface BattleTurnResult {
  events: BattleEvent[];
  view: BattleView;
}

/** Um golpe que o Pokémon pode aprender (nível já alcançado = grátis; TM = comprada uma vez por save). */
export interface LearnableMove {
  move: MoveView;
  source: 'level' | 'machine';
  /** nível em que aprende (só source 'level') */
  level: number;
  /** quanto custa agora (0 = grátis ou TM já comprada) */
  price: number;
  unlocked: boolean;
  /** já está entre os golpes dele */
  known: boolean;
}

export interface MoveOptions {
  learnable: LearnableMove[];
  money: number;
}

export interface TeachMoveRequest {
  move: string;
  /** vaga 0–3 (a próxima vaga livre, se ele tem menos de 4 golpes) */
  slot: number;
}

export interface EvolveRequest {
  speciesId: number;
}

export interface LearnMoveRequest {
  move: string;
  /** posição (0–3) do golpe que será esquecido; null descarta o golpe novo */
  replace: number | null;
}

// ---------------------------------------------------------------- desafios e treinadores

export interface ChallengeView {
  id: string;
  region: string;
  regionName: string;
  circuit: string;
  circuitName: string;
  kind: 'gym' | 'elite' | 'champion';
  number: number;
  name: string;
  title: string;
  group: string;
  type: string;
  level: number;
  team: { speciesId: number; name: string }[];
  won: boolean;
  unlocked: boolean;
  lockReason: string | null;
  /** o jogador só pode usar Pokémon dessa faixa da Pokédex */
  dex: [number, number];
  /** habilidade da IA do líder (1–3) */
  skill: number;
  /** itens de cura que o líder usa */
  bag: { name: string; quantity: number }[];
}

export interface TrainerOption {
  id: 'facil' | 'medio' | 'dificil';
  name: string;
  description: string;
  money: number;
  levels: [number, number];
  teamSize: [number, number];
  rewards: { item: string; name: string; quantity: number }[];
}

export interface ChallengesState {
  challenges: ChallengeView[];
  trainers: TrainerOption[];
  /** regiões liberadas */
  unlockedRegions: string[];
  /** nível máximo que o desafio permite ao seu time (nível do líder) é mostrado em cada desafio */
  badges: number;
  /** Novo Ciclo (New Game+) */
  ngplus: NgPlusState;
}

export interface NgChallengeView {
  id: string;
  kind: 'champion' | 'iconic';
  region: string | null;
  regionName: string | null;
  name: string;
  title: string;
  level: number;
  team: { speciesId: number; name: string }[];
  blurb: string;
  /** vezes que você já venceu */
  wins: number;
  money: number;
  rewards: { item: string; name: string; quantity: number }[];
  /** bônus que só vale na primeira vitória */
  firstWinBonus: { item: string; name: string; quantity: number }[];
}

export interface NgPlusState {
  unlocked: boolean;
  /** quantos campeões faltam e quais */
  missing: string[];
  entries: NgChallengeView[];
}

// ---------------------------------------------------------------- equipes nomeadas

export interface TeamMemberView {
  id: string;
  speciesId: number;
  spriteId: number;
  name: string;
  level: number;
  shiny: boolean;
}

export interface TeamView {
  id: string;
  name: string;
  members: TeamMemberView[];
  /** é a equipe que está montada agora */
  active: boolean;
}

// ---------------------------------------------------------------- Pokécassino


export interface CasinoPrize {
  item: string;
  displayName: string;
  /** preço em fichas */
  price: number;
  owned: number;
}

/** Aposta em fichas ou em um Pokémon da coleção. */
export interface CasinoStakeInput {
  bet?: number;
  pokemonId?: string;
}

export interface CasinoStakeResult {
  kind: 'chips' | 'pokemon';
  /** fichas apostadas (0 quando a aposta é um Pokémon) */
  bet: number;
  /** retorno total em fichas (aposta em fichas) */
  payout: number;
  /** ganho líquido em fichas */
  net: number;
  multiplier: number;
  pokemon: null | { name: string; speciesId: number; spriteId: number; value: number; lost: boolean; prizeMoney: number; prizeChips: number };
}

export type CasinoDetail =
  | { game: 'slots'; grid: SlotSymbol[]; lines: SlotLine[] }
  | { game: 'roulette'; number: number; color: RouletteColor; group: RouletteGroup }
  | { game: 'race'; frames: number[][]; winner: number; pick: number }
  | { game: 'wheel'; index: number; multiplier: number }
  | { game: 'voltorb'; board: number[]; revealed: number[]; hit: boolean }
  | { game: 'jack'; player: Card[]; dealer: Card[]; result: string | null; doubled: boolean }
  | { game: 'piplup'; jumps: number; fell: boolean };

export interface CasinoResult {
  game: CasinoGame;
  stake: CasinoStakeResult;
  detail: CasinoDetail;
  chips: number;
  money: number;
}

export interface CasinoStakeView { kind: 'chips' | 'pokemon'; bet: number; pokemonName: string | null }

export type CasinoRoundView =
  | { game: 'voltorb'; stake: CasinoStakeView; revealed: { index: number; value: number }[]; picksLeft: number; multiplier: number }
  | { game: 'jack'; stake: CasinoStakeView; player: Card[]; dealer: Card[]; playerTotal: number; canDouble: boolean }
  | { game: 'piplup'; stake: CasinoStakeView; jumps: number; multiplier: number; nextOdds: number; nextMultiplier: number };

export interface CasinoState {
  chips: number;
  money: number;
  chipPrice: number;
  prizes: CasinoPrize[];
  round: CasinoRoundView | null;
}

export interface CasinoActResult {
  round: CasinoRoundView | null;
  result: CasinoResult | null;
  chips: number;
  money: number;
}

// ---------------------------------------------------------------- torneios

export interface TournamentTierView {
  id: string;
  name: string;
  description: string;
  entry: number;
  cap: number;
  rounds: number;
  prizeMoney: number;
  prizeItems: { item: string; name: string; min: number; max: number }[];
  essences: number;
  minLevel: number;
  teamSize: [number, number];
  /** quantas vezes você já ganhou esta copa */
  wins: number;
  /** copa em duplas (2×2) */
  doubles?: boolean;
}

export interface TournamentRun {
  tier: string;
  tierName: string;
  /** rodada em disputa (1–8) */
  round: number;
  rounds: number;
  cap: number;
  members: TeamMemberView[];
  /** true = há uma batalha aberta; false = pronto para a próxima rodada */
  inBattle: boolean;
}

export interface TournamentState {
  tiers: TournamentTierView[];
  active: TournamentRun | null;
  money: number;
  /** Pokémon da equipe que podem se inscrever */
  team: TeamMemberView[];
}

/** Resultado de uma batalha de torneio (dentro do BattleOutcome). */
export interface TournamentProgress {
  tierName: string;
  /** rodada que acabou de ser vencida/perdida */
  round: number;
  rounds: number;
  /** campeão: prêmio pago */
  champion: boolean;
  eliminated: boolean;
  prizeMoney: number;
  prizeItems: { item: string; name: string; quantity: number }[];
}

// ---------------------------------------------------------------- missões, mercado e perfil

export interface MissionView {
  index: number;
  kind: string;
  title: string;
  target: number;
  progress: number;
  done: boolean;
  claimed: boolean;
  reward: { money: number; chips: number; items: { item: string; name: string; quantity: number }[] };
}

export interface MissionsState {
  period: number;
  expiresAt: string;
  msLeft: number;
  allDone: boolean;
  bonusClaimed: boolean;
  bonus: { money: number; chips: number; items: { item: string; name: string; quantity: number }[] };
  missions: MissionView[];
}

export interface MissionClaimResult {
  reward: MissionView['reward'];
  bonus: MissionsState['bonus'] | null;
  state: MissionsState;
}

export interface HistoryEvent { id: number; kind: string; text: string; at: string }

export interface JourneyStats {
  victories: number;
  defeats: number;
  captures: number;
  shinyEncounters: number;
  sold: number;
  trainersBeaten: number;
  tournamentTitles: number;
  moneyEarnedSales: number;
  pokemonOwned: number;
  speciesCaught: number;
  playTimeSeconds: number;
}

export interface HistoryState { stats: JourneyStats; events: HistoryEvent[] }

export interface MarketEntry {
  id: string;
  speciesId: number;
  spriteId: number;
  name: string;
  generation: number;
  regionUnlocked: boolean;
  level: number;
  shiny: boolean;
  stars: number;
  price: number;
  available: boolean;
  favorite: boolean;
}

export interface SaleOffer { id: string; speciesId: number; spriteId: number; name: string; level: number; shiny: boolean; favorite: boolean; value: number; ball: string | null; stars: number; inTeam: boolean; generation: number }

export interface MarketState {
  money: number;
  stock: MarketEntry[];
  msLeft: number;
  refreshPrice: number;
  sellable: SaleOffer[];
}

/** Resultado da auto-batalha em selvagens (um mapa por vez). */
export interface AutoWildReport {
  fights: number;
  wins: number;
  losses: number;
  money: number;
  /** Pokémon que subiram de nível, com o nível final */
  levelUps: { name: string; level: number }[];
  /** por que parou antes de limpar o mapa (null = limpou) */
  stopped: null | {
    reason: 'shiny' | 'stars' | 'defeat' | 'lead';
    message: string;
    /** Pokémon especial que está no mapa */
    slot?: { slot: number; speciesId: number; name: string; level: number; shiny: boolean; ivStars: number };
  };
}

export interface AutoWildResult {
  report: AutoWildReport;
  state: WildState;
}

// ---------------------------------------------------------------- batalhas em dupla (2×2)

export interface DoublesMoveView extends Omit<MoveView, 'pp' | 'maxPp'> {
  slot: number;
  /** como o golpe escolhe alvo */
  target: string;
  /** atinge mais de um alvo (dano ×0,75) */
  spread: boolean;
  /** precisa de alvo escolhido (golpes de um alvo) */
  needsTarget: boolean;
  /** efetividade contra o adversário de cada posição (null = status ou posição vazia) */
  effectiveness: [number | null, number | null];
}

export interface DoublesView {
  trainer: { name: string; title: string; skill: number };
  phase: BattlePhase;
  turn: number;
  player: {
    team: BattleMonView[];
    /** índice na equipe de cada posição (-1 = vazia) */
    active: [number, number];
    /** golpes de quem está em cada posição (null = vazia ou desmaiado) */
    moves: [DoublesMoveView[] | null, DoublesMoveView[] | null];
  };
  foe: { team: BattleMonView[]; active: [number, number] };
  /** quantos Pokémon você precisa escolher na fase de troca */
  replacements: number;
  outcome: BattleOutcome | null;
}

export interface DoublesTurnResult {
  doubles: true;
  events: DuelEvent[];
  view: DoublesView;
}

export type DoublesActRequest =
  | { actions: ({ kind: 'move'; slot: number; target?: SlotRef } | { kind: 'switch'; to: number } | null)[] }
  | { replace: { pos: Pos; to: number }[] };
