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
   POST { action: 'rows' }        → add or update many at once
   POST { action: 'row.delete' }  → remove one
   POST { action: 'rows.delete' } → remove several */

import crypto from 'node:crypto';
import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { fail, json, methodGuard, parseCookies, readBody } from './_lib/http.js';
import { can, guard } from './_lib/org.js';
import * as store from './_lib/store.js';

const TYPES = ['text', 'number', 'date', 'choice'];
const MAX_TABLES = 60;
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
  if (!ids.length) return [];

  // One request for the tables, and the row counts alongside each other.
  const [found, counts] = await Promise.all([
    store.getMany(ids.map((id) => `table:${id}`)),
    Promise.all(ids.map((id) => store.members(`table-rows:${id}`))),
  ]);

  const out = [];

  ids.forEach((id, at) => {
    const table = found.get(`table:${id}`);
    if (table) out.push({ ...table, rows: counts[at].length });
    else store.removeFrom(`co-tables:${companyId}`, id).catch(() => {});
  });

  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function listRows(tableId) {
  const ids = await store.members(`table-rows:${tableId}`);
  if (!ids.length) return [];

  const found = await store.getMany(ids.map((id) => `row:${id}`));
  const out = [];

  for (const id of ids) {
    const row = found.get(`row:${id}`);
    if (row) out.push(row);
    else store.removeFrom(`table-rows:${tableId}`, id).catch(() => {});
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

    const mayWrite = can(check.role, 'row.write');

    if (body.action === 'create') {
      if (!can(check.role, 'table.create')) return fail(res, 403, 'Your role cannot open a table.');

      const ids = await store.members(`co-tables:${check.company.id}`);
      if (ids.length >= MAX_TABLES) return fail(res, 429, `A company can hold at most ${MAX_TABLES} tables.`);

      const columns = cleanColumns(body.columns?.length ? body.columns : [
        { key: 'ad', label: 'Ad', type: 'text' },
        { key: 'not', label: 'Not', type: 'text' },
      ]);

      const table = {
        id: crypto.randomUUID(),
        companyId: check.company.id,
        name: String(body.name || 'New table').slice(0, 60),
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

    // A table belongs to whoever started it; admins can tidy up after anybody.
    const mine = table.createdBy === user.id;

    if (body.action === 'rename' || body.action === 'columns' || body.action === 'drop') {
      if (!mine && !can(check.role, 'table.manage')) {
        return fail(res, 403, 'This table belongs to somebody else. Ask them, or an admin.');
      }
    } else if (!mayWrite) {
      return fail(res, 403, 'You are not allowed to write rows.');
    }

    if (body.action === 'drop') {
      const ids = await store.members(`table-rows:${table.id}`);
      await Promise.all(ids.map((id) => store.del(`row:${id}`)));

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

    /* A grid is edited a screenful at a time — a pasted block, a page of
       drafted rows — and one request per row would make that crawl. */
    if (body.action === 'rows') {
      const wanted = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
      if (!wanted.length) return fail(res, 400, 'No rows were sent.');

      const ids = await store.members(`table-rows:${table.id}`);
      const known = new Set(ids);
      const fresh = wanted.filter((item) => !item.rowId || !known.has(String(item.rowId))).length;

      if (ids.length + fresh > MAX_ROWS) {
        return fail(res, 429, `A table can hold at most ${MAX_ROWS} rows.`);
      }

      const existing = await store.getMany(
        wanted.map((item) => item.rowId).filter(Boolean).map((id) => `row:${id}`));

      const now = new Date().toISOString();

      const written = wanted.map((item) => {
        const was = item.rowId ? existing.get(`row:${item.rowId}`) : null;
        const mine = was && was.tableId === table.id ? was : null;

        return {
          id: mine?.id || crypto.randomUUID(),
          tableId: table.id,
          values: cleanValues(table.columns, item.values),
          createdAt: mine?.createdAt || now,
          updatedAt: now,
          updatedBy: user.id,
        };
      });

      await Promise.all(written.map((row) => store.set(`row:${row.id}`, row)));
      await Promise.all(written.map((row) => store.addTo(`table-rows:${table.id}`, row.id)));

      return json(res, 200, { ok: true, rows: written });
    }

    if (body.action === 'rows.delete') {
      const wanted = (Array.isArray(body.rowIds) ? body.rowIds : []).map(String).slice(0, 200);
      if (!wanted.length) return fail(res, 400, 'No rows were sent.');

      const found = await store.getMany(wanted.map((id) => `row:${id}`));
      const mine = wanted.filter((id) => found.get(`row:${id}`)?.tableId === table.id);

      await Promise.all(mine.map((id) => store.del(`row:${id}`)));
      await Promise.all(mine.map((id) => store.removeFrom(`table-rows:${table.id}`, id)));

      return json(res, 200, { ok: true, removed: mine.length });
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
