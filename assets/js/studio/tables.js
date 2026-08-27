/* Tables: the company's own small database. */

import { api, can, state } from './api.js';
import { $, clear, dialog, el, field, toast } from './dom.js';

let tables = [];
let openTable = null;
let rows = [];

function columnEditor(columns) {
  const host = el('div', { class: 'cols' });

  const line = (column = { key: '', label: '', type: 'text' }) => {
    const row = el('div', { class: 'cols__row' }, [
      el('input', { class: 'col-label', placeholder: 'Column name', value: column.label || '', maxlength: 40 }),
      el('select', { class: 'col-type' }, [
        ['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['choice', 'Choice'],
      ].map(([value, label]) => el('option', { value, selected: column.type === value, text: label }))),
      el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: '×', onclick: () => row.remove() }),
    ]);

    return row;
  };

  columns.forEach((column) => host.appendChild(line(column)));

  return el('div', {}, [
    host,
    el('button', {
      class: 'ghostlink', type: 'button', text: '+ Add column',
      onclick: () => host.appendChild(line()),
    }),
  ]);
}

function readColumns(scope) {
  return Array.from(scope.querySelectorAll('.cols__row')).map((row, index) => {
    const label = row.querySelector('.col-label').value.trim() || `Column ${index + 1}`;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || `c${index + 1}`;
    return { key: `${key}`.slice(0, 24), label, type: row.querySelector('.col-type').value };
  });
}

export function create() {
  const editor = columnEditor([
    { key: 'ad', label: 'Ad', type: 'text' },
    { key: 'not', label: 'Not', type: 'text' },
  ]);

  dialog({
    title: 'New table',
    confirm: 'Create',
    body: [
      field('Table name', el('input', { name: 'name', required: true, maxlength: 60, placeholder: 'Customers' })),
      field('Columns', editor),
    ],
    onConfirm: async (data) => {
      const created = await api('/api/tables', {
        method: 'POST',
        body: { action: 'create', companyId: state.companyId, name: data.get('name'), columns: readColumns(editor) },
      });

      await load(created.table.id);
      toast('Table created.');
    },
  });
}

function editColumns() {
  const editor = columnEditor(openTable.columns);

  dialog({
    title: `${openTable.name} — columns`,
    body: [field('Columns', editor)],
    onConfirm: async (_data) => {
      await api('/api/tables', {
        method: 'POST',
        body: { action: 'columns', companyId: state.companyId, tableId: openTable.id, columns: readColumns(editor) },
      });

      await load(openTable.id);
      toast('Columns updated.');
    },
  });
}

function rowDialog(row) {
  const inputs = openTable.columns.map((column) => field(column.label, el('input', {
    name: column.key,
    type: column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text',
    step: column.type === 'number' ? 'any' : null,
    value: row?.values?.[column.key] ?? '',
    maxlength: 500,
  })));

  dialog({
    title: row ? 'Edit row' : 'New row',
    confirm: row ? 'Save' : 'Add',
    body: inputs,
    onConfirm: async (data) => {
      const values = {};
      openTable.columns.forEach((column) => { values[column.key] = data.get(column.key); });

      await api('/api/tables', {
        method: 'POST',
        body: { action: 'row', companyId: state.companyId, tableId: openTable.id, rowId: row?.id, values },
      });

      await load(openTable.id);
    },
  });
}

async function dropRow(row) {
  if (!window.confirm('Delete this row?')) return;

  try {
    await api('/api/tables', {
      method: 'POST',
      body: { action: 'row.delete', companyId: state.companyId, tableId: openTable.id, rowId: row.id },
    });

    await load(openTable.id);
  } catch (error) {
    toast(error.message, 'bad');
  }
}

async function dropTable() {
  if (!window.confirm(`Delete "${openTable.name}" and everything in it?`)) return;

  try {
    await api('/api/tables', {
      method: 'POST',
      body: { action: 'drop', companyId: state.companyId, tableId: openTable.id },
    });

    openTable = null;
    await load();
    toast('Table deleted.');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function exportCsv() {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const lines = [
    openTable.columns.map((column) => escape(column.label)).join(','),
    ...rows.map((row) => openTable.columns.map((column) => escape(row.values[column.key])).join(',')),
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
      ...openTable.columns.map((column) => el('th', { text: column.label })),
    ])]),
    el('tbody', {}, proposed.map((row) => {
      const use = el('input', { type: 'checkbox', checked: true });
      boxes.push({ use, row });

      return el('tr', {}, [
        el('td', { class: 'shrink' }, [use]),
        ...openTable.columns.map((column) => el('td', { text: String(row[column.key] ?? '') })),
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

      for (const item of wanted) {
        await api('/api/tables', {
          method: 'POST',
          body: { action: 'row', companyId: state.companyId, tableId: openTable.id, values: item.row },
        });
      }

      await load(openTable.id);
      toast(`${wanted.length} rows added.`);
    },
  });
}

function draw() {
  const host = clear($('view'));

  host.appendChild(el('div', { class: 'toolbar' }, [
    el('div', { class: 'tabs' }, tables.map((table) => el('button', {
      type: 'button',
      class: openTable?.id === table.id ? 'is-on' : '',
      text: `${table.name} (${table.rows ?? 0})`,
      onclick: () => load(table.id),
    }))),
    can('table.manage') ? el('button', { class: 'btn', type: 'button', text: '+ Table', onclick: create }) : null,
  ]));

  if (!tables.length) {
    host.appendChild(el('p', { class: 'empty', text: can('table.manage')
      ? 'No tables yet. A customer list, a stock count, a price list — whatever you need.'
      : 'No tables yet. Creating one is an admin job.' }));
    return;
  }

  if (!openTable) {
    host.appendChild(el('p', { class: 'empty', text: 'Pick a table above.' }));
    return;
  }

  host.appendChild(el('div', { class: 'toolbar toolbar--sub' }, [
    el('h3', { text: openTable.name }),
    el('div', { class: 'spread' }, [
      can('row.write') ? el('button', { class: 'btn btn--sm', type: 'button', text: '+ Row', onclick: () => rowDialog() }) : null,
      can('row.write') ? el('button', { class: 'btn btn--ai btn--sm', type: 'button', text: '✦ Fill with Vlipa', onclick: rowsWithAi }) : null,
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Download CSV', onclick: exportCsv }),
      can('table.manage') ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Columns', onclick: editColumns }) : null,
      can('table.manage') ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Delete table', onclick: dropTable }) : null,
    ]),
  ]));

  const head = el('tr', {}, [
    ...openTable.columns.map((column) => el('th', { text: column.label })),
    can('row.write') ? el('th', { class: 'shrink', text: '' }) : null,
  ]);

  const body = rows.map((row) => el('tr', {}, [
    ...openTable.columns.map((column) => el('td', { text: String(row.values[column.key] ?? '') })),
    can('row.write') ? el('td', { class: 'shrink' }, [
      el('button', { class: 'ghostlink', type: 'button', text: 'Edit', onclick: () => rowDialog(row) }),
      el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Delete', onclick: () => dropRow(row) }),
    ]) : null,
  ]));

  host.appendChild(el('div', { class: 'tablewrap' }, [
    el('table', { class: 'grid' }, [
      el('thead', {}, [head]),
      el('tbody', {}, body.length ? body : [
        el('tr', {}, [el('td', { colspan: openTable.columns.length + 1, class: 'muted', text: 'This table is empty.' })]),
      ]),
    ]),
  ]));
}

async function load(id) {
  const query = new URLSearchParams({ companyId: state.companyId });
  if (id) query.set('id', id);

  const data = await api(`/api/tables?${query}`);

  tables = data.tables || [];
  openTable = data.table || (id ? null : openTable);
  rows = data.rows || [];

  if (openTable && !tables.some((table) => table.id === openTable.id)) openTable = null;
  draw();
}

export async function show() {
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Loading tables…' }));
  await load(openTable?.id);
}

export function summary() {
  return { tables: tables.length };
}
