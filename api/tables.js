/* Tables: the company's own small database.

   A table is a list of columns; a row is a set of values against them. Enough
   for a customer list, a stock count or a price sheet, without asking anybody
   to run a database.

   GET  ?companyId= [&id=]        → tables, or one table with its rows
   POST { action: 'create' }      → a table
   POST { action: 'columns' }     → change its columns
   POST { action: 'rename' }      → rename it
   POST { action: 'drop' }        → delete it
   POST { action: 'row' }         → add or update a row
   POST { action: 'row.delete' }  → remove one */

import crypto from 'node:crypto';
import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import { can, guard } from './_lib/org.js';
import * as store from './_lib/store.js';

const TYPES = ['text', 'number', 'date', 'choice'];
const MAX_TABLES = 30;
const MAX_ROWS = 2000;
const MAX_COLUMNS = 16;

function cleanColumns(columns) {
  return (Array.isArray(columns) ? columns : [])
    .slice(0, MAX_COLUMNS)
    .map((column, index) => ({
      key: String(column.key || `c${index + 1}`).replace(/[^a-z0-9_]/gi, '').slice(0, 24) || `c${index + 1}`,
      label: String(column.label || `Column ${index + 1}`).slice(0, 40),
      type: TYPES.includes(column.type) ? column.type : 'text',
      options: Array.isArray(column.options)
        ? column.options.slice(0, 12).map((option) => String(option).slice(0, 40))
        : [],
    }));
}

function cleanValues(columns, values) {
  const out = {};

  for (const column of columns) {
    const raw = values?.[column.key];
    if (raw === undefined || raw === null) { out[column.key] = ''; continue; }

    if (column.type === 'number') {
      const number = Number(String(raw).replace(',', '.'));
      out[column.key] = Number.isFinite(number) ? number : '';
    } else {
      out[column.key] = String(raw).slice(0, 500);
    }
  }

  return out;
}

async function listTables(companyId) {
  const ids = await store.members(`co-tables:${companyId}`);
  const out = [];

  for (const id of ids) {
    const table = await store.get(`table:${id}`);
    if (table) out.push({ ...table, rows: (await store.members(`table-rows:${id}`)).length });
    else await store.removeFrom(`co-tables:${companyId}`, id);
  }

  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function listRows(tableId) {
  const ids = await store.members(`table-rows:${tableId}`);
  const out = [];

  for (const id of ids) {
    const row = await store.get(`row:${id}`);
    if (row) out.push(row);
    else await store.removeFrom(`table-rows:${tableId}`, id);
  }

  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Sign in first.');

  try {
    if (req.method === 'GET') {
      const check = await guard({ user, companyId: req.query?.companyId });
      if (check.error) return fail(res, check.status, check.error);

      const tables = await listTables(check.company.id);
      const wanted = req.query?.id;

      if (!wanted) return json(res, 200, { ok: true, tables, types: TYPES });

      const table = await store.get(`table:${wanted}`);
      if (!table || table.companyId !== check.company.id) return fail(res, 404, 'Table not found.');

      return json(res, 200, { ok: true, tables, table, rows: await listRows(table.id), types: TYPES });
    }

    const body = await readBody(req);
    const check = await guard({ user, companyId: body.companyId });
    if (check.error) return fail(res, check.status, check.error);

    const mayManage = can(check.role, 'table.manage');
    const mayWrite = can(check.role, 'row.write');

    if (body.action === 'create') {
      if (!mayManage) return fail(res, 403, 'Creating a table is an admin job.');

      const ids = await store.members(`co-tables:${check.company.id}`);
      if (ids.length >= MAX_TABLES) return fail(res, 429, `A company can hold at most ${MAX_TABLES} tables.`);

      const columns = cleanColumns(body.columns?.length ? body.columns : [
        { key: 'ad', label: 'Ad', type: 'text' },
        { key: 'not', label: 'Not', type: 'text' },
      ]);

      const table = {
        id: crypto.randomUUID(),
        companyId: check.company.id,
        name: String(body.name || 'Yeni tablo').slice(0, 60),
        columns,
        createdBy: user.id,
        createdAt: new Date().toISOString(),
      };

      await store.set(`table:${table.id}`, table);
      await store.addTo(`co-tables:${check.company.id}`, table.id);

      return json(res, 201, { ok: true, table });
    }

    const table = await store.get(`table:${body.tableId || body.id}`);
    if (!table || table.companyId !== check.company.id) return fail(res, 404, 'Table not found.');

    if (body.action === 'rename' || body.action === 'columns' || body.action === 'drop') {
      if (!mayManage) return fail(res, 403, 'Changing a table is an admin job.');
    } else if (!mayWrite) {
      return fail(res, 403, 'You are not allowed to write rows.');
    }

    if (body.action === 'drop') {
      for (const id of await store.members(`table-rows:${table.id}`)) await store.del(`row:${id}`);

      await store.del(`table:${table.id}`);
      await store.removeFrom(`co-tables:${check.company.id}`, table.id);

      return json(res, 200, { ok: true });
    }

    if (body.action === 'rename') {
      table.name = String(body.name || table.name).slice(0, 60);
      await store.set(`table:${table.id}`, table);
      return json(res, 200, { ok: true, table });
    }

    if (body.action === 'columns') {
      table.columns = cleanColumns(body.columns);
      await store.set(`table:${table.id}`, table);
      return json(res, 200, { ok: true, table });
    }

    if (body.action === 'row') {
      const existing = body.rowId ? await store.get(`row:${body.rowId}`) : null;
      if (body.rowId && (!existing || existing.tableId !== table.id)) return fail(res, 404, 'Row not found.');

      if (!existing) {
        const ids = await store.members(`table-rows:${table.id}`);
        if (ids.length >= MAX_ROWS) return fail(res, 429, `A table can hold at most ${MAX_ROWS} rows.`);
      }

      const row = {
        id: existing?.id || crypto.randomUUID(),
        tableId: table.id,
        values: cleanValues(table.columns, body.values),
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: user.id,
      };

      await store.set(`row:${row.id}`, row);
      await store.addTo(`table-rows:${table.id}`, row.id);

      return json(res, 200, { ok: true, row });
    }

    if (body.action === 'row.delete') {
      const row = await store.get(`row:${body.rowId}`);
      if (!row || row.tableId !== table.id) return fail(res, 404, 'Row not found.');

      await store.del(`row:${row.id}`);
      await store.removeFrom(`table-rows:${table.id}`, row.id);

      return json(res, 200, { ok: true });
    }

    return fail(res, 400, 'Unknown action.');
  } catch (error) {
    console.error('[vlipa] tables:', error);
    return fail(res, 500, 'The table service is not answering right now.');
  }
}
