# Cria o repositório no GitHub e envia o projeto.
#   powershell -ExecutionPolicy Bypass -File .\scripts\criar-repositorio.ps1
# Precisa do Git e do GitHub CLI (gh): https://cli.github.com
param(
  [string]$Owner = 'GustavoGmBr',
  [string]$Name = 'PokemonSimulator-Remake',
  [switch]$Private
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

foreach ($tool in 'git', 'gh') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool não encontrado. Instale e abra um novo terminal." }
}
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'Entre na sua conta do GitHub…'; gh auth login --web --git-protocol https; if ($LASTEXITCODE -ne 0) { throw 'Login cancelado.' } }

if (-not (Test-Path '.git')) { git init -b main | Out-Null }
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m 'Pokémon Simulator (remake) 2.0.0-alpha' | Out-Null }

$visibility = if ($Private) { '--private' } else { '--public' }
$remote = git remote get-url origin 2>$null
if (-not $remote) {
  gh repo create "$Owner/$Name" $visibility --source . --remote origin --push --description 'Pokémon Simulator (remake): jogo de fã em TypeScript, com saves locais em SQLite, executável para Windows e atualização automática.'
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o repositório.' }
} else {
  git push -u origin main
}
Write-Host "Repositório pronto: https://github.com/$Owner/$Name"
Write-Host 'Para publicar uma versão: .\scripts\publicar-versao.ps1'
