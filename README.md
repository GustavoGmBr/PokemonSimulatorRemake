# Pokémon Simulator — Remake

Remake do Pokémon Simulator, feito do zero em **TypeScript** e com visual **Retrô GBA**.
Single-player, offline e com saves locais em SQLite. Projeto de fã, sem vínculo com
Nintendo, Game Freak ou The Pokémon Company.

> Versão atual: **2.0.0-alpha.17**, batalhas (1×1 e em dupla), Novo Ciclo e progressão, Pokécassino, torneios, missões, mercado, histórico e distribuição para Windows (executável, sprites e atualização automática); mapa pixel a seguir. Veja o [plano de fases](#fases).

## Jogar no Windows (sem instalar nada)

1. Em **Releases**, baixe `PokemonSimulator-vX.Y.Z-compact-win-x64.zip` e extraia **todos** os arquivos.
2. Abra **`PokemonSimulator.exe`**. O Node.js já vem junto; o jogo abre no navegador em http://127.0.0.1:34600.
3. As imagens são baixadas em segundo plano na primeira vez (o progresso aparece na janela do inicializador).
   Enquanto isso o jogo busca cada imagem direto da origem; depois de baixadas, funciona sem internet.
4. Seus saves ficam em `saves\game.db`, ao lado do executável. **Faça backup dessa pasta** se quiser guardar o progresso.
5. A cada abertura o inicializador consulta as releases do GitHub; se houver versão nova, baixa o pacote `update`,
   confere o SHA-256, instala preservando `saves\` e reabre o jogo.

Verificação sem abrir o navegador: `.\PokemonSimulator.exe --check` (código de saída 0 = servidor e API OK).
Para não atualizar naquela abertura: `--skip-update`. Logs em `logs\latest.log` e `logs\update.log`.

## Como rodar (desenvolvimento)

Requisitos: **Node.js 22.13 ou mais novo** (o banco usa o `node:sqlite` que já vem no Node).

No Windows, dê dois cliques em **`iniciar-dev.cmd`**. Ele instala as dependências na
primeira vez, sobe a API e a interface e abre o navegador.

Ou pelo terminal, na pasta do projeto:

```powershell
npm install
npm run dev
```

Abra http://127.0.0.1:35300.

**Sprites:** por padrão o jogo usa as sprites que a versão anterior já baixou, em
`..\PokemonSimulator Sqlite\backend\public`. Para baixar as suas (PokeAPI/sprites), rode `npm run sprites -- --dir=assets`
(ou `--perfil=basico` para só frente/costas e itens, ~40 MB) e aponte `ASSETS_DIR` para essa pasta em `apps/server/.env`
(copie de `apps/server/.env.example`). Sem a imagem local, a API redireciona para a origem enquanto houver internet.

### Outros comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | API (porta 34600) + interface com recarga automática (porta 35300) |
| `npm start` | Compila a interface e serve tudo pela API em http://127.0.0.1:34600 |
| `npm test` | Testes do engine, do catálogo e da API |
| `npm run typecheck` | Checagem de tipos de todos os pacotes |
| `npm run sprites` | Baixa as imagens (Pokémon e itens) para a pasta de sprites; só baixa o que falta |
| `npm run release:build` | Monta os pacotes `compact` e `update` (Windows) em `dist/release/vX` |
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
     da anterior). Cada procura sorteia um mapa pixel GBA (8 habitats por tipo) com Pokémon soltos,
     brilhantes visíveis e "Nome · Nv · ★" em cima de cada um. Giros para trocar os 10: 3, e 5 / 8 / 12
     após ginásio / Elite dos 4 / campeão da região; sem giros, renovar custa ₽ 1.000. Lendários só
     depois da Elite dos 4 da região; busca por Pokémon específico (10 iguais, mapa do tipo dele) só
     depois do campeão. Brilhante 1/4096 (Amuleto Brilhante = +2 sorteios), fórmula de captura por HP e
     status, todas as Poké Bolas, animação de 3 balanços e alerta de brilhante / ★★★ ou mais.
     Os Pokémon "andam" pelo mapa (param ao passar o mouse). Você escolhe o nível mínimo e máximo de cada
     procura, de 1 até o limite liberado (padrão: do 2 ao limite) e, com os 8 ginásios da região vencidos,
     também o mapa (habitat). **Limite de nível:** 10 antes do 1º ginásio; 16, 22, 28, 34, 40, 46, 52 e 58
     após cada ginásio; 70, 82, 94 e 100 após cada membro da Elite dos 4; 100 após o campeão. A opção
     **Todas as gerações** mistura as regiões liberadas e segue giros, lendários e limite da região mais
     recente liberada (sem busca específica). Iniciais: só os da 1ª geração por enquanto.
   - ✅ Itens e loja: poções e revives na Mochila, loja com carrinho e todos os itens do jogo antigo:
     Poké Bolas (as 16 especiais com os mesmos multiplicadores; Bola Premier de brinde a cada 10 Poké
     Bolas), curas, pedras de evolução, Mega (97), Primal, Essências de IV (₽ 5.000; o uso vem com a
     tela de detalhes) e amuletos.
   - ✅ Batalha selvagem (engine + tela): turnos, dano (fórmula clássica), precisão, crítico, STAB,
     efetividade, prioridade e velocidade; status (queimadura, veneno, paralisia, sono, congelamento,
     confusão), estágios de atributo, golpes de vários acertos/dreno/recuo, Struggle e troca de Pokémon.
     A engine é pura e **reproduzível por semente** (`packages/engine/src/battle.ts`; o estado guarda o
     RNG, então mesma semente + mesmas ações = mesma batalha). Ao vencer: XP, nível, golpes novos (se já
     tem 4, escolha no perfil), dinheiro (nível do inimigo × 10, Moeda Amuleto) e Ovo da Sorte. A equipe
     é curada (HP e PP) ao fim de toda batalha. Dentro da batalha: bolsa (Poké Bolas e curas), fugir.
     **Sem PP:** os golpes são ilimitados. Ao fim da batalha você volta ao mapa; só o Pokémon derrotado ou
     capturado sai dele (limpe o mapa inteiro e gire para renovar). A tela de Selvagens mostra sua equipe.
     Golpes têm atalho **1–4** na batalha; **Opções → Controles** permite trocar todas as teclas.
     **Perfil do Pokémon:** "Comprar TMs" lista as TMs que a espécie pode aprender (status ₽ 1.500; dano
     25 × poder, mín. ₽ 1.000); a TM comprada fica com aquele Pokémon. "Trocar golpes" (F) ensina golpes de
     nível já alcançado (grátis) ou TMs que ele já tem, em qualquer vaga.
     Tela retrô com texto digitando, HP descendo, piscadas, XP, e animações de golpe por tipo.
     **Evolução é manual:** botão "Evoluir" no perfil do Pokémon da equipe (nível, amizade, horário,
     golpe de tipo; pedras/troca/local ficam para depois).
2. **Batalhas** — ✅ (menu **Batalhar**)
   - **Ginásios, Elite dos 4 e campeões das 9 regiões**, com os mesmos líderes, tipos, níveis e times do jogo
     antigo (Unova tem dois circuitos: Unova 1 e Unova 2, esse abre ao vencer o campeão de Unova 1).
     Ginásios em qualquer ordem; Elite dos 4 em ordem depois dos 8 ginásios; campeão (Nv 100) depois da Elite.
     Cada vitória grava a **insígnia**; vencer o campeão libera a próxima região (Kalos exige os dois campeões
     de Unova) e eleva o limite de nível dos selvagens.
   - **Regras do desafio:** só vale equipe de Pokémon da região (faixa da Pokédex dela); seus Pokémon acima do
     nível do líder lutam reduzidos a esse nível e **não ganham XP** (seus níveis não mudam). Não dá para fugir
     nem capturar. XP ×1,5 contra treinador; dinheiro = soma dos níveis do time inimigo × 10 (Moeda Amuleto vale).
   - **IA de treinador** (habilidade 1–3 conforme o líder): escolhe o golpe pela efetividade e dano esperado,
     **troca** quando está em desvantagem de tipo (com intervalo mínimo de 3 turnos) e **usa itens** de cura
     (Super/Hyper Potion, Full Restore) quando o HP está baixo, a menos que consiga nocautear primeiro.
   - **Treinadores aleatórios** (aba "Aleatórios"): Fácil (2–3 Pokémon Nv 20–30, ₽ 1.000), Médio (3–4, Nv 40–50,
     ₽ 3.000) e Difícil (6 Pokémon Nv 100, ₽ 10.000), cada um com times sorteados e itens de prêmio.
   - Batalha selvagem: engine, captura e tela retrô (acima).
   - ✅ **Evolução por item e troca (alpha.9):** pedras e objetos da loja evoluem pelo perfil (botão Evoluir, E);
     evoluções por troca usam o **Cabo de Ligação** ou o próprio objeto da troca (Metal Coat, Kings Rock…).
     **Não há evolução por amizade.** Espécies de regiões ainda não liberadas esperam o campeão da anterior.
     Item é gasto só quando a evolução acontece.
   - ✅ **Mega, Primal, G-Max e fusões:** permanentes, pelo botão **Transformar (T)** no perfil. Mega e Primal pedem
     Nv 60 + a pedra/orbe; G-Max usa a Pedra G-Max (+50% de HP máximo); o Necrozma se funde com Solgaleo e/ou
     Lunala (que continuam na coleção) e o Ultra Necrozma exige também a Pedra Ultra Burst. Tipos, atributos e
     sprite mudam.
   - ✅ **Essências de IV** (+1 no atributo, máx. 31; não gasta se já está no máximo) e **Doces** (Doce Raro +1 nível;
     EXP P/M/G/GG = 800 / 3.000 / 10.000 / 30.000 XP), pela Mochila ou por "Doces e Essências" no perfil.
   - ✅ **Equipes nomeadas:** menu **Equipes** guarda até 20 equipes de 6; montar troca equipe e PC sozinho.
   - ✅ **Pokécassino (alpha.10):** fichas a ₽ 5, sete jogos (Caça-níqueis, Roleta, Voltorb Flip, Pokejack, Pokémon Race,
     Wheel of Fortune e Pula Piplup) e loja de prêmios (Master Bola, Pedra Brilhante, Doces, Essências). Dá para apostar
     um **Pokémon** em vez de fichas: se ganhar, recebe o prêmio em ₽ e o mesmo valor em fichas; se perder, ele vai embora
     (favoritos e o seu último Pokémon ficam protegidos). Rodadas de Voltorb Flip, Pokejack e Pula Piplup ficam salvas.
   - ✅ **Torneios por categoria:** Muito Fácil, Fácil, Intermediário, Difícil, Muito Difícil e Copa Prime. Oito rodadas
     eliminatórias, inscrição em ₽, nível máximo da categoria, vida cheia entre rodadas, sem XP; prêmio (₽, Doces e
     Essências) só para o campeão.
   - ✅ **Catálogo de itens do PokéAPI (alpha.11):** os ~2.200 itens oficiais (nome, bolso, preço, efeito e texto) em
     `packages/data/catalog/pokeapi-items.json`, gerado por `npm run data:pokeapi` a partir dos dados do PokéAPI.
     Menu **Catálogo de itens** (busca, bolsos, o que já funciona no jogo e quanto você tem); ícones oficiais na Loja,
     Mochila e prêmios do cassino (carregados do repositório PokeAPI/sprites; sem internet o ícone some).
   - ✅ **Itens de status (alpha.11):** Antídoto, Cura de Queimadura, Cura de Gelo, Despertar, Cura de Paralisia e Cura Total
     (cura qualquer status e a confusão) na loja, categoria Cura. Valem em batalha, pelo menu CURA; Restauração Total
     também cura status. Ícones dos itens vêm das sprites do [PokéAPI](https://github.com/PokeAPI/sprites) em Mochila,
     Loja, Batalha, Cassino e Torneios.
   - ✅ **Missões, mercado e perfil (alpha.12):** 10 missões a cada 2 horas (capturar, derrotar selvagens, vencer
     treinadores e torneios) com recompensa em ₽, fichas e itens, mais bônus por concluir as dez. **Mercado** de Pokémon
     (16 à venda, renova por hora, ₽ 3.000 para renovar, 📌 fixa um Pokémon) e **venda** de Pokémon da coleção (valor por
     bola, nível, itens gastos, IVs, lendário e shiny; favoritos e o último Pokémon ficam protegidos). O cartão de
     Treinador ganhou estatísticas e histórico. **Torneios** agora usam os valores do jogo antigo (inscrição ₽ 150 a
     25.000, níveis e times por categoria).
3. **Jornada** — mapa pixel de cada região com rotas próprias, missões, loja e mercado.
4. **Extras** — ✅ **Distribuição (alpha.13):** `PokemonSimulator.exe` (launcher C# compilado com o csc do Windows, Node
   embutido), download de sprites em segundo plano, atualização automática pelas releases do GitHub (SHA-256,
   instalador com rollback, saves preservados) e GitHub Actions (CI + release por tag).

## Publicar uma versão (para quem mantém o repositório)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\criar-repositorio.ps1   # só na primeira vez (usa o gh)
# aumente "version" em package.json e descreva as novidades em RELEASE_NOTES.md, faça o commit, então:
powershell -ExecutionPolicy Bypass -File .\scripts\publicar-versao.ps1
```

Os workflows ficam em `distribuicao/workflows` (o `criar-repositorio.ps1` copia para `.github/workflows`). A tag `vX.Y.Z` dispara `release.yml`: compila, roda os testes, testa o executável com `--check` e cria
a release com os `.zip` e `.sha256`. Versões com sufixo (`-alpha.N`) saem como pré-lançamento; quem está numa alpha recebe
as próximas alphas, quem está numa estável só recebe estáveis. O repositório de atualização fica em `release-config.json`.

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
- Dream Ball ainda sem efeito (selvagens não dormem fora de golpes); evoluções por item/troca/local virão depois.
- Os nomes de golpes, habilidades e itens ainda vêm do catálogo em inglês.

Dados de referência obtidos via [PokéAPI](https://pokeapi.co/). Sprites e dados Pokémon
pertencem aos respectivos titulares.
