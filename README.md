# Pokémon Simulator — Remake

Remake do Pokémon Simulator, feito do zero em **TypeScript** e com visual **Retrô GBA**.
Single-player, offline e com saves locais em SQLite. Projeto de fã, sem vínculo com
Nintendo, Game Freak ou The Pokémon Company.

> Versão atual: **2.0.0-alpha.3**, Fase 1 em andamento (PC, Pokédex, selvagens, captura e loja prontos; batalha a seguir). Veja o [plano de fases](#fases).

## Como rodar

Requisitos: **Node.js 22.13 ou mais novo** (o banco usa o `node:sqlite` que já vem no Node).

No Windows, dê dois cliques em **`iniciar-dev.cmd`**. Ele instala as dependências na
primeira vez, sobe a API e a interface e abre o navegador.

Ou pelo terminal, na pasta do projeto:

```powershell
npm install
npm run dev
```

Abra http://127.0.0.1:35300.

**Sprites:** o jogo usa as sprites que a versão anterior já baixou, em
`..\PokemonSimulator Sqlite\backend\public`. Se estiverem em outro lugar, copie
`apps/server/.env.example` para `apps/server/.env` e ajuste `ASSETS_DIR`.

### Outros comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | API (porta 34600) + interface com recarga automática (porta 35300) |
| `npm start` | Compila a interface e serve tudo pela API em http://127.0.0.1:34600 |
| `npm test` | Testes do engine, do catálogo e da API |
| `npm run typecheck` | Checagem de tipos de todos os pacotes |
| `npm run data:import` | Reimporta o catálogo do projeto antigo (opcional, já vem pronto) |

### Controles

| Tecla | Ação |
| --- | --- |
| Setas (ou WASD) | Mover o cursor |
| Z, Enter ou Espaço | Confirmar / avançar texto |
| X, Esc ou Backspace | Voltar |

O mouse também funciona em tudo.

## Estrutura

```
apps/
  web/        Interface React + Vite, kit visual retrô (src/ui) e telas (src/screens)
  server/     API local em Node (node:http + node:sqlite): saves, catálogo e sprites
packages/
  engine/     Regras puras do jogo: atributos, IVs, tipos, experiência, criação de Pokémon.
              Sem banco e sem rede, tudo testável. Também define os contratos da API.
  data/       Catálogo (1.025 espécies, 781 golpes, 145 itens, 18 tipos) em catalog/*.json
```

- **O engine não conhece banco nem tela.** A API usa o engine para calcular; a interface só exibe.
  Na Fase 2, a batalha entra aqui como `estado + ação → novo estado + eventos`.
- **Contratos tipados:** `packages/engine/src/contracts.ts` define o que a API devolve.
  Mudou ali, o TypeScript aponta os dois lados.
- **Banco:** `apps/server/src/db.ts` tem a lista de migrações. Para mudar o banco, adicione
  uma migração no final, sem editar as anteriores.

## Fases

0. **Fundação** ✅ — estrutura, engine, catálogo, banco, kit visual, telas de jornadas, novo jogo e menu.
1. **Núcleo** — em andamento:
   - ✅ PC com caixas ilimitadas, mover entre equipe e PC, apelidos, favoritos, busca com filtros
     (tipo, geração, brilhante, estrelas, nível, favoritos) e ordenação.
   - ✅ Pokédex dos 1.025 (não visto / visto / capturado) com ficha: atributos, fraquezas, cadeia
     evolutiva, golpes (nível, TM, tutor, ovos) e formas.
   - ✅ Acabamento: tela de Opções (velocidade do texto, volume), tempo de jogo, fontes offline.
   - ✅ Selvagens e captura: busca por região (só Kanto no início; as outras abrem ao derrotar o campeão
     da anterior). Cada procura sorteia um mapa pixel GBA (8 habitats por tipo) com 10 Pokémon soltos,
     brilhantes visíveis e "Nome · Nv · ★" em cima de cada um. Giros para trocar os 10: 3, e 5 / 8 / 12
     após ginásio / Elite dos 4 / campeão da região; sem giros, renovar custa ₽ 1.000. Lendários só
     depois da Elite dos 4 da região; busca por Pokémon específico (10 iguais, mapa do tipo dele) só
     depois do campeão. Brilhante 1/4096 (Amuleto Brilhante = +2 sorteios), fórmula de captura por HP e
     status, todas as Poké Bolas, animação de 3 balanços e alerta de brilhante / ★★★ ou mais.
     Iniciais: só os da 1ª geração por enquanto.
   - ✅ Itens e loja: poções e revives na Mochila, loja com carrinho.
   - ⏳ Dependem da batalha (Fase 2): dinheiro por vitória, equipe curada após cada batalha e uso
     de itens dentro da batalha. O motor de itens (`packages/engine/src/items.ts`) já está pronto.
2. **Batalhas** — engine de batalha com status e estágios, IA de treinador, ginásios, Elite 4 e campeões.
3. **Jornada** — mapa pixel de cada região com rotas próprias, missões, loja e mercado.
4. **Extras** — Pokécassino, torneios, Mega/G-Max/fusões, launcher Windows e releases.

## Controles

| Tecla | Ação |
| --- | --- |
| Setas / WASD | mover o cursor |
| Z / Enter / Espaço | confirmar |
| X / Esc / Backspace | voltar |
| Q / E (ou PageUp / PageDown) | trocar de caixa, aba da ficha ou geração |
| F | buscar / filtros |
| G | ir para uma caixa (no PC) |
| T | PC: **[TESTE]** adiciona 12 Pokémon aleatórios · Loja: comprar o carrinho |
| Q | Selvagens: girar (ou renovar) o mapa · X: voltar à busca |

Ferramentas de teste (só na alpha): atalho T no PC, entradas **[TESTE] Kit** (libera todas as regiões,
+bolas, +curas, +₽20.000), **[TESTE] Próximo desafio** / **[TESTE] Vencer tudo** (ginásios, Elite dos 4 e campeões, que liberam regiões, giros, lendários e busca específica) e **[TESTE] Ferir equipe** no menu. Desligue tudo com `POKESIM_DEV=0` no `.env`.

Observação: ★★★★ exige todos os IVs perfeitos, o que o sorteio aleatório quase nunca produz; por isso o
alerta de destaque no mapa vale a partir de ★★★.

## Pendências conhecidas

- As fontes (Pixelify Sans e VT323) são baixadas pelo `npm install` / `npm run dev` (ou `npm run fonts`)
  para `apps/web/public/fonts`. Sem internet nesse momento, o jogo usa uma fonte monoespaçada e
  tenta de novo na próxima vez.
- Os nomes de golpes, habilidades e itens ainda vêm do catálogo em inglês.

Dados de referência obtidos via [PokéAPI](https://pokeapi.co/). Sprites e dados Pokémon
pertencem aos respectivos titulares.
