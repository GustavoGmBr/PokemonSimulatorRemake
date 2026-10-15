# Publica a versão que está no package.json: cria a tag vX e envia. O GitHub Actions compila o
# executável, testa e cria a release com os arquivos .zip e .sha256.
#   powershell -ExecutionPolicy Bypass -File .\scripts\publicar-versao.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
if (git status --porcelain) { throw 'Há alterações sem commit. Faça o commit antes de publicar.' }
if (git tag --list $tag) { throw "A tag $tag já existe. Aumente a versão no package.json e escreva as novidades em RELEASE_NOTES.md." }
git push origin HEAD
git tag -a $tag -m "Pokémon Simulator (remake) $tag"
git push origin $tag
Write-Host "Tag $tag enviada. Acompanhe em: https://github.com/$(( Get-Content release-config.json -Raw | ConvertFrom-Json).repository)/actions"
