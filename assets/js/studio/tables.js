/* Tables: a spreadsheet, near enough.

   A grid you type straight into. Click a cell and it is selected; type and it
   takes what you type; Enter goes down, Tab goes right, Escape puts it back.
   The sheets are tabs along the bottom, the way everybody expects them to be.

   Nothing is saved as you type — a row is written when you leave it, so a
   line of edits costs one request rather than one per keystroke. */

import { api, can, state } from './api.js';
import { csv, pdf, xlsx } from './download.js';
import { $, clear, dialog, el, field, menu, toast } from './dom.js';

let tables = [];
let openTable = null;
let rows = [];

/* A sheet is mostly empty, and looks wrong without the empty part: these are
   the blank lines under the data, and every one of them can be typed into.
   Fourteen is the floor; how many there really are depends on how tall the
   window is, because a sheet that stops halfway down the screen looks broken
   rather than empty. */
const BLANKS = 14;
const ROW_HEIGHT = 28;

let blanks = BLANKS;

/* Where the cursor is. Rows past the end of the data are the blank ones. */
let at = { row: 0, col: 0 };

/* Rows touched since the last save, by id, and the blank lines being typed
   into, by how far down they are. */
const dirty = new Set();
let draft = new Map();
let saving = false;

const columnsOf = () => openTable?.columns || [];

/* A table belongs to whoever started it. They can rename it, change its
   columns and delete it; so can an admin. Everybody else in the company reads
   and writes rows in it, which is the point of keeping it here. */
function mine(table = openTable) {
  return Boolean(table) && (table.createdBy === state.user?.id || can('table.manage'));
}

/* ---------- talking to the server ---------- */

/* Everything edited since the last time, in one request. Called when the
   cursor leaves a row, and before anything that reloads. */
async function flush() {
  if (saving) return;

  const wanted = [];

  for (const id of dirty) {
    const row = rows.find((item) => item.id === id);
    if (row) wanted.push({ rowId: row.id, values: row.values });
  }

  for (const [, values] of [...draft.entries()].sort((a, b) => a[0] - b[0])) {
    if (Object.values(values).some((value) => String(value ?? '').trim())) wanted.push({ values });
  }

  if (!wanted.length) { draft.clear(); return; }

  saving = true;
  mark('Saving…');

  try {
    const answer = await api('/api/tables', {
      method: 'POST',
      body: { action: 'rows', companyId: state.companyId, tableId: openTable.id, rows: wanted },
    });

    // The server is the record: what it sends back replaces what was here,
    // and a row that was new arrives with its id.
    let grew = false;

    for (const saved of answer.rows || []) {
      const seat = rows.findIndex((item) => item.id === saved.id);
      if (seat >= 0) rows[seat] = saved;
      else { rows.push(saved); grew = true; }
    }

    dirty.clear();
    draft.clear();
    mark('Saved');

    // A line typed into the blank part becomes a row of its own, and the
    // blank part starts again underneath it — as a sheet always does.
    if (grew) {
      const wasInGrid = document.activeElement?.closest('.cell');
      const column = at.col;
      draw();
      if (wasInGrid) focusCell(rows.length, column);
    } else {
      countUp();
    }
  } catch (error) {
    mark(error.message, true);
    toast(error.message, 'bad');
  } finally {
    saving = false;
  }
}

function mark(text, bad = false) {
  const node = $('sheetState');
  if (!node) return;

  node.textContent = text;
  node.className = `sheetstate${bad ? ' is-bad' : ''}`;

  if (!bad && text === 'Saved') setTimeout(() => { if (node.textContent === 'Saved') node.textContent = ''; }, 1600);
}

function countUp() {
  const node = $('sheetCount');
  if (node) node.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;

  const tab = document.querySelector(`.sheettab[data-id="${openTable?.id}"] span`);
  if (tab) tab.textContent = String(rows.length);
}

/* ---------- the grid ---------- */

const blank = (rowIndex) => rowIndex >= rows.length;

function cellValue(rowIndex, column) {
  if (blank(rowIndex)) return draft.get(rowIndex)?.[column.key] ?? '';
  return rows[rowIndex]?.values?.[column.key] ?? '';
}

function setCell(rowIndex, column, value) {
  if (blank(rowIndex)) {
    const line = draft.get(rowIndex) || {};
    line[column.key] = value;
    draft.set(rowIndex, line);
    return;
  }

  const row = rows[rowIndex];
  if (!row) return;

  row.values[column.key] = value;
  dirty.add(row.id);
}

/* A1, B2 — where the cursor is, said the way a spreadsheet says it. */
function reference(rowIndex, colIndex) {
  let letters = '';
  let left = colIndex;

  do {
    letters = String.fromCharCode(65 + (left % 26)) + letters;
    left = Math.floor(left / 26) - 1;
  } while (left >= 0);

  return `${letters}${rowIndex + 1}`;
}

function cellNode(rowIndex, colIndex) {
  return document.querySelector(`.cell[data-row="${rowIndex}"][data-col="${colIndex}"]`);
}

function focusCell(rowIndex, colIndex, { edit = false } = {}) {
  const columns = columnsOf();

  const row = Math.max(0, Math.min(rowIndex, rows.length + blanks - 1));
  const col = Math.max(0, Math.min(colIndex, columns.length - 1));

  // Leaving a row is when its edits are written.
  if (at.row !== row) flush();

  at = { row, col };

  const node = cellNode(row, col);
  if (!node) return;

  const input = node.querySelector('input, select');
  if (!input) return;

  input.focus();
  if (edit && input.select) input.select();

  node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* The cell you are in, and the row and column it sits in, the way a
   spreadsheet shows you where you are. */
function markPlace(rowIndex, colIndex) {
  for (const other of document.querySelectorAll('.is-at, .is-near')) other.classList.remove('is-at', 'is-near');

  const node = cellNode(rowIndex, colIndex);
  node?.classList.add('is-at');

  node?.closest('.sheet__row')?.querySelector('.rownum')?.classList.add('is-near');
  document.querySelector(`.headcell[data-col="${colIndex}"]`)?.classList.add('is-near');

  const where = $('sheetWhere');
  if (where) where.textContent = reference(rowIndex, colIndex);

  const shown = $('sheetValue');
  if (shown) shown.value = cellValue(rowIndex, columnsOf()[colIndex]) ?? '';
}

/* Sheets fill a block from one paste, and so does this: tabs are columns and
   newlines are rows. */
async function pasteBlock(text, rowIndex, colIndex) {
  const columns = columnsOf();
  const grid = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((line) => line.split('\t'));
  if (!grid.length) return;

  const wanted = [];

  grid.forEach((line, down) => {
    const target = rowIndex + down;
    const isNew = target >= rows.length;
    const values = isNew ? {} : { ...rows[target].values };

    line.forEach((piece, across) => {
      const column = columns[colIndex + across];
      if (column) values[column.key] = piece.trim().slice(0, 500);
    });

    wanted.push(isNew ? { values } : { rowId: rows[target].id, values });
  });

  mark('Saving…');

  try {
    const answer = await api('/api/tables', {
      method: 'POST',
      body: { action: 'rows', companyId: state.companyId, tableId: openTable.id, rows: wanted },
    });

    for (const saved of answer.rows || []) {
      const seat = rows.findIndex((item) => item.id === saved.id);
      if (seat >= 0) rows[seat] = saved;
      else rows.push(saved);
    }

    dirty.clear();
    draft.clear();
    draw();
    focusCell(rowIndex, colIndex);
    mark('Saved');
    toast(`${wanted.length} rows pasted.`);
  } catch (error) {
    mark(error.message, true);
    toast(error.message, 'bad');
  }
}

function keys(event, rowIndex, colIndex) {
  const columns = columnsOf();

  const go = (down, across) => {
    event.preventDefault();

    // Typing on the last blank line and pressing Enter has nowhere to go, so
    // that is the moment the line becomes a row.
    if (down > 0 && rowIndex >= rows.length + blanks - 1) return flush();
    return focusCell(rowIndex + down, colIndex + across);
  };

  if (event.key === 'Enter' && !event.shiftKey) return go(1, 0);
  if (event.key === 'Enter') return go(-1, 0);

  if (event.key === 'Tab') {
    event.preventDefault();
    const next = colIndex + (event.shiftKey ? -1 : 1);

    if (next >= columns.length) return go(1, -colIndex);
    if (next < 0) return focusCell(rowIndex - 1, columns.length - 1);
    return focusCell(rowIndex, next);
  }

  if (event.key === 'Escape') {
    event.target.value = cellValue(rowIndex, columns[colIndex]);
    event.target.blur();
    return undefined;
  }

  // The arrows move between cells, unless you are in the middle of a word.
  const caretFree = event.target.selectionStart === event.target.selectionEnd;

  if (event.key === 'ArrowDown') return go(1, 0);
  if (event.key === 'ArrowUp') return go(-1, 0);
  if (event.key === 'ArrowRight' && caretFree && event.target.selectionStart === event.target.value.length) return go(0, 1);
  if (event.key === 'ArrowLeft' && caretFree && event.target.selectionStart === 0) return go(0, -1);

  return undefined;
}

function cell(rowIndex, colIndex, column) {
  const value = cellValue(rowIndex, column);
  const mayWrite = can('row.write');

  const input = column.type === 'choice' && column.options?.length
    ? el('select', { disabled: !mayWrite }, [
        el('option', { value: '', text: '' }),
        ...column.options.map((option) => el('option', { value: option, selected: option === value, text: option })),
      ])
    : el('input', {
        type: column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text',
        step: column.type === 'number' ? 'any' : null,
        value,
        maxlength: 500,
        readonly: !mayWrite,
        spellcheck: 'false',
      });

  const host = el('div', {
    class: `cell cell--${column.type}${blank(rowIndex) ? ' cell--blank' : ''}`,
    'data-row': String(rowIndex),
    'data-col': String(colIndex),
  }, [input]);

  input.addEventListener('focus', () => {
    at = { row: rowIndex, col: colIndex };
    markPlace(rowIndex, colIndex);
  });

  if (!mayWrite) return host;

  input.addEventListener('input', () => {
    setCell(rowIndex, column, input.value);
    host.classList.remove('cell--blank');

    const shown = $('sheetValue');
    if (shown) shown.value = input.value;
  });

  input.addEventListener('keydown', (event) => keys(event, rowIndex, colIndex));
  input.addEventListener('blur', () => { setTimeout(() => { if (!document.querySelector('.cell.is-at input:focus, .cell.is-at select:focus')) flush(); }, 120); });
  input.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text.includes('\t') && !text.includes('\n')) return;

    event.preventDefault();
    pasteBlock(text, rowIndex, colIndex);
  });

  return host;
}

function headCell(column, index) {
  const menu = () => {
    if (!mine()) return;

    dialog({
      title: `${column.label} — column`,
      confirm: 'Save',
      body: [
        field('Name', el('input', { name: 'label', required: true, value: column.label, maxlength: 40 })),
        field('Kind', el('select', { name: 'type' }, [
          ['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['choice', 'Choice'],
        ].map(([value, label]) => el('option', { value, selected: column.type === value, text: label })))),
        field('Choices', el('input', { name: 'options', value: (column.options || []).join(', '), maxlength: 300 }),
          'For a choice column: the options, separated by commas.'),
        el('button', {
          class: 'ghostlink ghostlink--bad', type: 'button', text: `Delete the ${column.label} column`,
          onclick: async () => {
            if (!window.confirm(`Delete "${column.label}" and everything in it?`)) return;

            await saveColumns(columnsOf().filter((other) => other.key !== column.key));
            document.querySelector('.modal__foot button[type=button]')?.click();
          },
        }),
      ],
      onConfirm: async (data) => {
        const next = columnsOf().map((other) => (other.key === column.key ? {
          ...other,
          label: String(data.get('label')).trim() || other.label,
          type: data.get('type'),
          options: String(data.get('options') || '').split(',').map((piece) => piece.trim()).filter(Boolean),
        } : other));

        await saveColumns(next);
      },
    });
  };

  return el('div', { class: 'headcell', 'data-col': String(index) }, [
    el('span', { class: 'headcell__name', text: column.label }),
    mine()
      ? el('button', { class: 'headcell__more', type: 'button', title: 'Change this column', text: '⌄', onclick: menu })
      : null,
  ]);
}

async function saveColumns(columns) {
  await flush();

  const answer = await api('/api/tables', {
    method: 'POST',
    body: { action: 'columns', companyId: state.companyId, tableId: openTable.id, columns },
  });

  openTable = answer.table;
  draw();
}

function addColumn() {
  dialog({
    title: 'New column',
    confirm: 'Add',
    body: [
      field('Name', el('input', { name: 'label', required: true, maxlength: 40, placeholder: 'Price' })),
      field('Kind', el('select', { name: 'type' }, [
        ['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['choice', 'Choice'],
      ].map(([value, label]) => el('option', { value, text: label })))),
    ],
    onConfirm: async (data) => {
      const label = String(data.get('label')).trim();
      const key = label.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 24)
        || `c${columnsOf().length + 1}`;

      if (columnsOf().some((column) => column.key === key)) throw new Error('There is already a column by that name.');

      await saveColumns([...columnsOf(), { key, label, type: data.get('type'), options: [] }]);
    },
  });
}

/* ---------- rows ---------- */

async function dropRows(ids) {
  if (!ids.length) return;
  if (!window.confirm(ids.length === 1 ? 'Delete this row?' : `Delete ${ids.length} rows?`)) return;

  try {
    await api('/api/tables', {
      method: 'POST',
      body: { action: 'rows.delete', companyId: state.companyId, tableId: openTable.id, rowIds: ids },
    });

    rows = rows.filter((row) => !ids.includes(row.id));
    ids.forEach((id) => dirty.delete(id));
    draw();
    toast(ids.length === 1 ? 'Row deleted.' : `${ids.length} rows deleted.`);
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function ticked() {
  return Array.from(document.querySelectorAll('.rownum input:checked')).map((box) => box.dataset.id);
}

/* ---------- the sheet ---------- */

function grid() {
  const columns = columnsOf();
  const mayWrite = can('row.write');

  const head = el('div', { class: 'sheet__head' }, [
    el('div', { class: 'headcell headcell--num' }, [
      mayWrite ? el('input', {
        type: 'checkbox', title: 'Select every row',
        onchange: (event) => {
          document.querySelectorAll('.rownum input').forEach((box) => { box.checked = event.target.checked; });
          selectionChanged();
        },
      }) : null,
    ]),
    ...columns.map(headCell),
    mine()
      ? el('button', { class: 'headcell headcell--add', type: 'button', title: 'New column', text: '+', onclick: addColumn })
      : el('div', { class: 'headcell headcell--add' }),
  ]);

  // Every line is the same, whether it holds a row or is still waiting for
  // one: the blank ones are what makes a sheet look like a sheet.
  const line = (index) => el('div', { class: `sheet__row${blank(index) ? ' sheet__row--blank' : ''}` }, [
    el('div', { class: 'rownum' }, [
      el('span', { text: String(index + 1) }),
      mayWrite && !blank(index)
        ? el('input', { type: 'checkbox', title: 'Select this row', 'data-id': rows[index].id, onchange: selectionChanged })
        : null,
    ]),
    ...columns.map((column, colIndex) => cell(index, colIndex, column)),
    el('div', { class: 'cell cell--pad' }),
  ]);

  const lines = [];
  for (let index = 0; index < rows.length + (mayWrite ? blanks : 0); index += 1) lines.push(line(index));

  return el('div', {
    class: 'sheet',
    style: `--cols: ${columns.length}`,
  }, [head, el('div', { class: 'sheet__body' }, lines)]);
}

function selectionChanged() {
  const chosen = ticked();
  const bar = $('sheetChosen');
  if (!bar) return;

  bar.hidden = !chosen.length;
  const label = bar.querySelector('span');
  if (label) label.textContent = `${chosen.length} selected`;
}

function draw() {
  const view = clear($('view'));

  if (!tables.length) {
    view.appendChild(el('div', { class: 'workbench workbench--plain' }, [el('div', { class: 'empty empty--big' }, [
      el('h3', { text: 'No tables yet' }),
      el('p', { text: 'A customer list, a stock count, a price sheet — anything you would otherwise keep in a spreadsheet. Everybody in the company sees it.' }),
      can('table.create')
        ? el('div', { class: 'spread' }, [
            el('button', { class: 'btn', type: 'button', text: '+ New table', onclick: create }),
            el('button', { class: 'btn btn--ai', type: 'button', text: '✦ Build one with Vlipa', onclick: tableWithAi }),
          ])
        : el('p', { class: 'muted', text: 'Your role cannot open one.' }),
    ])]));
    return;
  }

  const bar = el('header', { class: 'codebar' }, [
    el('div', { class: 'codebar__name' }, [
      el('input', {
        class: 'writetitle sheetname', value: openTable?.name || '', maxlength: 60,
        disabled: !mine(),
        size: Math.max(6, Math.min(28, (openTable?.name || '').length + 1)),
        onchange: async (event) => {
          const name = event.target.value.trim();
          if (!name || name === openTable.name) return;

          try {
            await api('/api/tables', {
              method: 'POST',
              body: { action: 'rename', companyId: state.companyId, tableId: openTable.id, name },
            });

            openTable.name = name;
            const table = tables.find((item) => item.id === openTable.id);
            if (table) table.name = name;
            drawTabs();
            toast('Renamed.');
          } catch (error) {
            toast(error.message, 'bad');
          }
        },
      }),
      el('span', { id: 'sheetCount', text: '' }),
      el('span', { id: 'sheetState', class: 'sheetstate', text: '' }),
    ]),

    el('div', { class: 'codebar__right' }, [
      can('row.write') ? el('button', { class: 'chip chip--ai', type: 'button', text: '✦ Fill with Vlipa', onclick: rowsWithAi }) : null,
      menu({
        label: 'Download',
        keepLabel: true,
        className: 'pick--chip',
        options: [
          { id: 'xlsx', label: 'Excel (.xlsx)', note: 'Opens in Excel, Sheets or Numbers' },
          { id: 'csv', label: 'CSV', note: 'Plain text, commas between' },
          { id: 'pdf', label: 'PDF', note: 'Laid out to print or send on' },
        ],
        onPick: download,
      }),
      mine() ? el('button', { class: 'chip chip--bad', type: 'button', text: 'Delete table', onclick: dropTable }) : null,
    ]),
  ]);

  // The strip under the toolbar: which cell you are in, and what is in it.
  const where = el('div', { class: 'sheetbar' }, [
    el('b', { class: 'sheetbar__ref', id: 'sheetWhere', text: 'A1' }),
    el('span', { class: 'sheetbar__fx', text: 'fx' }),
    el('input', {
      id: 'sheetValue', class: 'sheetbar__value', readonly: true,
      placeholder: '',
    }),
    el('div', { class: 'sheetchosen', id: 'sheetChosen', hidden: true }, [
      el('span', { text: '' }),
      el('button', {
        class: 'ghostlink ghostlink--bad', type: 'button', text: 'Delete',
        onclick: () => dropRows(ticked()),
      }),
    ]),
  ]);

  view.appendChild(el('div', { class: 'workbench' }, [
    bar,
    where,
    el('div', { class: 'sheetwrap' }, [openTable ? grid() : el('p', { class: 'empty', text: 'Pick a table below.' })]),
    el('div', { class: 'sheettabs', id: 'sheetTabs' }),
  ]));

  drawTabs();
  countUp();
  fillDown();
}

/* How many blank lines it takes to reach the bottom of the window. Measured
   rather than guessed, because it depends on the window; done after the sheet
   is on the page, and only redrawn when the answer changes. */
function fillDown() {
  const wrap = document.querySelector('.sheetwrap');
  if (!wrap || !openTable || !can('row.write')) return;

  const room = Math.ceil((wrap.clientHeight - ROW_HEIGHT) / ROW_HEIGHT);
  const wanted = Math.max(BLANKS, room - rows.length);

  if (wanted === blanks) return;

  blanks = wanted;

  const sheet = wrap.querySelector('.sheet');
  if (sheet) sheet.replaceWith(grid());
}

function drawTabs() {
  const host = clear($('sheetTabs'));
  if (!host) return;

  for (const table of tables) {
    host.appendChild(el('button', {
      class: `sheettab${openTable?.id === table.id ? ' is-on' : ''}`,
      type: 'button',
      'data-id': table.id,
      onclick: () => load(table.id),
    }, [
      el('b', { text: table.name }),
      el('span', { text: String(openTable?.id === table.id ? rows.length : (table.rows ?? 0)) }),
    ]));
  }

  if (can('table.create')) {
    host.appendChild(el('button', { class: 'sheettab sheettab--add', type: 'button', text: '+', title: 'New table', onclick: create }));
    host.appendChild(el('button', { class: 'sheettab sheettab--ai', type: 'button', text: '✦ With Vlipa', title: 'Have Vlipa design a table', onclick: tableWithAi }));
  }
}

/* ---------- the rest of it ---------- */

export function create() {
  dialog({
    title: 'New table',
    confirm: 'Create',
    body: [
      field('Name', el('input', { name: 'name', required: true, maxlength: 60, placeholder: 'Customers' })),
      field('Columns', el('input', { name: 'columns', maxlength: 200, value: 'Name, Note' }),
        'Separated by commas. You can add and rename them later.'),
    ],
    onConfirm: async (data) => {
      const columns = String(data.get('columns') || '').split(',')
        .map((piece) => piece.trim())
        .filter(Boolean)
        .map((label, index) => ({
          key: label.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 24) || `c${index + 1}`,
          label,
          type: 'text',
        }));

      const created = await api('/api/tables', {
        method: 'POST',
        body: {
          action: 'create',
          companyId: state.companyId,
          name: data.get('name'),
          columns: columns.length ? columns : undefined,
        },
      });

      await load(created.table.id);
      toast('Table created.');
    },
  });
}

async function dropTable() {
  if (!window.confirm(`Delete "${openTable.name}" and everything in it?`)) return;

  try {
    await api('/api/tables', {
      method: 'POST',
      body: { action: 'drop', companyId: state.companyId, tableId: openTable.id },
    });

    openTable = null;
    dirty.clear();
    draft.clear();
    await load();
    toast('Table deleted.');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

/* Out of here and into whatever they use next: Excel, a reader, or another
   spreadsheet. The writing is in download.js; this only says what to write. */
function download(how) {
  const name = openTable?.name || 'table';
  const columns = columnsOf();

  if (!columns.length) return toast('This table has no columns yet.', 'bad');
  if (how === 'xlsx') return xlsx(name, columns, rows);
  if (how === 'pdf') return pdf(name, columns, rows, { company: state.company?.name || '' });

  return csv(name, columns, rows);
}

/* Say what the table is for and Vlipa works out the columns as well as the
   rows. Nothing is created until it has been looked at. */
function tableWithAi() {
  dialog({
    title: 'Build a table with Vlipa',
    confirm: 'Draft it',
    body: [
      field('What is the table for?',
        el('textarea', { name: 'ask', rows: 3, required: true, maxlength: 600,
          placeholder: 'A price list for our coffee shop: what it is, what it costs, whether it is on the menu right now.' }),
        'Vlipa picks the columns and fills in a first few rows. You see all of it before anything is made.'),
    ],
    onConfirm: async (data) => {
      const proposed = await api('/api/assist', {
        method: 'POST',
        body: { action: 'table', companyId: state.companyId, ask: data.get('ask') },
      });

      reviewTable(proposed);
    },
  });
}

/* The proposed table, shown as it would look. The name and the columns are
   still editable here, because this is the last cheap moment to change them. */
function reviewTable({ name, columns, rows, note }) {
  const title = el('input', { value: name, maxlength: 60, required: true });
  const keep = [];

  const preview = el('table', { class: 'grid' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { class: 'shrink', text: '' }),
      ...columns.map((column) => el('th', {}, [
        el('b', { text: column.label }),
        el('span', { class: 'muted', text: ` · ${column.type}` }),
      ])),
    ])]),
    el('tbody', {}, rows.map((row) => {
      const use = el('input', { type: 'checkbox', checked: true });
      keep.push({ use, row });

      return el('tr', {}, [
        el('td', { class: 'shrink' }, [use]),
        ...columns.map((column) => el('td', { text: String(row[column.key] ?? '') })),
      ]);
    })),
  ]);

  dialog({
    title: 'Vlipa drafted this table',
    confirm: 'Create it',
    body: [
      field('Name', title),
      el('p', { class: 'muted', text: rows.length
        ? `${columns.length} columns and ${rows.length} rows to start with. Untick any row you do not want; everything stays editable afterwards.`
        : `${columns.length} columns. It starts empty, ready to type into.` }),
      note ? el('p', { class: 'aigap', text: note }) : null,
      el('div', { class: 'tablewrap' }, [preview]),
    ],
    onConfirm: async () => {
      if (!title.value.trim()) throw new Error('The table needs a name.');

      const created = await api('/api/tables', {
        method: 'POST',
        body: { action: 'create', companyId: state.companyId, name: title.value.trim(), columns },
      });

      const wanted = keep.filter((item) => item.use.checked);

      if (wanted.length) {
        await api('/api/tables', {
          method: 'POST',
          body: {
            action: 'rows',
            companyId: state.companyId,
            tableId: created.table.id,
            rows: wanted.map((item) => ({ values: item.row })),
          },
        });
      }

      await load(created.table.id);
      toast(`${title.value.trim()} is ready.`);
    },
  });
}

/* Say what belongs in the table and Vlipa drafts the rows. */
function rowsWithAi() {
  dialog({
    title: `${openTable.name} — draft rows with Vlipa`,
    confirm: 'Draft',
    body: [
      field('What rows do you want?',
        el('textarea', { name: 'ask', rows: 3, required: true, maxlength: 600,
          placeholder: 'Eight drinks for a coffee shop menu: name, price and a short note.' }),
        'Vlipa fills every column it can and leaves blank anything it would have to invent.'),
      el('p', { class: 'muted', text: 'It works from what it knows rather than from the web, so it can name the companies in a sector and the job titles you would write to — but not their current email addresses. Those it leaves for you.' }),
    ],
    onConfirm: async (data) => {
      const proposed = await api('/api/assist', {
        method: 'POST',
        body: { action: 'rows', companyId: state.companyId, tableId: openTable.id, ask: data.get('ask') },
      });

      reviewRows(proposed.rows, proposed.note);
    },
  });
}

/* The drafted rows are shown before any of them lands in the table. */
function reviewRows(proposed, note = '') {
  const boxes = [];

  const table = el('table', { class: 'grid' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { class: 'shrink', text: '' }),
      ...columnsOf().map((column) => el('th', { text: column.label })),
    ])]),
    el('tbody', {}, proposed.map((row) => {
      const use = el('input', { type: 'checkbox', checked: true });
      boxes.push({ use, row });

      return el('tr', {}, [
        el('td', { class: 'shrink' }, [use]),
        ...columnsOf().map((column) => el('td', { text: String(row[column.key] ?? '') })),
      ]);
    })),
  ]);

  dialog({
    title: `Vlipa drafted ${proposed.length} rows`,
    confirm: 'Add the ticked ones',
    body: [
      el('p', { class: 'muted', text: 'Untick what you do not want. Every row stays editable once it is in.' }),
      note ? el('p', { class: 'aigap', text: note }) : null,
      el('div', { class: 'tablewrap' }, [table]),
    ],
    onConfirm: async () => {
      const wanted = boxes.filter((item) => item.use.checked);
      if (!wanted.length) throw new Error('Nothing is ticked.');

      await api('/api/tables', {
        method: 'POST',
        body: {
          action: 'rows',
          companyId: state.companyId,
          tableId: openTable.id,
          rows: wanted.map((item) => ({ values: item.row })),
        },
      });

      await load(openTable.id);
      toast(`${wanted.length} rows added.`);
    },
  });
}

async function load(id) {
  await flush();

  const query = new URLSearchParams({ companyId: state.companyId });
  if (id || openTable) query.set('id', id || openTable.id);

  let data;

  try {
    data = await api(`/api/tables?${query}`);
  } catch (error) {
    // A sheet from another company, or one that has been deleted.
    if (error.status !== 404 || !(id || openTable)) throw error;

    openTable = null;
    return load();
  }

  tables = data.tables || [];
  openTable = data.table || (id ? null : openTable);
  rows = data.rows || [];
  dirty.clear();
  draft.clear();

  if (openTable && !tables.some((table) => table.id === openTable.id)) openTable = null;
  if (!openTable && tables.length) return load(tables[0].id);

  draw();
  return undefined;
}

let forCompany = '';

export async function show() {
  if (forCompany !== state.companyId) {
    forCompany = state.companyId;
    openTable = null;
    tables = [];
    rows = [];
    dirty.clear();
    draft.clear();
  }

  clear($('view')).appendChild(el('div', { class: 'workbench workbench--plain' }, [
    el('p', { class: 'empty', text: 'Opening the tables…' }),
  ]));

  await load(openTable?.id);
}

export function leave() {
  flush();
}

export function summary() {
  return { tables: tables.length };
}
