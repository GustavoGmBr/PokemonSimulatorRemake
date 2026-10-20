/** Novidades mostradas na tela de abertura (a mais recente primeiro). */
export interface ChangelogEntry { version: string; items: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  { version: '2.0.0-alpha.21', items: [
    'Ordenar golpes: na ficha do Pokémon, o botão "Ordenar golpes" escolhe qual golpe fica no 1, 2, 3 ou 4 (vale também para as teclas 1-4 da batalha).',
    'Treinadores e líderes usam no máximo 5 itens por batalha.',
    'Pokédex: os filtros (busca, registro, geração e tipo) ficam na mesma tela da lista, sem abrir outra tela.',
    'Auto-batalha: escolha o Pokémon que luta (cartões da equipe) e, se quiser, "só ele luta" — ela para se ele desmaiar.',
    'PC: arraste os Pokémon entre a equipe e a caixa (soltar em cima de outro troca os dois) e selecione vários (modo Selecionar, Shift e Ctrl) para vender ou favoritar de uma vez.',
  ] },
  { version: '2.0.0-alpha.20', items: [
    'Player do YouTube no canto superior esquerdo (botão ▸ Vídeo): cole o link de um vídeo, live ou playlist para ouvir música própria ou assistir enquanto joga; dá para silenciar a música do jogo.',
  ] },
  { version: '2.0.0-alpha.19', items: [
    'Corrige a tela branca ao abrir o jogo instalado (os arquivos da interface estavam sendo confundidos com as sprites).',
  ] },
  { version: '2.0.0-alpha.18', items: [
    'Novo save com dificuldade: Normal ou Difícil. No Difícil, ao perder uma batalha de desafio, treinador ou copa, os Pokémon que desmaiaram são apagados (só o inicial é poupado); vencendo, todos são curados.',
  ] },
  { version: '2.0.0-alpha.17', items: [
    'Novo Ciclo: depois de vencer os 10 campeões, eles voltam no Nv 100 com equipe completa, e surgem treinadores lendários (Red, Ash, Gold, Cynthia, N, Leon…). Prêmios maiores e bônus na primeira vitória.',
    'Batalhas em dupla (2×2): golpes em área, alvo por Pokémon, troca e reposição. Em Batalhar → Aleatórios → Dupla.',
    'Copas em duplas: inscrição mais cara, prêmio em dinheiro 3× e mais itens e essências.',
  ] },
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
