/** Novidades mostradas na tela de abertura (a mais recente primeiro). */
export interface ChangelogEntry { version: string; items: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  { version: '2.0.0-alpha.25', items: [
    'Limite de nível agora é o nível dos Pokémon do próximo ginásio da região (15, 22, 28…), depois os da Elite e o do campeão, em vez do nível dos selvagens.',
  ] },
  { version: '2.0.0-alpha.24', items: [
    'Limite de nível: cada Pokémon só sobe até o nível liberado pelos ginásios, Elite e campeão da região da geração dele (10 antes do 1º ginásio, 16, 22… até 100). Vale para XP de batalha e doces.',
    'Ginásios, Elite e campeões: a equipe só precisa ser da região na 1ª vez; depois de vencer o desafio, qualquer Pokémon pode lutar.',
    'Loja redesenhada: cartões com ícone, descrição, preço e botões − / + por produto; carrinho em formato de recibo.',
  ] },
  { version: '2.0.0-alpha.23', items: [
    'Mercado Pokémon redesenhado: cartões com arte colorida pelo tipo, selo shiny/região bloqueada, preço em destaque, barra de renovação e filtros no máximo até 4 estrelas.',
    'Aba Vender com busca, ordenação, filtro de estrelas e total da venda; o valor segue a fórmula (bola + nível + itens) × espécie × shiny × IVs.',
    'Cassino: apostar um Pokémon usa o mesmo valor de venda (lendário/mítico ×3) como base do prêmio.',
    'Mercado agora tem 15 Pokémon à venda (eram 16).',
    'Selvagens: ao terminar os giros aparece "Buscar um novo mapa", sem voltar ao menu.',
  ] },
  { version: '2.0.0-alpha.22', items: [
    'Poké Bolas com a sprite real do item (loja, batalha e cassino), em vez da bola desenhada.',
    'Caça-níqueis: cada posição tem 25% de chance de ficar vazia (vazio não completa trinca), com os pesos das figuras reajustados para manter o retorno perto de 93%. A tela agora mostra as regras e a tabela de prêmios.',
  ] },
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
