/* Tables: a spreadsheet, near enough.

   A grid you type straight into. Click a cell and it is selected; type and it
   takes what you type; Enter goes down, Tab goes right, Escape puts it back.
   The sheets are tabs along the bottom, the way everybody expects them to be.

   Nothing is saved as you type — a row is written when you leave it, so a
   line of edits costs one request rather than one per keystroke. */

import { api, can, state } from './api.js';
import { $, clear, dialog, el, field, toast } from './dom.js';

let tables = [];
let openTable = null;
let rows = [];

/* Where the cursor is: a row index (-1 is the blank row at the bottom) and a
   column index. */
let at = { row: 0, col: 0 };
let editing = false;

/* Rows touched since the last save, by id, plus the blank row being typed
   into for the first time. */
const dirty = new Set();
let draft = null;
let saving = false;

const columnsOf = () => openTable?.columns || [];

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

  if (draft && Object.values(draft).some((value) => String(value ?? '').trim())) {
    wanted.push({ values: draft });
  }

  if (!wanted.length) { draft = null; return; }

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
    draft = null;
    mark('Saved');

    // A line typed into the blank row becomes a row of its own, and a fresh
    // blank one takes its place underneath — as a sheet always does.
    if (grew) {
      const wasInGrid = document.activeElement?.closest('.cell');
      draw();
      if (wasInGrid) focusCell(rows.length, 0);
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

function cellValue(rowIndex, column) {
  if (rowIndex < 0) return draft?.[column.key] ?? '';
  return rows[rowIndex]?.values?.[column.key] ?? '';
}

function setCell(rowIndex, column, value) {
  if (rowIndex < 0) {
    draft = draft || {};
    draft[column.key] = value;
    return;
  }

  const row = rows[rowIndex];
  if (!row) return;

  row.values[column.key] = value;
  dirty.add(row.id);
}

function cellNode(rowIndex, colIndex) {
  return document.querySelector(`.cell[data-row="${rowIndex}"][data-col="${colIndex}"]`);
}

function focusCell(rowIndex, colIndex, { edit = false } = {}) {
  const columns = columnsOf();
  const lastRow = rows.length;                       // the blank row sits after the last

  const row = Math.max(0, Math.min(rowIndex, lastRow));
  const col = Math.max(0, Math.min(colIndex, columns.length - 1));

  // Leaving a row is when its edits are written.
  if (at.row !== row) flush();

  at = { row, col };
  editing = edit;

  const node = cellNode(row === lastRow ? -1 : row, col);
  if (!node) return;

  document.querySelectorAll('.cell.is-at').forEach((other) => other.classList.remove('is-at'));
  node.classList.add('is-at');

  const input = node.querySelector('input, select');
  if (!input) return;

  input.focus();
  if (edit && input.select) input.select();

  node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    draft = null;
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
  const lastRow = rows.length;
  const here = rowIndex < 0 ? lastRow : rowIndex;

  const go = (down, across) => {
    event.preventDefault();

    // Leaving the blank row at the bottom is what turns it into a row; the
    // cursor has nowhere below it to go, so the save has to be asked for.
    if (rowIndex < 0 && down > 0) return flush();
    return focusCell(here + down, colIndex + across);
  };

  if (event.key === 'Enter' && !event.shiftKey) return go(1, 0);
  if (event.key === 'Enter') return go(-1, 0);

  if (event.key === 'Tab') {
    event.preventDefault();
    const next = colIndex + (event.shiftKey ? -1 : 1);

    if (next >= columns.length) return go(1, -colIndex);
    if (next < 0) return focusCell(here - 1, columns.length - 1);
    return focusCell(here, next);
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
    class: `cell cell--${column.type}`,
    'data-row': String(rowIndex),
    'data-col': String(colIndex),
    onmousedown: () => { at = { row: rowIndex < 0 ? rows.length : rowIndex, col: colIndex }; },
  }, [input]);

  input.addEventListener('focus', () => {
    document.querySelectorAll('.cell.is-at').forEach((other) => other.classList.remove('is-at'));
    host.classList.add('is-at');
    at = { row: rowIndex < 0 ? rows.length : rowIndex, col: colIndex };
    say(column, input.value);
  });

  if (!mayWrite) return host;

  input.addEventListener('input', () => {
    setCell(rowIndex, column, input.value);
    say(column, input.value);

    // Typing in the blank row makes it a row: another blank one appears under
    // it, the way a sheet always has one more line.
    if (rowIndex < 0 && !host.dataset.grown) {
      host.dataset.grown = '1';
      mark('Editing…');
    }
  });

  input.addEventListener('keydown', (event) => keys(event, rowIndex, colIndex));
  input.addEventListener('blur', () => { setTimeout(() => { if (!document.querySelector('.cell.is-at input:focus, .cell.is-at select:focus')) flush(); }, 120); });
  input.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text.includes('\t') && !text.includes('\n')) return;

    event.preventDefault();
    pasteBlock(text, rowIndex < 0 ? rows.length : rowIndex, colIndex);
  });

  return host;
}

/* The strip above the grid, which says where you are and what is in it. */
function say(column, value) {
  const where = $('sheetWhere');
  if (where) where.textContent = column ? column.label : '';

  const shown = $('sheetValue');
  if (shown) shown.value = value ?? '';
}

function headCell(column, index) {
  const menu = () => {
    if (!can('table.manage')) return;

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
    can('table.manage')
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
    can('table.manage')
      ? el('button', { class: 'headcell headcell--add', type: 'button', title: 'New column', text: '+', onclick: addColumn })
      : el('div', { class: 'headcell headcell--add' }),
  ]);

  const line = (row, index) => el('div', { class: 'sheet__row' }, [
    el('div', { class: 'rownum' }, [
      mayWrite
        ? el('input', { type: 'checkbox', 'data-id': row?.id || '', onchange: selectionChanged })
        : null,
      el('span', { text: index < 0 ? '+' : String(index + 1) }),
    ]),
    ...columns.map((column, colIndex) => cell(index, colIndex, column)),
    el('div', { class: 'cell cell--pad' }),
  ]);

  const body = el('div', { class: 'sheet__body' }, [
    ...rows.map((row, index) => line(row, index)),
    mayWrite ? line(null, -1) : null,
  ]);

  return el('div', {
    class: 'sheet',
    style: `--cols: ${columns.length}`,
  }, [head, body]);
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
      el('p', { text: 'A customer list, a stock count, a price sheet — anything you would otherwise keep in a spreadsheet.' }),
      can('table.manage')
        ? el('button', { class: 'btn', type: 'button', text: 'Create the first table', onclick: create })
        : el('p', { class: 'muted', text: 'Creating one is an admin job.' }),
    ])]));
    return;
  }

  const bar = el('header', { class: 'codebar' }, [
    el('div', { class: 'codebar__name' }, [
      el('input', {
        class: 'writetitle', value: openTable?.name || '', maxlength: 60,
        disabled: !can('table.manage'),
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
      el('button', { class: 'chip', type: 'button', text: 'Download CSV', onclick: exportCsv }),
      can('table.manage') ? el('button', { class: 'chip chip--bad', type: 'button', text: 'Delete table', onclick: dropTable }) : null,
    ]),
  ]);

  // The strip under the toolbar: which cell you are in, and what is in it.
  const where = el('div', { class: 'sheetbar' }, [
    el('b', { id: 'sheetWhere', text: '' }),
    el('input', {
      id: 'sheetValue', class: 'sheetbar__value', readonly: true,
      placeholder: 'Click a cell to see what is in it.',
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

  if (can('table.manage')) {
    host.appendChild(el('button', { class: 'sheettab sheettab--add', type: 'button', text: '+', title: 'New table', onclick: create }));
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
    draft = null;
    await load();
    toast('Table deleted.');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function exportCsv() {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const lines = [
    columnsOf().map((column) => escape(column.label)).join(','),
    ...rows.map((row) => columnsOf().map((column) => escape(row.values[column.key])).join(',')),
  ];

  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `${openTable.name}.csv` });

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 3000);
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
        'Vlipa can see the columns, and leaves blank anything it would have to invent.'),
    ],
    onConfirm: async (data) => {
      const proposed = await api('/api/assist', {
        method: 'POST',
        body: { action: 'rows', companyId: state.companyId, tableId: openTable.id, ask: data.get('ask') },
      });

      reviewRows(proposed.rows);
    },
  });
}

/* The drafted rows are shown before any of them lands in the table. */
function reviewRows(proposed) {
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
  draft = null;

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
    draft = null;
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
