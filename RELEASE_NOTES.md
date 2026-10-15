## Pokémon Simulator (remake) 2.0.0-alpha.14

- Mochila dividida em seções (Cura, Bolas, Treino, Evolução, Formas, Outros), trocadas com ←/→.
- Caça-níqueis com giro automático.
- Mercado com 16 Pokémon; menu sem o Catálogo de itens e sem as entradas [TESTE].

### Distribuição para Windows (alpha.13)

- **Executável**: extraia o ZIP completo e abra `PokemonSimulator.exe`. O Node.js já vem incluído; não precisa instalar nada.
- **Sprites**: baixadas em segundo plano na primeira abertura (a barra de status mostra o progresso); enquanto isso o jogo busca cada imagem na origem. Depois de baixadas, funciona sem internet.
- **Atualização automática**: ao abrir, o jogo consulta as releases do GitHub, baixa o pacote `update` (verificado por SHA-256) e instala preservando os saves em `saves/`.
- Missões a cada 2h, mercado de Pokémon renovado por hora, venda de Pokémon, histórico e estatísticas (alpha.12).
