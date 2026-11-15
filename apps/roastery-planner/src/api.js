// JSON API served by Cloudflare Pages Functions under /api/*.
import { callerEmail, bootstrapAdmins } from './lib/auth.js';
import { buildReport } from './lib/reports.js';
import {
  PLATFORMS, FORMATS, STATUSES, ROLES, CAMPAIGN_STATUSES, PRODUCT_STATUSES, TOOL_STATUSES, isValidFormat,
} from '../public/lib/shared.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const RANK = { viewer: 0, editor: 1, admin: 2 };
const need = (me, role) => { if (RANK[me.role] < RANK[role]) throw new HttpError(403, 'ما عندك صلاحية لهذا الإجراء'); };

// Riyadh local time (UTC+3 by default) as 'YYYY-MM-DDTHH:MM'.
const nowLocal = (env) => new Date(Date.now() + Number(env.TZ_OFFSET_HOURS ?? 3) * 3600_000).toISOString().slice(0, 16);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

function str(v, max = 2000) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new HttpError(400, 'النص طويل جدًا');
  return s;
}
function oneOf(v, allowed, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (!Object.prototype.hasOwnProperty.call(allowed, v)) throw new HttpError(400, `قيمة غير صحيحة: ${v}`);
  return v;
}
function date(v, re = DATE_RE) {
  const s = str(v, 20);
  if (s && !re.test(s)) throw new HttpError(400, `تاريخ غير صحيح: ${s}`);
  return s;
}
function url(v) {
  const s = str(v, 1000);
  if (s && !/^https?:\/\//i.test(s)) throw new HttpError(400, 'الرابط لازم يبدأ بـ http:// أو https://');
  return s;
}
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

async function readJSON(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'بيانات غير صالحة'); }
}

async function log(env, me, action, entity, entityId, details) {
  await env.DB.prepare('INSERT INTO activity_log (actor, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)')
    .bind(me.email, action, entity, entityId == null ? null : String(entityId), details ? JSON.stringify(details).slice(0, 2000) : null)
    .run();
}

// ---------- identity ----------

async function identify(request, env) {
  const email = await callerEmail(request, env);
  if (!email) throw new HttpError(401, 'لازم تسجل دخول عن طريق Cloudflare Access');
  const row = await env.DB.prepare('SELECT email, name, role, active FROM team_members WHERE email = ?').bind(email).first();
  if (bootstrapAdmins(env).includes(email)) return { email, name: row?.name || email, role: 'admin' };
  if (!row || !row.active) throw new HttpError(403, 'حسابك مو مضاف للفريق. كلّم المدير يضيفك.');
  return row;
}

// ---------- posts ----------

const POST_COLS = 'id, title, caption, platform, format, planned_at, campaign_id, owner_email, asset_url, status, published_at, post_url, notes, created_by, created_at, updated_at';

async function loadPosts(env, where = '', binds = []) {
  const [posts, pp, pt] = await env.DB.batch([
    env.DB.prepare(`SELECT ${POST_COLS} FROM posts ${where} ORDER BY COALESCE(published_at, planned_at, created_at)`).bind(...binds),
    env.DB.prepare('SELECT post_id, product_id FROM post_products'),
    env.DB.prepare('SELECT post_id, tool_id FROM post_tools'),
  ]);
  const prod = new Map();
  for (const r of pp.results) (prod.get(r.post_id) || prod.set(r.post_id, []).get(r.post_id)).push(r.product_id);
  const tool = new Map();
  for (const r of pt.results) (tool.get(r.post_id) || tool.set(r.post_id, []).get(r.post_id)).push(r.tool_id);
  return posts.results.map((p) => ({ ...p, product_ids: prod.get(p.id) || [], tool_ids: tool.get(p.id) || [] }));
}

function parsePost(body, env, existing = {}) {
  const merged = { ...existing, ...body };
  const p = {
    title: str(merged.title, 300),
    caption: str(merged.caption, 5000),
    platform: oneOf(merged.platform, PLATFORMS),
    format: str(merged.format, 30),
    planned_at: date(merged.planned_at, DATETIME_RE),
    campaign_id: merged.campaign_id ? Number(merged.campaign_id) : null,
    owner_email: str(merged.owner_email, 200)?.toLowerCase() || null,
    asset_url: url(merged.asset_url),
    status: oneOf(merged.status, STATUSES, 'idea'),
    published_at: date(merged.published_at, DATETIME_RE),
    post_url: url(merged.post_url),
    notes: str(merged.notes, 5000),
  };
  if (!p.title) throw new HttpError(400, 'العنوان مطلوب');
  if (!p.platform) throw new HttpError(400, 'المنصة مطلوبة');
  if (!isValidFormat(p.platform, p.format)) throw new HttpError(400, 'الصيغة ما تناسب المنصة المختارة');
  if (p.status === 'published' && !p.published_at) p.published_at = nowLocal(env);
  if (p.status !== 'published') p.published_at = null;
  return p;
}

const linkStatements = (env, postId, productIds, toolIds) => [
  env.DB.prepare('DELETE FROM post_products WHERE post_id = ?').bind(postId),
  env.DB.prepare('DELETE FROM post_tools WHERE post_id = ?').bind(postId),
  ...productIds.map((id) => env.DB.prepare('INSERT OR IGNORE INTO post_products (post_id, product_id) SELECT ?, id FROM products WHERE id = ?').bind(postId, id)),
  ...toolIds.map((id) => env.DB.prepare('INSERT OR IGNORE INTO post_tools (post_id, tool_id) SELECT ?, id FROM tools WHERE id = ?').bind(postId, id)),
];

async function getPost(env, id) {
  const [p] = await loadPosts(env, 'WHERE id = ?', [id]);
  if (!p) throw new HttpError(404, 'المنشور غير موجود');
  return p;
}

async function createPost(request, env, me) {
  need(me, 'editor');
  const body = await readJSON(request);
  const p = parsePost(body, env);
  const row = await env.DB.prepare(
    `INSERT INTO posts (title, caption, platform, format, planned_at, campaign_id, owner_email, asset_url, status, published_at, post_url, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(p.title, p.caption, p.platform, p.format, p.planned_at, p.campaign_id, p.owner_email, p.asset_url, p.status, p.published_at, p.post_url, p.notes, me.email).first();
  await env.DB.batch(linkStatements(env, row.id, ids(body.product_ids), ids(body.tool_ids)));
  await log(env, me, 'create', 'post', row.id, { title: p.title, status: p.status });
  return json(await getPost(env, row.id), 201);
}

async function updatePost(request, env, me, id) {
  need(me, 'editor');
  const current = await getPost(env, id);
  const body = await readJSON(request);
  const p = parsePost(body, env, current);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE posts SET title=?, caption=?, platform=?, format=?, planned_at=?, campaign_id=?, owner_email=?, asset_url=?, status=?, published_at=?, post_url=?, notes=?, updated_at=datetime('now') WHERE id=?`,
    ).bind(p.title, p.caption, p.platform, p.format, p.planned_at, p.campaign_id, p.owner_email, p.asset_url, p.status, p.published_at, p.post_url, p.notes, id),
    ...linkStatements(env, id, 'product_ids' in body ? ids(body.product_ids) : current.product_ids, 'tool_ids' in body ? ids(body.tool_ids) : current.tool_ids),
  ]);
  const changed = Object.keys(body).filter((k) => JSON.stringify(body[k]) !== JSON.stringify(current[k]));
  await log(env, me, current.status !== p.status ? `status:${p.status}` : 'update', 'post', id, { changed });
  return json(await getPost(env, id));
}

async function deletePost(env, me, id) {
  need(me, 'editor');
  const current = await getPost(env, id);
  await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  await log(env, me, 'delete', 'post', id, { title: current.title });
  return json({ ok: true });
}

// ---------- lookup lists (campaigns / products / tools) ----------

const LISTS = {
  campaigns: {
    cols: ['name', 'start_date', 'end_date', 'goal', 'color', 'status'],
    parse: (b) => ({
      name: str(b.name, 200), start_date: date(b.start_date), end_date: date(b.end_date), goal: str(b.goal, 1000),
      color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#8b5a2b', status: oneOf(b.status, CAMPAIGN_STATUSES, 'active'),
    }),
    usage: 'SELECT COUNT(*) AS n FROM posts WHERE campaign_id = ?',
  },
  products: {
    cols: ['name', 'origin', 'process', 'status'],
    parse: (b) => ({ name: str(b.name, 200), origin: str(b.origin, 200), process: str(b.process, 200), status: oneOf(b.status, PRODUCT_STATUSES, 'available') }),
    usage: 'SELECT COUNT(*) AS n FROM post_products WHERE product_id = ?',
  },
  tools: {
    cols: ['name', 'category', 'status'],
    parse: (b) => ({ name: str(b.name, 200), category: str(b.category, 200), status: oneOf(b.status, TOOL_STATUSES, 'active') }),
    usage: 'SELECT COUNT(*) AS n FROM post_tools WHERE tool_id = ?',
  },
};

async function listHandler(request, env, me, table, id) {
  const def = LISTS[table];
  const method = request.method;
  if (method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY status, name`).all();
    return json(results);
  }
  need(me, 'admin');
  if (method === 'DELETE') {
    const { n } = await env.DB.prepare(def.usage).bind(id).first();
    if (n > 0) throw new HttpError(409, `مستخدم في ${n} منشور. أرشفه بدل الحذف عشان ما تتغير التقارير.`);
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    await log(env, me, 'delete', table, id);
    return json({ ok: true });
  }
  const v = def.parse(await readJSON(request));
  if (!v.name) throw new HttpError(400, 'الاسم مطلوب');
  const values = def.cols.map((c) => v[c]);
  let row;
  if (method === 'POST') {
    row = await env.DB.prepare(`INSERT INTO ${table} (${def.cols.join(', ')}) VALUES (${def.cols.map(() => '?').join(', ')}) RETURNING *`).bind(...values).first();
  } else if (method === 'PUT') {
    row = await env.DB.prepare(`UPDATE ${table} SET ${def.cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? RETURNING *`).bind(...values, id).first();
    if (!row) throw new HttpError(404, 'غير موجود');
  } else throw new HttpError(405, 'Method not allowed');
  await log(env, me, method === 'POST' ? 'create' : 'update', table, row.id, { name: row.name });
  return json(row, method === 'POST' ? 201 : 200);
}

// ---------- team ----------

async function teamHandler(request, env, me, email) {
  if (request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT email, name, role, active FROM team_members ORDER BY active DESC, name').all();
    return json(results);
  }
  need(me, 'admin');
  if (request.method === 'DELETE') {
    if (email === me.email) throw new HttpError(400, 'ما تقدر تحذف نفسك');
    await env.DB.prepare('UPDATE team_members SET active = 0 WHERE email = ?').bind(email).run();
    await log(env, me, 'deactivate', 'team', email);
    return json({ ok: true });
  }
  const b = await readJSON(request);
  const m = {
    email: (str(b.email, 200) || email || '').toLowerCase(),
    name: str(b.name, 200),
    role: oneOf(b.role, ROLES, 'editor'),
    active: b.active === false || b.active === 0 ? 0 : 1,
  };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email)) throw new HttpError(400, 'إيميل غير صحيح');
  if (!m.name) throw new HttpError(400, 'الاسم مطلوب');
  await env.DB.prepare(
    `INSERT INTO team_members (email, name, role, active) VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, active = excluded.active`,
  ).bind(m.email, m.name, m.role, m.active).run();
  await log(env, me, 'upsert', 'team', m.email, { role: m.role, active: m.active });
  return json(m);
}

// ---------- reports ----------

async function reportsHandler(url, env) {
  const from = date(url.searchParams.get('from'));
  const to = date(url.searchParams.get('to'));
  const platform = oneOf(url.searchParams.get('platform'), PLATFORMS, null);
  const staleDays = Math.max(1, Math.min(365, Number(url.searchParams.get('stale_days')) || 30));
  const [posts, lists] = await Promise.all([
    loadPosts(env),
    env.DB.batch([
      env.DB.prepare('SELECT * FROM campaigns'),
      env.DB.prepare('SELECT * FROM products'),
      env.DB.prepare('SELECT * FROM tools'),
      env.DB.prepare('SELECT email, name FROM team_members'),
    ]),
  ]);
  const [campaigns, products, tools, team] = lists.map((r) => r.results);
  return json(buildReport({ posts, campaigns, products, tools, team }, { from, to, platform, staleDays, today: nowLocal(env).slice(0, 10) }));
}

// ---------- router ----------

async function route(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [resource, rawId, action] = parts;
  const method = request.method;
  {
    if (!env.DB) throw new HttpError(500, 'قاعدة البيانات D1 غير مربوطة (binding: DB)');
    const me = await identify(request, env);

    if (resource === 'me') return json(me);

    if (resource === 'bootstrap' && method === 'GET') {
      const [campaigns, products, tools, team] = (await env.DB.batch([
        env.DB.prepare('SELECT * FROM campaigns ORDER BY status, name'),
        env.DB.prepare('SELECT * FROM products ORDER BY status, name'),
        env.DB.prepare('SELECT * FROM tools ORDER BY status, name'),
        env.DB.prepare('SELECT email, name, role, active FROM team_members ORDER BY active DESC, name'),
      ])).map((r) => r.results);
      return json({
        me, campaigns, products, tools, team, today: nowLocal(env).slice(0, 10),
        constants: { PLATFORMS, FORMATS, STATUSES, ROLES, CAMPAIGN_STATUSES, PRODUCT_STATUSES, TOOL_STATUSES },
      });
    }

    if (resource === 'posts') {
      const id = rawId ? Number(rawId) : null;
      if (rawId && !Number.isInteger(id)) throw new HttpError(404, 'غير موجود');
      if (!id && method === 'GET') {
        const from = date(url.searchParams.get('from'));
        const to = date(url.searchParams.get('to'));
        if (from && to) {
          // Anything planned or published inside the window, plus unscheduled ideas.
          return json(await loadPosts(env,
            `WHERE (substr(planned_at,1,10) BETWEEN ?1 AND ?2) OR (substr(published_at,1,10) BETWEEN ?1 AND ?2) OR planned_at IS NULL`, [from, to]));
        }
        return json(await loadPosts(env));
      }
      if (!id && method === 'POST') return createPost(request, env, me);
      if (id && method === 'GET') return json(await getPost(env, id));
      if (id && (method === 'PUT' || method === 'PATCH') && !action) return updatePost(request, env, me, id);
      if (id && method === 'DELETE') return deletePost(env, me, id);
    }

    if (LISTS[resource]) return listHandler(request, env, me, resource, rawId ? Number(rawId) : null);
    if (resource === 'team') return teamHandler(request, env, me, rawId ? rawId.toLowerCase() : null);
    if (resource === 'reports' && method === 'GET') return reportsHandler(url, env);
    if (resource === 'activity' && method === 'GET') {
      const limit = Math.min(500, Number(url.searchParams.get('limit')) || 100);
      const { results } = await env.DB.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').bind(limit).all();
      return json(results);
    }
    throw new HttpError(404, 'غير موجود');
  }
}

export async function handle(request, env) {
  try {
    return await route(request, env);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'صار خطأ في السيرفر' }, 500);
  }
}
