/** Gerador mínimo de .zip (deflate), sem dependências: usado pelo empacotamento das releases. */
import { createReadStream, createWriteStream, readFileSync, readdirSync, statSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';


export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out;
}

function dosTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Compacta `files` (caminhos relativos a `root`, com "/") em `archive`. Arquivos até 1 GB cada. */
export async function writeZip(root: string, files: string[], archive: string): Promise<void> {
  const out = createWriteStream(archive);
  const central: Buffer[] = [];
  let offset = 0;
  const write = async (chunk: Buffer) => {
    offset += chunk.length;
    if (!out.write(chunk)) await once(out, 'drain');
  };
  for (const relative of files) {
    const full = path.join(root, ...relative.split('/'));
    const data = readFileSync(full);
    const packed = deflateRawSync(data, { level: 9 });
    const useDeflate = packed.length < data.length;
    const body = useDeflate ? packed : data;
    const name = Buffer.from(relative, 'utf8');
    const { time, day } = dosTime(statSync(full).mtime);
    const crc = crc32(data);
    const method = useDeflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entryOffset = offset;
    await write(local);
    await write(name);
    await write(body);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(day, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(entryOffset, 42);
    central.push(header, name);
  }
  const directory = Buffer.concat(central);
  const centralOffset = offset;
  await write(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  await write(end);
  out.end();
  await once(out, 'finish');
}

export async function sha256File(file: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
