/**
 * Monta os pacotes de release para Windows x64 em dist/release/v<versão>/:
 *   PokemonSimulator-v<versão>-compact-win-x64.zip   instalação completa (sem sprites; elas baixam em segundo plano)
 *   PokemonSimulator-v<versão>-update-win-x64.zip    só os arquivos do jogo, usado pela atualização automática
 *   PokemonSimulator-v<versão>-full-win-x64.zip      instalação completa com as sprites (só com --sprites-dir)
 *   (e o .sha256 de cada um)
 *
 *   npm run release:build                  no Windows: compila os executáveis e usa o Node que está rodando
 *   npm run release:build -- --node=C:\node\node.exe
 *   npm run release:build -- --skip-web    reaproveita apps/web/dist
 *   npm run release:build -- --sprites-dir=sprites-cache   também gera o pacote "full" (com as sprites já baixadas por `npm run sprites -- --dir=sprites-cache`)
 *
 * Fora do Windows só dá para montar a estrutura (sem os .exe); serve para conferir o conteúdo.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { listFiles, sha256File, writeZip } from './zip.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
const releaseConfig = JSON.parse(readFileSync(path.join(root, 'release-config.json'), 'utf8')) as { repository: string; assetPrefix: string };
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/.test(version)) throw new Error(`Versão inválida em package.json: ${version}`);
const tag = `v${version}`;
const isWindows = process.platform === 'win32';

const out = path.join(root, 'dist/release', tag);
const stage = path.join(out, 'stage');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(stage, 'app'), { recursive: true });

function run(command: string, commandArgs: string[], cwd = root): void {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', shell: isWindows && command === 'npm' });
  if (result.status !== 0) throw new Error(`Falhou: ${command} ${commandArgs.join(' ')}`);
}

console.log(`Montando ${releaseConfig.assetPrefix} ${tag} para Windows x64…`);

// 1. interface
if (!flag('skip-web')) run('npm', ['run', 'build']);
if (!existsSync(path.join(root, 'apps/web/dist/index.html'))) throw new Error('Interface não compilada (apps/web/dist). Rode "npm run build".');
cpSync(path.join(root, 'apps/web/dist'), path.join(stage, 'app/web'), { recursive: true });

// 2. servidor e baixador de sprites: um arquivo cada, sem node_modules
const common = {
  bundle: true, platform: 'node' as const, format: 'esm' as const, target: 'node22', minify: false, legalComments: 'none' as const,
  external: ['node:*'], logLevel: 'warning' as const,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  define: { 'process.env.POKESIM_VERSION': JSON.stringify(version) },
};
await build({ ...common, entryPoints: [path.join(root, 'apps/server/src/main.ts')], outfile: path.join(stage, 'app/server.mjs') });
await build({ ...common, entryPoints: [path.join(root, 'scripts/sprites.ts')], outfile: path.join(stage, 'app/sprites.mjs') });

// 3. catálogo do jogo
cpSync(path.join(root, 'packages/data/catalog'), path.join(stage, 'app/catalog'), { recursive: true });

// 4. runtime do Node (o jogador não precisa instalar nada)
const nodePath = value('node') ?? process.execPath;
mkdirSync(path.join(stage, 'runtime'), { recursive: true });
cpSync(nodePath, path.join(stage, 'runtime/node.exe'));
const nodeLicense = path.join(path.dirname(nodePath), 'LICENSE');
if (existsSync(nodeLicense)) cpSync(nodeLicense, path.join(stage, 'runtime/LICENSE'));
const nodeVersion = spawnSync(nodePath, ['--version'], { encoding: 'utf8' }).stdout.trim();
if (!isWindows && !value('node')) console.warn('Aviso: o runtime copiado não é do Windows; esta montagem serve apenas para conferência.');

// 5. inicializador e atualizador
if (isWindows && !flag('no-launcher')) {
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'launcher/build.ps1'), '-OutputDirectory', stage]);
} else {
  console.warn('Aviso: executáveis não compilados (fora do Windows ou --no-launcher).');
}

// 6. documentação
for (const file of ['README.md', 'THIRD_PARTY_NOTICES.txt', 'release-config.json', 'RELEASE_NOTES.md']) {
  if (existsSync(path.join(root, file))) cpSync(path.join(root, file), path.join(stage, file));
}

// 7. pacotes
const all = listFiles(stage).filter((f) => f !== 'distribution.json');
const kinds: { kind: 'compact' | 'update' | 'full'; files: string[] }[] = [
  { kind: 'compact', files: all },
  { kind: 'update', files: all.filter((f) => !f.startsWith('runtime/')) },
];
// pacote completo: o mesmo da instalação compacta + as sprites (jogo pronto para uso offline)
const spritesDir = value('sprites-dir');
if (spritesDir) {
  if (!existsSync(spritesDir)) throw new Error(`Pasta de sprites não encontrada: ${spritesDir}`);
  cpSync(spritesDir, path.join(stage, 'assets'), { recursive: true });
  kinds.push({ kind: 'full', files: listFiles(stage).filter((f) => f !== 'distribution.json') });
}
for (const { kind, files } of kinds) {
  const list = [...files, 'distribution.json'];
  writeFileSync(path.join(stage, 'distribution.json'), `${JSON.stringify({ version, platform: 'win-x64', kind, nodeVersion, files: list }, null, 2)}\n`);
  const name = `${releaseConfig.assetPrefix}-${tag}-${kind}-win-x64.zip`;
  const archive = path.join(out, name);
  console.log(`Compactando ${name}…`);
  await writeZip(stage, list, archive);
  const hash = await sha256File(archive);
  writeFileSync(`${archive}.sha256`, `${hash}  ${name}\n`, 'ascii');
  console.log(`  ${(readFileSize(archive) / 1024 / 1024).toFixed(1)} MB  sha256 ${hash.slice(0, 12)}…`);
}
rmSync(path.join(stage, 'distribution.json'), { force: true });
console.log(`Pacotes em ${out}`);

function readFileSize(file: string): number {
  return readFileSync(file).length;
}
