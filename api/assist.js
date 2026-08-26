/* Vlipa çalışma alanının içinde: iş çıkarır, işi hazırlar, işi yapar.

   POST { action: 'plan' }   → hedefi görevlere böler, kime gideceğini önerir
   POST { action: 'brief' }  → bir görevi adım adım hazırlar
   POST { action: 'do' }     → görevin çıktısını üretir (metin, taslak, liste)
   POST { action: 'rows' }   → bir tabloya satır önerir

   Hiçbiri kendiliğinden kaydetmez: hepsi öneri döner, kaydetme kararı
   kullanıcıda kalır. */

import { SESSION_COOKIE, userFromToken } from './_lib/auth.js';
import { callerKey, fail, json, methodGuard, parseCookies, readBody, withinLimit } from './_lib/http.js';
import { can, guard, membersOf } from './_lib/org.js';
import { chatCompletion, hasKey } from './_lib/openrouter.js';
import * as store from './_lib/store.js';

const STATES = ['todo', 'doing', 'review', 'done'];

/* Models wrap JSON in prose and code fences often enough to plan for it. */
function parseJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start < 0 || end < start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function think({ system, user, mode, wantJson = false, maxTokens }) {
  if (!hasKey()) {
    const error = new Error('Vlipa şu an bağlı değil: sunucuda OPENROUTER_API_KEY tanımlı değil.');
    error.status = 503;
    throw error;
  }

  return chatCompletion({
    mode: mode === 'thinking' ? 'thinking' : 'fast',
    json: wantJson,
    maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const user = await userFromToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Önce giriş yap.');

  if (!withinLimit(`assist:${callerKey(req)}`, 12)) {
    return fail(res, 429, 'Biraz yavaş: dakikada 12 istek.');
  }

  const body = await readBody(req);
  const check = await guard({ user, companyId: body.companyId, right: 'chat.use' });
  if (check.error) return fail(res, check.status, check.error);

  const company = check.company;
  const mode = body.mode === 'thinking' ? 'thinking' : 'fast';

  try {
    /* ---- hedefi görevlere böl ---- */
    if (body.action === 'plan') {
      if (!can(check.role, 'task.own')) return fail(res, 403, 'Görev planlamak için en az üye olman gerekiyor.');

      const goal = String(body.goal || '').trim();
      if (goal.length < 8) return fail(res, 400, 'Hedefi biraz daha anlat.');

      const team = await membersOf(company.id);
      const roster = team
        .map((member) => `- ${member.name || member.email} (${member.role}, id: ${member.userId})`)
        .join('\n');

      const answer = await think({
        mode,
        wantJson: true,
        maxTokens: 1800,
        system: [
          'Sen Vlipa\'sın, bir şirketin çalışma alanında iş planlıyorsun.',
          'Yalnızca JSON döndür, başka hiçbir şey yazma.',
          'Biçim: {"tasks":[{"title":string,"detail":string,"assignee":string,"due":"YYYY-MM-DD","status":"todo"}]}',
          'title kısa ve emir kipinde olsun. detail iki üç cümle: ne yapılacak, neye dikkat edilecek.',
          'assignee alanına yukarıdaki listedeki id değerlerinden birini yaz; emin değilsen boş bırak.',
          'İşi yapacak kişiyi rolüne göre seç: yönetici koordinasyon, üye uygulama işlerini alır.',
          'due bugünden sonraki bir tarih olsun, işin ağırlığına göre dağıt.',
          'Üçten sekize kadar görev çıkar. Uydurma isim, uydurma rakam, uydurma müşteri kullanma.',
          'Kullanıcı hangi dilde yazdıysa o dilde yaz.',
        ].join(' '),
        user: [
          `Şirket: ${company.name}`,
          `Bugün: ${today()}`,
          `Ekip:\n${roster}`,
          `Hedef: ${goal}`,
        ].join('\n\n'),
      });

      const parsed = parseJson(answer);
      const ids = new Set(team.map((member) => member.userId));

      const tasks = (parsed?.tasks || []).slice(0, 8).map((task) => ({
        title: String(task.title || '').slice(0, 140),
        detail: String(task.detail || '').slice(0, 2000),
        assignee: ids.has(task.assignee) ? task.assignee : '',
        due: /^\d{4}-\d{2}-\d{2}$/.test(task.due || '') && task.due >= today() ? task.due : '',
        status: STATES.includes(task.status) ? task.status : 'todo',
      })).filter((task) => task.title);

      if (!tasks.length) return fail(res, 502, 'Vlipa bu hedeften görev çıkaramadı. Biraz daha somut anlat.');

      return json(res, 200, { ok: true, tasks });
    }

    /* ---- bir görevi hazırla ---- */
    if (body.action === 'brief' || body.action === 'do') {
      const task = await store.get(`task:${body.taskId}`);
      if (!task || task.companyId !== company.id) return fail(res, 404, 'Görev bulunamadı.');

      const brief = body.action === 'brief';

      const answer = await think({
        mode,
        maxTokens: brief ? 900 : 1600,
        system: brief
          ? [
              'Sen Vlipa\'sın. Bir görevi yapılabilir hâle getiriyorsun.',
              'Kısa bir hazırlık çıkar: önce tek cümlelik amaç, sonra sırayla adımlar,',
              'sonra "dikkat" başlığı altında en fazla üç uyarı. Markdown başlığı kullanma,',
              'düz metin ve tire ile madde yaz. Uydurma bilgi ekleme.',
              'Görev hangi dilde yazıldıysa o dilde yaz.',
            ].join(' ')
          : [
              'Sen Vlipa\'sın. Bu görevin kendisini yapıyorsun, nasıl yapılacağını anlatmıyorsun.',
              'İstenen çıktıyı doğrudan üret: metin isteniyorsa metni, liste isteniyorsa listeyi,',
              'taslak isteniyorsa taslağı yaz. Giriş cümlesi, "işte" gibi sunuş, açıklama ekleme.',
              'Bilmediğin bir bilgi gerekiyorsa köşeli parantezle boşluk bırak: [tarih], [fiyat].',
              'Görev hangi dilde yazıldıysa o dilde yaz.',
            ].join(' '),
        user: [
          `Şirket: ${company.name}`,
          `Görev: ${task.title}`,
          task.detail ? `Ayrıntı: ${task.detail}` : '',
          task.due ? `Bitiş: ${task.due}` : '',
          body.ask ? `Ek istek: ${String(body.ask).slice(0, 500)}` : '',
        ].filter(Boolean).join('\n'),
      });

      const text = String(answer || '').trim();
      if (!text) return fail(res, 502, 'Vlipa boş bir cevap döndürdü.');

      return json(res, 200, { ok: true, text, taskId: task.id, kind: body.action });
    }

    /* ---- tabloya satır öner ---- */
    if (body.action === 'rows') {
      if (!can(check.role, 'row.write')) return fail(res, 403, 'Satır yazma yetkin yok.');

      const table = await store.get(`table:${body.tableId}`);
      if (!table || table.companyId !== company.id) return fail(res, 404, 'Tablo bulunamadı.');

      const ask = String(body.ask || '').trim();
      if (ask.length < 4) return fail(res, 400, 'Ne tür satırlar istediğini yaz.');

      const columns = table.columns
        .map((column) => `- ${column.key} (${column.label}, ${column.type})`)
        .join('\n');

      const answer = await think({
        mode,
        wantJson: true,
        maxTokens: 1600,
        system: [
          'Sen Vlipa\'sın, bir tabloya satır hazırlıyorsun.',
          'Yalnızca JSON döndür: {"rows":[{"<sütun anahtarı>": "değer"}]}',
          'Sadece verilen sütun anahtarlarını kullan. number sütunlarına sayı yaz.',
          'date sütunlarına YYYY-AA-GG yaz. En fazla on satır.',
          'Gerçek gibi görünen sahte veri uydurmak yerine, kullanıcının istediği içeriği üret;',
          'bilmediğin alanları boş bırak.',
        ].join(' '),
        user: [`Tablo: ${table.name}`, `Sütunlar:\n${columns}`, `İstenen: ${ask}`].join('\n\n'),
      });

      const parsed = parseJson(answer);
      const keys = table.columns.map((column) => column.key);

      const rows = (parsed?.rows || []).slice(0, 10).map((row) => {
        const clean = {};
        for (const key of keys) clean[key] = row?.[key] === undefined ? '' : String(row[key]).slice(0, 500);
        return clean;
      }).filter((row) => Object.values(row).some(Boolean));

      if (!rows.length) return fail(res, 502, 'Vlipa satır üretemedi. İsteğini biraz daha açık yaz.');

      return json(res, 200, { ok: true, rows, columns: table.columns });
    }

    return fail(res, 400, 'Bilinmeyen işlem.');
  } catch (error) {
    console.error('[vlipa] assist:', error.detail || error);

    return fail(res, error.status || 500, error.message || 'Vlipa şu an yardım edemiyor.', {
      reason: error.reason || '',
      tried: error.tried || [],
    });
  }
}
