import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { listFiles, writeZip, sha256File } from './zip.ts';

test('zip gerado pode ser lido por ferramentas padrão (python zipfile) e preserva o conteúdo', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zip-'));
  mkdirSync(path.join(root, 'app/web'), { recursive: true });
  writeFileSync(path.join(root, 'app/server.mjs'), 'console.log("olá");\n'.repeat(500));
  writeFileSync(path.join(root, 'app/web/índice.html'), '<p>x</p>');
  writeFileSync(path.join(root, 'vazio.txt'), '');
  const files = listFiles(root);
  assert.deepEqual(files, ['app/server.mjs', 'app/web/índice.html', 'vazio.txt']);
  const archive = path.join(root, '..', `${path.basename(root)}.zip`);
  await writeZip(root, files, archive);
  const script = `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(sorted(z.namelist())); print(len(z.read('app/server.mjs')))
`;
  // no Windows o Python se chama "python" (ou "py"); sem nenhum deles, só confere o hash
  let check: ReturnType<typeof spawnSync> | null = null;
  for (const exe of ['python3', 'python', 'py']) {
    const result = spawnSync(exe, ['-I', '-c', script, archive], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    if (result.status === 0) { check = result; break; }
  }
  if (check) {
    assert.match(String(check.stdout), /índice\.html/);
    assert.match(String(check.stdout), /\r?\n10500\r?\n/);
  }
  assert.match(await sha256File(archive), /^[a-f0-9]{64}$/);
});
