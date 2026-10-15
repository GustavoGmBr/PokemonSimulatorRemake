# Compila o inicializador (PokemonSimulator.exe) e o atualizador (PokemonSimulatorUpdater.exe)
# com o compilador C# que já vem no Windows (.NET Framework 4.x). Não precisa instalar nada.
param([string]$OutputDirectory = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = $root }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'O compilador do .NET Framework 4.x não foi encontrado neste Windows.' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$references = @('System.Windows.Forms.dll', 'System.Drawing.dll', 'System.Web.Extensions.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll') | ForEach-Object { "/reference:$_" }

$game = Join-Path $OutputDirectory 'PokemonSimulator.exe'
& $compiler /nologo /target:winexe "/out:$game" @references (Join-Path $PSScriptRoot 'Program.cs') (Join-Path $PSScriptRoot 'UpdateService.cs')
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível compilar PokemonSimulator.exe.' }

$updater = Join-Path $OutputDirectory 'PokemonSimulatorUpdater.exe'
& $compiler /nologo /target:winexe "/out:$updater" @references (Join-Path $PSScriptRoot 'Updater.cs')
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível compilar o atualizador.' }

Write-Host "Executáveis criados em $OutputDirectory"
