/* Reading the words out of a PDF, in the browser, with nothing installed.

   A PDF is a list of objects; the ones that matter here are content streams,
   which are usually Flate-compressed and hold the operators that place text
   on the page. Browsers can inflate — DecompressionStream has been there for
   years — so the whole job is: find the streams, inflate them, and pull the
   strings out of the Tj and TJ operators.

   This reads the PDFs people actually hand each other: a handbook exported
   from Word, a policy printed to PDF, a process note. It does not read a
   scan, because a scan has no text in it at all, and it does not unpick the
   custom encodings some design tools embed. When it comes up short it says
   so, and the answer is to paste the text instead — which is the honest
   outcome, rather than half a document silently. */

const decoder = new TextDecoder('latin1');

/* ---------- finding the streams ---------- */

function bytesOf(text) {
  const out = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) out[at] = text.charCodeAt(at) & 0xff;
  return out;
}

async function inflate(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* Flate streams in a PDF are zlib-wrapped, but enough writers leave the
   header off that both are worth trying. */
async function unpack(bytes) {
  try {
    return await inflate(bytes, 'deflate');
  } catch {
    try {
      return await inflate(bytes, 'deflate-raw');
    } catch {
      return null;
    }
  }
}

/* ---------- pulling the text out of one stream ---------- */

/* A PDF string: (like this), with backslash escapes and balanced brackets
   allowed inside it. */
function readString(text, from) {
  let out = '';
  let depth = 1;
  let at = from;

  while (at < text.length) {
    const letter = text[at];

    if (letter === '\\') {
      const next = text[at + 1];
      const SHORT = { n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' };

      if (next >= '0' && next <= '7') {
        // An octal escape, up to three digits.
        let digits = '';
        while (digits.length < 3 && text[at + 1 + digits.length] >= '0' && text[at + 1 + digits.length] <= '7') {
          digits += text[at + 1 + digits.length];
        }

        out += String.fromCharCode(parseInt(digits, 8));
        at += 1 + digits.length;
        continue;
      }

      out += SHORT[next] ?? next;
      at += 2;
      continue;
    }

    if (letter === '(') depth += 1;

    if (letter === ')') {
      depth -= 1;
      if (!depth) return { text: out, at: at + 1 };
    }

    out += letter;
    at += 1;
  }

  return { text: out, at };
}

/* <48656c6c6f> — the other way a PDF writes a string. */
function readHex(text, from) {
  const end = text.indexOf('>', from);
  if (end < 0) return { text: '', at: text.length };

  const digits = text.slice(from, end).replace(/[^0-9a-fA-F]/g, '');
  let out = '';

  for (let at = 0; at + 1 < digits.length; at += 2) {
    out += String.fromCharCode(parseInt(digits.slice(at, at + 2), 16));
  }

  return { text: out, at: end + 1 };
}

/* The operators that put words on a page. Tj and ' take one string, TJ takes
   an array of strings and kerning numbers, and Td/TD/T* move down a line. */
function wordsIn(content) {
  const pieces = [];
  const held = [];
  let at = 0;

  while (at < content.length) {
    const letter = content[at];

    if (letter === '(') {
      const read = readString(content, at + 1);
      held.push(read.text);
      at = read.at;
      continue;
    }

    if (letter === '<' && content[at + 1] !== '<') {
      const read = readHex(content, at + 1);
      held.push(read.text);
      at = read.at;
      continue;
    }

    // An operator: two or three letters, sometimes with a star.
    if (/[A-Za-z']/.test(letter)) {
      let word = '';
      while (at < content.length && /[A-Za-z*'"]/.test(content[at])) { word += content[at]; at += 1; }

      if (word === 'Tj' || word === 'TJ' || word === "'" || word === '"') {
        pieces.push(held.join(''));
        held.length = 0;
      } else if (word === 'Td' || word === 'TD' || word === 'T*' || word === 'ET') {
        if (held.length) { pieces.push(held.join('')); held.length = 0; }
        pieces.push('\n');
      } else {
        held.length = 0;
      }

      continue;
    }

    at += 1;
  }

  if (held.length) pieces.push(held.join(''));

  return pieces.join('');
}

/* ---------- the whole file ---------- */

export async function textOf(file) {
  const raw = decoder.decode(new Uint8Array(await file.arrayBuffer()));

  if (!raw.startsWith('%PDF')) throw new Error(`${file.name} is not a PDF.`);

  const parts = [];
  let at = 0;

  while (true) {
    const start = raw.indexOf('stream', at);
    if (start < 0) break;

    // The dictionary in front of the stream says how it was packed.
    const head = raw.slice(Math.max(0, start - 400), start);
    let from = start + 6;
    if (raw[from] === '\r') from += 1;
    if (raw[from] === '\n') from += 1;

    const end = raw.indexOf('endstream', from);
    if (end < 0) break;

    at = end + 9;

    // Images, fonts and metadata are streams too, and none of them are text.
    if (/\/Subtype\s*\/(Image|Type1C|CIDFontType0C|TrueType)/.test(head)) continue;
    if (/\/Type\s*\/(XObject|Font|Metadata)/.test(head) && !/\/Subtype\s*\/Form/.test(head)) continue;

    const body = bytesOf(raw.slice(from, end));
    const packed = /\/Filter\s*\/(\w+)/.exec(head)?.[1];

    let content;

    if (!packed) content = decoder.decode(body);
    else if (packed === 'FlateDecode') {
      const opened = await unpack(body);
      if (!opened) continue;
      content = decoder.decode(opened);
    } else continue;   // LZW, JBIG2 and the rest are not text either

    const words = wordsIn(content);
    if (words.trim()) parts.push(words);
  }

  const text = parts.join('\n')
    // Latin-1 is what the operators are read as; the accented letters land as
    // their Windows code points, which is what these put back.
    .replace(//g, '').replace(//g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((line) => line.trim()).filter(Boolean)
    .join('\n')
    .trim();

  if (text.length < 40) {
    throw new Error(`${file.name} has no readable text in it — a scan, or a format Vlipy cannot open. Paste the text instead.`);
  }

  return text;
}

/* Several at once, saying which ones came through and which did not. */
export async function textOfAll(files) {
  const parts = [];
  const read = [];
  const failed = [];

  for (const file of files) {
    try {
      const text = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
        ? await textOf(file)
        : (await file.text()).trim();

      if (!text) throw new Error(`${file.name} is empty.`);

      parts.push(`--- ${file.name} ---\n${text}`);
      read.push(file.name);
    } catch (error) {
      failed.push(error.message);
    }
  }

  return { text: parts.join('\n\n'), read, failed };
}
