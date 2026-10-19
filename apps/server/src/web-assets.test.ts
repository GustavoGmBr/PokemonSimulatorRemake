import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

test('interface compilada: index, /static/ e (por compatibilidade) /assets/ chegam ao navegador; sprite ausente segue 404/302', async () => {
  const web = mkdtempSync(path.join(tmpdir(), 'pokesim-web-'));
  mkdirSync(path.join(web, 'static'));
  mkdirSync(path.join(web, 'assets'));
  writeFileSync(path.join(web, 'index.html'), '<!doctype html><div id=root></div>');
  writeFileSync(path.join(web, 'static/index-abc.js'), 'console.log(1)');
  writeFileSync(path.join(web, 'assets/index-old.js'), 'console.log(2)');
  const db = openDatabase(':memory:');
  const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-spr-')), webDist: web });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal(await (await fetch(`${base}/static/index-abc.js`)).text(), 'console.log(1)');
    assert.equal(await (await fetch(`${base}/assets/index-old.js`)).text(), 'console.log(2)');
    assert.equal((await fetch(`${base}/assets/nao-existe.js`)).status, 404);
  } finally { server.close(); db.close(); }
});
