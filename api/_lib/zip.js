/* Zip files, in and out.

   Node has the compressor, so the browser does not need a library: a project
   goes out as one archive and comes back the same way. Only the two methods
   real zips use are handled — stored and deflated — and anything else is
   reported rather than guessed at. */

import zlib from 'node:zlib';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

/* ---------- writing ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);

  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[i] = value;
  }

  return table;
})();

function crc32(buffer) {
  let value = -1;
  for (const byte of buffer) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff];
  return (value ^ -1) >>> 0;
}

/* Dates in a zip are DOS dates: they start in 1980 and hold two-second
   resolution. */
function dosTime(date = new Date()) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

export function zipFiles(files) {
  const chunks = [];
  const central = [];
  const { time, day } = dosTime();
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8');
    const raw = Buffer.from(file.text ?? '', 'utf8');
    const packed = zlib.deflateRawSync(raw, { level: 6 });

    // Whichever is smaller wins; a tiny file often grows when compressed.
    const deflated = packed.length < raw.length;
    const body = deflated ? packed : raw;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // names are UTF-8
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(CENTRAL, 0);
    entry.writeUInt16LE(20, 4);            // version made by
    entry.writeUInt16LE(20, 6);            // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(deflated ? 8 : 0, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);

    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, directory, end]);
}

/* ---------- reading ---------- */

const SKIP = /(^|\/)(\.git|node_modules|\.DS_Store|__MACOSX)(\/|$)/;

export function unzip(buffer, { maxFiles = 200, maxBytes = 3_000_000 } = {}) {
  const files = [];
  let at = 0;
  let total = 0;

  while (at + 30 <= buffer.length && buffer.readUInt32LE(at) === LOCAL) {
    const flags = buffer.readUInt16LE(at + 6);
    const method = buffer.readUInt16LE(at + 8);
    const packedSize = buffer.readUInt32LE(at + 18);
    const plainSize = buffer.readUInt32LE(at + 22);
    const nameLength = buffer.readUInt16LE(at + 26);
    const extraLength = buffer.readUInt16LE(at + 28);

    const name = buffer.toString('utf8', at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + extraLength;

    // Sizes can live in a trailer instead of the header. Without walking the
    // central directory that entry cannot be read safely, so say so.
    if ((flags & 0x08) && !packedSize) {
      throw new Error('This archive stores its sizes in a way we cannot read. Zip the folder again without streaming.');
    }

    const body = buffer.subarray(start, start + packedSize);
    at = start + packedSize;

    if (name.endsWith('/') || SKIP.test(name)) continue;
    if (files.length >= maxFiles) throw new Error(`That archive holds more than ${maxFiles} files.`);

    let plain;

    if (method === 0) plain = body;
    else if (method === 8) plain = zlib.inflateRawSync(body);
    else throw new Error(`"${name}" uses a compression this cannot read.`);

    if (plainSize && plain.length !== plainSize) throw new Error(`"${name}" did not unpack to its stated size.`);

    total += plain.length;
    if (total > maxBytes) throw new Error('That archive is bigger than 3 MB unpacked.');

    // Binary files have no place in a text editor, so they are left out rather
    // than mangled. A null byte is the giveaway.
    const text = plain.toString('utf8');
    if (text.includes('\u0000')) continue;

    files.push({ path: name.replace(/^\.?\//, ''), text });
  }

  if (!files.length) throw new Error('No readable text files in that archive.');
  return files;
}
