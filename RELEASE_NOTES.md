## Pokémon Simulator (remake) 2.0.0-alpha.23

- **Mercado Pokémon** com visual novo (cartões por tipo, selos shiny/bloqueado, barra de renovação) e filtros de IV até **4 estrelas**. A aba Vender ganhou busca, ordenação, filtro de estrelas e total da venda.
- **Valor de venda**: (bola + nível + itens investidos) × espécie (lendário/mítico ×3) × shiny (×10) × IVs (3★ ×1,5; 4★ ×2), arredondado para baixo. Preço de compra: 10.000 ₽ base, região bloqueada ×2, shiny ×5, 3★ ×1,5, 4★ ×2. Coberto por testes.
- **Cassino**: a aposta com Pokémon usa esse valor de venda como base do prêmio.
- **Selvagens**: botão **Buscar um novo mapa** quando os giros acabam.

## Anteriores: 2.0.0-alpha.22

- **Poké Bolas com sprite real** (loja, batalha, caça-níqueis): usam a imagem do item; sem a imagem (offline) aparece a bola desenhada.
- **Caça-níqueis**: cada posição tem **25% de chance de ficar vazia** e vazio não completa trinca; Ditto continua coringa (2 = 1×, 3 = 4×). Os pesos das figuras foram reajustados para manter o retorno médio perto de 93%, e a tela mostra as regras e a tabela de prêmios.

## Anteriores: 2.0.0-alpha.21

- **Itens dos NPCs**: líderes, treinadores e adversários de copa usam no máximo **5 itens por batalha** (a bolsa de cada um continua valendo se tiver menos).
- **Pokédex**: filtros na própria tela da lista (busca por nome/nº, registro, geração e tipo), sem tela de filtro separada.
- **Auto-batalha**: cartões da equipe para escolher o lutador e a opção "Só ele luta" (para se ele desmaiar).
- **PC**: arrastar e soltar entre equipe e caixa (cair em cima de outro troca os dois) e **seleção de vários** (botão Selecionar vários, Shift para intervalo, Ctrl para marcar) com vender, favoritar e tirar favorito em lote.
- **Ordenar golpes**: na ficha do Pokémon (Equipe/PC), o botão "Ordenar golpes" escolhe o golpe e a posição (1 a 4). A ordem vale para a ficha e para as teclas 1-4 da batalha. Os golpes agora aparecem numerados.

## Anteriores: 2.0.0-alpha.20

- **Player do YouTube** no canto superior esquerdo (botão ▸ Vídeo): cole o link de um vídeo, live ou playlist para ouvir música ou assistir enquanto joga. Precisa de internet; a opção "Silenciar a música do jogo" desliga a trilha interna. Ao clicar no vídeo, as teclas do jogo ficam com o player até você clicar fora.

## Anteriores: 2.0.0-alpha.19

- Corrige a **tela branca** ao abrir o jogo instalado: os arquivos da interface (`/assets/index-*.js`) colidiam com a rota das sprites e davam 404. Agora a interface usa `/static/` e o servidor tem um recuo para a pasta da interface.

## Anteriores: 2.0.0-alpha.18

- **Dificuldade do save** (criação da jornada): Normal ou Difícil ☠. No Difícil, só ao **perder** uma batalha de desafio, treinador (1×1 ou dupla) ou copa os Pokémon que desmaiaram são apagados do save; o inicial nunca é apagado. Vencendo, todos são curados como sempre. Selvagens nunca apagam. A tela de resultado lista os perdidos. Saves antigos continuam Normal.

## Anteriores: 2.0.0-alpha.17

- **Novo Ciclo** (Batalhar → Novo Ciclo): abre ao vencer os 10 campeões. Eles voltam no Nv 100, equipe de 6, IVs perfeitos e Full Restore; mais 11 treinadores lendários (Red, Ash, Gold, Steven, Wallace, Cynthia, N, Iris, Diantha, Leon, Geeta). Prêmio em dinheiro e Doces Raros/EXP GG, e na 1ª vitória Master Ball e Essências de IV. Sem limite de nível.
- **Batalhas em dupla (2×2)**: Batalhar → Aleatórios → Dupla (prêmio em dobro). Golpes em área (×0,75), escolha de alvo, troca e reposição de desmaiados. Sem itens, captura ou fuga.
- **Copas em duplas**: 6 categorias novas na tela de Torneios (inscrição 2,5×, dinheiro 3×, itens 1,5× e +1 Essência).

## Anteriores: 2.0.0-alpha.16

- Retratos pixel-art de líderes, Elite, Campeões e treinadores (desenhados no jogo; o mesmo treinador é sempre igual).
- Batalha: números de dano, aviso de crítico e auras de status; trilha sonora procedural por tela (volume em Opções).
- Temas por região (cores e moldura) e modos Escuro e Alto contraste.
- Tela de abertura com o resumo da última jornada e as novidades da versão.

## Anteriores: 2.0.0-alpha.15

Qualidade de vida:
- **Exportar/importar save** (arquivo `.json`, tela de jornadas) e **backup automático** a cada abertura (últimos 5 em `saves\backups`). Para restaurar um backup, copie-o sobre `saves\game.db` com o jogo fechado.
- **Auto-batalha** nos selvagens: luta com todos do mapa, gira e repete até acabar os giros; para e avisa se aparecer shiny ou 4★.
- **Atalhos na Equipe/Mochila**: "Curar equipe", doces e itens em toda a equipe.
- **Mercado**: filtros (tipo, estrelas, shiny, região) e alerta de shiny/4★ ao abrir e renovar.
- **Menu**: ponto vermelho em Missões (prontas para resgatar) e Mercado (shiny/4★ à venda).
- **Venda no PC** (botão "Vender…"): filtros "Duplicados", "Abaixo de 3★", nível e proteção de shinies/favoritos/equipe.

## Anteriores: 2.0.0-alpha.14

- Mochila dividida em seções (Cura, Bolas, Treino, Evolução, Formas, Outros), trocadas com ←/→.
- Caça-níqueis com giro automático.
- Mercado com 16 Pokémon; menu sem o Catálogo de itens e sem as entradas [TESTE].

### Distribuição para Windows (alpha.13)

- **Executável**: extraia o ZIP completo e abra `PokemonSimulator.exe`. O Node.js já vem incluído; não precisa instalar nada.
- **Sprites**: baixadas em segundo plano na primeira abertura (a barra de status mostra o progresso); enquanto isso o jogo busca cada imagem na origem. Depois de baixadas, funciona sem internet.
- **Atualização automática**: ao abrir, o jogo consulta as releases do GitHub, baixa o pacote `update` (verificado por SHA-256) e instala preservando os saves em `saves/`.
- Missões a cada 2h, mercado de Pokémon renovado por hora, venda de Pokémon, histórico e estatísticas (alpha.12).
