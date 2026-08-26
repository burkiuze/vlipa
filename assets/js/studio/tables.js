/* Tablolar: şirketin kendi küçük veritabanı. */

import { api, can, state } from './api.js';
import { $, clear, dialog, el, field, toast } from './dom.js';

let tables = [];
let openTable = null;
let rows = [];

function columnEditor(columns) {
  const host = el('div', { class: 'cols' });

  const line = (column = { key: '', label: '', type: 'text' }) => {
    const row = el('div', { class: 'cols__row' }, [
      el('input', { class: 'col-label', placeholder: 'Sütun adı', value: column.label || '', maxlength: 40 }),
      el('select', { class: 'col-type' }, [
        ['text', 'Metin'], ['number', 'Sayı'], ['date', 'Tarih'], ['choice', 'Seçenek'],
      ].map(([value, label]) => el('option', { value, selected: column.type === value, text: label }))),
      el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: '×', onclick: () => row.remove() }),
    ]);

    return row;
  };

  columns.forEach((column) => host.appendChild(line(column)));

  return el('div', {}, [
    host,
    el('button', {
      class: 'ghostlink', type: 'button', text: '+ Sütun ekle',
      onclick: () => host.appendChild(line()),
    }),
  ]);
}

function readColumns(scope) {
  return Array.from(scope.querySelectorAll('.cols__row')).map((row, index) => {
    const label = row.querySelector('.col-label').value.trim() || `Sütun ${index + 1}`;
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
    title: 'Yeni tablo',
    confirm: 'Oluştur',
    body: [
      field('Tablo adı', el('input', { name: 'name', required: true, maxlength: 60, placeholder: 'Müşteriler' })),
      field('Sütunlar', editor),
    ],
    onConfirm: async (data) => {
      const created = await api('/api/tables', {
        method: 'POST',
        body: { action: 'create', companyId: state.companyId, name: data.get('name'), columns: readColumns(editor) },
      });

      await load(created.table.id);
      toast('Tablo açıldı.');
    },
  });
}

function editColumns() {
  const editor = columnEditor(openTable.columns);

  dialog({
    title: `${openTable.name} — sütunlar`,
    body: [field('Sütunlar', editor)],
    onConfirm: async (_data) => {
      await api('/api/tables', {
        method: 'POST',
        body: { action: 'columns', companyId: state.companyId, tableId: openTable.id, columns: readColumns(editor) },
      });

      await load(openTable.id);
      toast('Sütunlar güncellendi.');
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
    title: row ? 'Satırı düzenle' : 'Yeni satır',
    confirm: row ? 'Kaydet' : 'Ekle',
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
  if (!window.confirm('Bu satır silinsin mi?')) return;

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
  if (!window.confirm(`"${openTable.name}" ve içindeki her şey silinsin mi?`)) return;

  try {
    await api('/api/tables', {
      method: 'POST',
      body: { action: 'drop', companyId: state.companyId, tableId: openTable.id },
    });

    openTable = null;
    await load();
    toast('Tablo silindi.');
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

/* Tabloya ne gireceğini anlat, Vlipa satırları hazırlasın. */
function rowsWithAi() {
  dialog({
    title: `${openTable.name} — Vlipa ile satır üret`,
    confirm: 'Üret',
    body: [
      field('Ne tür satırlar istiyorsun?',
        el('textarea', { name: 'ask', rows: 3, required: true, maxlength: 600,
          placeholder: 'Kahve dükkanı menüsü için sekiz içecek: adı, fiyatı ve kısa notu.' }),
        'Vlipa sütunları görüyor. Bilmediği alanları boş bırakır.'),
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

/* Önerilen satırlar eklenmeden önce gösterilir. */
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
    title: `Vlipa ${proposed.length} satır hazırladı`,
    confirm: 'Seçilenleri ekle',
    body: [
      el('p', { class: 'muted', text: 'İstemediğinin tikini kaldır. Ekledikten sonra her satırı düzenleyebilirsin.' }),
      el('div', { class: 'tablewrap' }, [table]),
    ],
    onConfirm: async () => {
      const wanted = boxes.filter((item) => item.use.checked);
      if (!wanted.length) throw new Error('Hiç satır seçmedin.');

      for (const item of wanted) {
        await api('/api/tables', {
          method: 'POST',
          body: { action: 'row', companyId: state.companyId, tableId: openTable.id, values: item.row },
        });
      }

      await load(openTable.id);
      toast(`${wanted.length} satır eklendi.`);
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
    can('table.manage') ? el('button', { class: 'btn', type: 'button', text: '+ Tablo', onclick: create }) : null,
  ]));

  if (!tables.length) {
    host.appendChild(el('p', { class: 'empty', text: can('table.manage')
      ? 'Henüz tablo yok. Müşteri listesi, stok, fiyat listesi — ne gerekiyorsa açabilirsin.'
      : 'Henüz tablo yok. Tablo açmak yönetici işi.' }));
    return;
  }

  if (!openTable) {
    host.appendChild(el('p', { class: 'empty', text: 'Yukarıdan bir tablo seç.' }));
    return;
  }

  host.appendChild(el('div', { class: 'toolbar toolbar--sub' }, [
    el('h3', { text: openTable.name }),
    el('div', { class: 'spread' }, [
      can('row.write') ? el('button', { class: 'btn btn--sm', type: 'button', text: '+ Satır', onclick: () => rowDialog() }) : null,
      can('row.write') ? el('button', { class: 'btn btn--ai btn--sm', type: 'button', text: '✦ Vlipa ile doldur', onclick: rowsWithAi }) : null,
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'CSV indir', onclick: exportCsv }),
      can('table.manage') ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Sütunlar', onclick: editColumns }) : null,
      can('table.manage') ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Tabloyu sil', onclick: dropTable }) : null,
    ]),
  ]));

  const head = el('tr', {}, [
    ...openTable.columns.map((column) => el('th', { text: column.label })),
    can('row.write') ? el('th', { class: 'shrink', text: '' }) : null,
  ]);

  const body = rows.map((row) => el('tr', {}, [
    ...openTable.columns.map((column) => el('td', { text: String(row.values[column.key] ?? '') })),
    can('row.write') ? el('td', { class: 'shrink' }, [
      el('button', { class: 'ghostlink', type: 'button', text: 'Düzenle', onclick: () => rowDialog(row) }),
      el('button', { class: 'ghostlink ghostlink--bad', type: 'button', text: 'Sil', onclick: () => dropRow(row) }),
    ]) : null,
  ]));

  host.appendChild(el('div', { class: 'tablewrap' }, [
    el('table', { class: 'grid' }, [
      el('thead', {}, [head]),
      el('tbody', {}, body.length ? body : [
        el('tr', {}, [el('td', { colspan: openTable.columns.length + 1, class: 'muted', text: 'Bu tablo boş.' })]),
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
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Tablolar yükleniyor…' }));
  await load(openTable?.id);
}

export function summary() {
  return { tables: tables.length };
}
