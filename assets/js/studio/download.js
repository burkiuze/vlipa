/* Taking a table out of the studio: as a spreadsheet, or as a page to print.

   Both formats are written here by hand. An .xlsx is a zip of XML files, and
   a zip whose entries are stored rather than compressed needs nothing but a
   CRC - no library, no build step, and the file Excel opens is the real thing
   rather than a CSV wearing its extension. A PDF is a handful of objects and
   a stream of text-placing operators, which is more work than calling a
   library and about a hundred times smaller than shipping one.

   Everything is drawn from what is on screen: the columns in their order and
   the rows as they stand. */

/* ---------- handing the file over ---------- */

function give(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

const safe = (name) => String(name || 'table').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60).trim() || 'table';

/* ---------- a comma-separated file ---------- */

export function csv(name, columns, rows) {
  const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const lines = [
    columns.map((column) => quote(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => quote(row.values[column.key])).join(',')),
  ];

  // The byte order mark is what makes Excel read it as UTF-8 rather than as
  // whatever the machine's local code page happens to be.
  give(new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), `${safe(name)}.csv`);
}

/* ---------- a zip, with everything stored ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value;
  }

  return table;
})();

function crc32(bytes) {
  let value = -1;
  for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff];
  return (value ^ -1) >>> 0;
}

function zip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let at = 0;

  // Zips carry DOS dates: two-second resolution, and time began in 1980.
  const now = new Date();
  const time = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
  const day = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

  for (const [path, text] of Object.entries(files)) {
    const name = encoder.encode(path);
    const content = encoder.encode(text);
    const sum = crc32(content);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x800, true);   // the names are UTF-8
    local.setUint16(8, 0, true);       // stored, not deflated
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, sum, true);
    local.setUint32(18, content.length, true);
    local.setUint32(22, content.length, true);
    local.setUint16(26, name.length, true);

    parts.push(new Uint8Array(local.buffer), name, content);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, sum, true);
    entry.setUint32(20, content.length, true);
    entry.setUint32(24, content.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, at, true);

    central.push(new Uint8Array(entry.buffer), name);
    at += 30 + name.length + content.length;
  }

  const size = central.reduce((total, piece) => total + piece.length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, at, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/* ---------- a spreadsheet Excel opens ---------- */

const xml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Control characters are not allowed in XML at all, and one stray tab makes
  // Excel refuse the whole file.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/* A1, B1 ... Z1, AA1. */
export function reference(colIndex, rowIndex) {
  let name = '';
  let left = colIndex;

  do {
    name = String.fromCharCode(65 + (left % 26)) + name;
    left = Math.floor(left / 26) - 1;
  } while (left >= 0);

  return `${name}${rowIndex + 1}`;
}

/* Numbers go in as numbers so Excel will add them up; everything else goes in
   as text, inline, which saves carrying a shared-strings table. */
function sheetXml(columns, rows) {
  const lines = [];

  const cells = (values, rowIndex, bold) => columns.map((column, colIndex) => {
    const at = reference(colIndex, rowIndex);
    const text = String(values[colIndex] ?? '');

    // A phone number keeps its leading zero and an order code stays a code:
    // only something that reads back as the very same number goes in as one.
    const numeric = text.trim() !== ''
      && Number.isFinite(Number(text))
      && String(Number(text)) === text.trim();

    if (numeric) return `<c r="${at}"${bold ? ' s="1"' : ''}><v>${Number(text)}</v></c>`;

    return `<c r="${at}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
  }).join('');

  lines.push(`<row r="1">${cells(columns.map((column) => column.label), 0, true)}</row>`);

  rows.forEach((row, index) => {
    lines.push(`<row r="${index + 2}">${cells(columns.map((column) => row.values[column.key]), index + 1, false)}</row>`);
  });

  const widths = columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="24" customWidth="1"/>`)
    .join('');

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<cols>${widths}</cols><sheetData>${lines.join('')}</sheetData></worksheet>`;
}

export function xlsx(name, columns, rows) {
  // Excel will not open a workbook whose sheet name carries any of these.
  const title = xml(String(name || 'Sheet1').replace(/[\\/:*?[\]]/g, ' ').slice(0, 28).trim() || 'Sheet1');

  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>',

    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>',

    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets><sheet name="${title}" sheetId="1" r:id="rId1"/></sheets></workbook>`,

    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>',

    // Two formats: the ordinary one, and the same in bold for the header row.
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
      + '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
      + '<borders count="1"><border/></borders>'
      + '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
      + '<cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" applyFont="1"/></cellXfs>'
      + '</styleSheet>',

    'xl/worksheets/sheet1.xml': sheetXml(columns, rows),
  };

  give(new Blob([zip(files)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), `${safe(name)}.xlsx`);
}

/* ---------- a PDF of the same thing ---------- */

/* PDF strings here are Latin-1, and the one font every reader has without
   embedding does not reach past it - so anything outside is transliterated
   rather than dropped, which for Turkish is the difference between "Sirket"
   and "irket". */
const FOLD = {
  'ş': 's', 'Ş': 'S', 'ğ': 'g', 'Ğ': 'G',
  'ı': 'i', 'İ': 'I',
  'ć': 'c', 'č': 'c', 'ř': 'r', 'ž': 'z', 'š': 's',
  'ę': 'e', 'ą': 'a', 'ł': 'l', 'Ł': 'L', 'ń': 'n',
  'ś': 's', 'ź': 'z', 'ż': 'z',
  '–': '-', '—': '-', '‘': "'", '’': "'",
  '“': '"', '”': '"', '…': '...', '·': '-',
};

function latin(value) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[^\u0020-\u00ff]/g, (letter) => FOLD[letter] || '?');

  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/* Helvetica's widths, near enough to lay a table out with. */
const WIDE = 'ABCDEFGHKLNOPQRSTUVXYZmwMW@%&';
const NARROW = 'iljt.,;:\'"|!I[]()/\\ fr';

function width(text, size) {
  let total = 0;

  for (const letter of text) {
    if (NARROW.includes(letter)) total += 0.31;
    else if (WIDE.includes(letter)) total += 0.71;
    else total += 0.53;
  }

  return total * size;
}

/* Cut a value to what fits in one cell, with an ellipsis where it was cut. */
function clip(text, room, size) {
  if (width(text, size) <= room) return text;

  let cut = text;
  while (cut.length > 1 && width(`${cut}...`, size) > room) cut = cut.slice(0, -1);

  return `${cut}...`;
}

export function pdf(name, columns, rows, { company = '' } = {}) {
  // A4 on its side, because a table is wider than it is tall.
  const PAGE = { width: 842, height: 595 };
  const MARGIN = 34;
  const TOP = 84;
  const LINE = 19;
  const SIZE = 9;

  const room = PAGE.width - MARGIN * 2;
  const share = room / Math.max(1, columns.length);
  const perPage = Math.max(1, Math.floor((PAGE.height - TOP - MARGIN) / LINE));
  const pages = [];

  for (let start = 0; start < Math.max(1, rows.length); start += perPage) {
    pages.push(rows.slice(start, start + perPage));
  }

  const streams = pages.map((page, index) => {
    const put = [];
    let y = PAGE.height - MARGIN;

    // The title, and who it belongs to.
    put.push(`BT /F2 15 Tf ${MARGIN} ${y - 12} Td (${latin(name)}) Tj ET`);
    y -= 30;

    const note = [company, `${rows.length} rows`, new Date().toISOString().slice(0, 10)]
      .filter(Boolean).join('   -   ');

    put.push(`BT /F1 8 Tf 0.45 0.45 0.5 rg ${MARGIN} ${y - 8} Td (${latin(note)}) Tj ET 0 0 0 rg`);
    y -= 20;

    const top = y + 4;

    // The header row, on a band, repeated on every page.
    put.push(`0.93 0.93 0.96 rg ${MARGIN} ${y - LINE + 4} ${room} ${LINE} re f 0 0 0 rg`);

    columns.forEach((column, at) => {
      const text = clip(latin(column.label), share - 10, SIZE);
      put.push(`BT /F2 ${SIZE} Tf ${MARGIN + at * share + 4} ${y - LINE + 10} Td (${text}) Tj ET`);
    });

    y -= LINE;

    page.forEach((row, line) => {
      // Every other line is tinted, which is the only thing that keeps a wide
      // table readable across the page.
      if (line % 2) put.push(`0.975 0.975 0.98 rg ${MARGIN} ${y - LINE + 4} ${room} ${LINE} re f 0 0 0 rg`);

      columns.forEach((column, at) => {
        const text = clip(latin(row.values[column.key]), share - 10, SIZE);
        if (text) put.push(`BT /F1 ${SIZE} Tf ${MARGIN + at * share + 4} ${y - LINE + 10} Td (${text}) Tj ET`);
      });

      y -= LINE;
    });

    // The rules: one over the header, one under the last line, and one down
    // each column edge.
    const bottom = y + 4;
    put.push('0.82 0.82 0.86 RG 0.6 w');
    put.push(`${MARGIN} ${top} m ${MARGIN + room} ${top} l S`);
    put.push(`${MARGIN} ${bottom} m ${MARGIN + room} ${bottom} l S`);

    for (let at = 1; at < columns.length; at += 1) {
      put.push(`${MARGIN + at * share} ${top} m ${MARGIN + at * share} ${bottom} l S`);
    }

    if (pages.length > 1) {
      put.push(`BT /F1 8 Tf 0.45 0.45 0.5 rg ${PAGE.width - MARGIN - 46} ${MARGIN - 12} Td (${index + 1} / ${pages.length}) Tj ET`);
    }

    return put.join('\n');
  });

  // The objects: catalogue, page tree, one page and one stream each, two fonts.
  const objects = [];
  const pageIds = streams.map((stream, index) => 4 + index * 2);
  const boldId = 4 + streams.length * 2;

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${streams.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[boldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  streams.forEach((stream, index) => {
    const id = pageIds[index];

    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] `
      + `/Resources << /Font << /F1 3 0 R /F2 ${boldId} 0 R >> >> /Contents ${id + 1} 0 R >>`;

    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets = [];

  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const startxref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

  for (let id = 1; id < objects.length; id += 1) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }

  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;

  // Latin-1 the whole way: the byte offsets in the table above are only right
  // if one character is one byte.
  const bytes = new Uint8Array(out.length);
  for (let at = 0; at < out.length; at += 1) bytes[at] = out.charCodeAt(at) & 0xff;

  give(new Blob([bytes], { type: 'application/pdf' }), `${safe(name)}.pdf`);
}
