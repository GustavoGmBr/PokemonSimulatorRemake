## Pokémon Simulator (remake) 2.0.0-alpha.15

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
