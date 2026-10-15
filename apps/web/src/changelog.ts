/** Novidades mostradas na tela de abertura (a mais recente primeiro). */
export interface ChangelogEntry { version: string; items: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  { version: '2.0.0-alpha.16', items: [
    'Líderes, Elite, Campeões e treinadores ganharam retrato pixel-art (na lista de desafios e na batalha).',
    'Batalha: números de dano, aviso de crítico e auras que ficam no Pokémon com status.',
    'Trilha sonora própria por tela (menu, selvagens, batalha, ginásio, cassino, loja). Volume em Opções.',
    'Temas por região (cores e moldura) e modos Escuro e Alto contraste, em Opções.',
    'Tela de abertura com o resumo da sua última jornada e estas novidades.',
  ] },
  { version: '2.0.0-alpha.15', items: [
    'Backup automático a cada abertura (últimos 5), além de exportar e importar saves.',
    'Auto-batalha nos selvagens: para sozinha se aparecer shiny ou 4★.',
    'Atalhos "toda a equipe" na Equipe e na Mochila; filtros e alertas no Mercado; venda em massa no PC.',
    'Ponto vermelho no menu para missões prontas e Pokémon especial no Mercado.',
  ] },
  { version: '2.0.0-alpha.14', items: [
    'Mochila em seções, giro automático no caça-níqueis e 16 Pokémon no Mercado.',
  ] },
];
