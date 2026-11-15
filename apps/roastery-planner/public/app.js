import { PLATFORMS, FORMATS, STATUSES, ROLES, CAMPAIGN_STATUSES, PRODUCT_STATUSES, TOOL_STATUSES, toCSV, dayOf } from './lib/shared.js';

// ---------------------------------------------------------------- state

const S = {
  me: null, campaigns: [], products: [], tools: [], team: [], today: null,
  view: 'calendar',
  cal: { mode: 'month', cursor: null, posts: [] },
  board: { posts: [], showCancelled: false },
  filters: { platform: '', campaign: '', owner: '' },
  rep: { preset: 'this_month', from: '', to: '', platform: '', data: null },
  settingsTab: 'campaigns',
};
const PIPELINE = ['idea', 'writing', 'design', 'review', 'scheduled', 'published'];
const DOW = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const monthFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'short', day: 'numeric', month: 'short' });

const canEdit = () => S.me && S.me.role !== 'viewer';
const isAdmin = () => S.me && S.me.role === 'admin';
const byId = (list, id) => list.find((x) => x.id === id);
const campaignColor = (id) => byId(S.campaigns, id)?.color || 'var(--border)';
const memberName = (email) => S.team.find((m) => m.email === email)?.name || email || '—';

// ---------------------------------------------------------------- helpers

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // only used with static strings
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const opt = (value, label, selected) => h('option', { value, selected: String(value) === String(selected ?? '') }, label);

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const nowLocal = () => { const d = new Date(); return `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDT = (s) => (s ? s.replace('T', ' ') : '—');

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api/' + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(data?.error || `خطأ ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2500);
}
const guard = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { toast(e.message, true); }
};

function download(name, text, type = 'text/csv;charset=utf-8') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

const platformBadge = (p) => h('span', { class: `badge ${p}`, title: PLATFORMS[p]?.label }, PLATFORMS[p]?.short || p);

function matchesFilters(p) {
  const f = S.filters;
  if (f.platform && p.platform !== f.platform) return false;
  if (f.campaign && String(p.campaign_id ?? '') !== f.campaign) return false;
  if (f.owner && (p.owner_email || '') !== f.owner) return false;
  return true;
}

function filterBar(onChange) {
  const set = (k) => (e) => { S.filters[k] = e.target.value; onChange(); };
  return [
    h('select', { 'aria-label': 'المنصة', onchange: set('platform') },
      opt('', 'كل المنصات', S.filters.platform),
      Object.entries(PLATFORMS).map(([k, v]) => opt(k, v.label, S.filters.platform))),
    h('select', { 'aria-label': 'الحملة', onchange: set('campaign') },
      opt('', 'كل الحملات', S.filters.campaign),
      S.campaigns.filter((c) => c.status !== 'archived').map((c) => opt(c.id, c.name, S.filters.campaign))),
    h('select', { 'aria-label': 'المسؤول', onchange: set('owner') },
      opt('', 'كل الفريق', S.filters.owner),
      S.team.filter((m) => m.active).map((m) => opt(m.email, m.name, S.filters.owner))),
  ];
}

// ---------------------------------------------------------------- calendar

function calRange() {
  const c = S.cal.cursor;
  if (S.cal.mode === 'week') {
    const start = addDays(c, -c.getDay());
    return { start, days: 7 };
  }
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  const last = new Date(c.getFullYear(), c.getMonth() + 1, 0);
  const days = Math.ceil((last.getDate() + first.getDay()) / 7) * 7;
  return { start, days };
}

async function loadCalendar() {
  const { start, days } = calRange();
  S.cal.posts = await api(`posts?from=${iso(start)}&to=${iso(addDays(start, days - 1))}`);
}

function postChip(p) {
  return h('button', {
    type: 'button',
    class: `chip ${p.status}`,
    style: { '--c': campaignColor(p.campaign_id) },
    title: `${p.title} — ${STATUSES[p.status]}${p.planned_at ? ' — ' + fmtDT(p.planned_at) : ''}`,
    onclick: (e) => { e.stopPropagation(); openPost(p); },
  }, platformBadge(p.platform), h('span', { class: 't' }, p.title));
}

function renderCalendar(root) {
  const c = S.cal.cursor;
  const { start, days } = calRange();
  const shift = (dir) => guard(async () => {
    S.cal.cursor = S.cal.mode === 'week' ? addDays(c, 7 * dir) : new Date(c.getFullYear(), c.getMonth() + dir, 1);
    await loadCalendar();
    render();
  });
  const title = S.cal.mode === 'week'
    ? `${dayFmt.format(start)} – ${dayFmt.format(addDays(start, 6))}`
    : monthFmt.format(c);

  root.append(h('div', { class: 'toolbar' },
    h('button', { class: 'btn', onclick: shift(-1), 'aria-label': 'السابق' }, '→'),
    h('h2', {}, title),
    h('button', { class: 'btn', onclick: shift(1), 'aria-label': 'التالي' }, '←'),
    h('button', { class: 'btn ghost', onclick: guard(async () => { S.cal.cursor = parseDay(S.today); await loadCalendar(); render(); }) }, 'اليوم'),
    h('div', { class: 'seg' },
      ['month', 'week'].map((m) => h('button', {
        class: S.cal.mode === m ? 'on' : '',
        onclick: guard(async () => { S.cal.mode = m; await loadCalendar(); render(); }),
      }, m === 'month' ? 'شهر' : 'أسبوع'))),
    h('span', { class: 'spacer' }),
    filterBar(render),
    canEdit() && h('button', { class: 'btn primary', onclick: () => openPost(null, S.today) }, '+ منشور جديد'),
  ));

  const posts = S.cal.posts.filter(matchesFilters);
  const byDay = new Map();
  const unscheduled = [];
  for (const p of posts) {
    const d = dayOf(p.status === 'published' ? p.published_at || p.planned_at : p.planned_at);
    if (!d) { if (p.status !== 'cancelled') unscheduled.push(p); continue; }
    (byDay.get(d) || byDay.set(d, []).get(d)).push(p);
  }

  const grid = h('div', { class: `cal ${S.cal.mode}` }, DOW.map((d) => h('div', { class: 'dow' }, d)));
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const key = iso(d);
    const items = (byDay.get(key) || []).sort((a, b) => String(a.planned_at).localeCompare(String(b.planned_at)));
    grid.append(h('div', {
      class: ['day', S.cal.mode === 'month' && d.getMonth() !== c.getMonth() ? 'out' : '', key === S.today ? 'today' : ''].join(' '),
      ondblclick: canEdit() ? () => openPost(null, key) : null,
    },
    h('div', { class: 'num' },
      h('b', {}, d.getDate()),
      canEdit() && h('button', { class: 'add', title: 'إضافة منشور', 'aria-label': `إضافة منشور ${key}`, onclick: () => openPost(null, key) }, '+')),
    items.map(postChip)));
  }
  root.append(grid);

  if (unscheduled.length) {
    root.append(h('div', { class: 'card unscheduled' },
      h('h3', {}, `أفكار بدون موعد (${unscheduled.length})`),
      h('div', { class: 'list' }, unscheduled.map(postChip))));
  }
}

// ---------------------------------------------------------------- board

async function loadBoard() {
  S.board.posts = await api('posts');
}

function renderBoard(root) {
  root.append(h('div', { class: 'toolbar' },
    h('h2', {}, 'مراحل المحتوى'),
    h('span', { class: 'spacer' }),
    filterBar(render),
    h('label', { class: 'small muted' },
      h('input', { type: 'checkbox', checked: S.board.showCancelled, onchange: (e) => { S.board.showCancelled = e.target.checked; render(); } }),
      ' إظهار الملغي'),
    canEdit() && h('button', { class: 'btn primary', onclick: () => openPost(null, null) }, '+ منشور جديد'),
  ));

  // Published column only shows the last 30 days to keep the board readable.
  const cutoff = iso(addDays(parseDay(S.today), -30));
  const posts = S.board.posts.filter(matchesFilters)
    .filter((p) => p.status !== 'published' || (dayOf(p.published_at) || '') >= cutoff);
  const columns = S.board.showCancelled ? [...PIPELINE, 'cancelled'] : PIPELINE;

  const board = h('div', { class: 'board' });
  for (const status of columns) {
    const items = posts.filter((p) => p.status === status)
      .sort((a, b) => String(a.planned_at || '9').localeCompare(String(b.planned_at || '9')));
    const col = h('div', {
      class: 'col',
      ondragover: canEdit() ? (e) => { e.preventDefault(); col.classList.add('over'); } : null,
      ondragleave: () => col.classList.remove('over'),
      ondrop: canEdit() ? (e) => {
        e.preventDefault();
        col.classList.remove('over');
        const p = S.board.posts.find((x) => x.id === Number(e.dataTransfer.getData('text/plain')));
        if (p && p.status !== status) changeStatus(p, status);
      } : null,
    }, h('h3', {}, h('span', {}, STATUSES[status]), h('span', { class: 'muted' }, items.length)));

    for (const p of items) {
      const card = h('div', {
        class: 'card kcard',
        style: { '--c': campaignColor(p.campaign_id) },
        draggable: canEdit() ? 'true' : null,
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', String(p.id)); card.classList.add('dragging'); },
        ondragend: () => card.classList.remove('dragging'),
      },
      h('div', { class: 'title', role: 'button', tabindex: '0', onclick: () => openPost(p), onkeydown: (e) => { if (e.key === 'Enter') openPost(p); } }, p.title),
      h('div', { class: 'meta' },
        platformBadge(p.platform),
        h('span', {}, FORMATS[p.format] || p.format),
        h('span', {}, p.status === 'published' ? '✓ ' + fmtDT(p.published_at) : fmtDT(p.planned_at)),
        p.owner_email && h('span', {}, '· ' + memberName(p.owner_email))),
      h('div', { class: 'meta' },
        byId(S.campaigns, p.campaign_id) && h('span', { class: 'pill' }, byId(S.campaigns, p.campaign_id).name),
        p.product_ids.map((id) => byId(S.products, id) && h('span', { class: 'pill' }, byId(S.products, id).name)),
        p.tool_ids.map((id) => byId(S.tools, id) && h('span', { class: 'pill' }, byId(S.tools, id).name))),
      canEdit() && h('select', {
        'aria-label': 'تغيير المرحلة',
        onchange: (e) => changeStatus(p, e.target.value),
      }, Object.entries(STATUSES).map(([k, v]) => opt(k, v, p.status))));
      col.append(card);
    }
    if (!items.length) col.append(h('div', { class: 'muted small', style: { padding: '8px' } }, 'فاضي'));
    board.append(col);
  }
  root.append(board);
}

async function changeStatus(p, status) {
  if (status === 'published') return openPublish(p);
  await guard(async () => {
    await api(`posts/${p.id}`, { method: 'PATCH', body: { status } });
    toast(`انتقل إلى: ${STATUSES[status]}`);
    await refresh();
  })();
}

// ---------------------------------------------------------------- post modal

const modal = () => document.getElementById('modal');

function field(label, input, full = false) {
  return h('label', { class: 'field' + (full ? ' full' : '') }, h('span', {}, label), input);
}
function checks(name, list, selected, statusOk) {
  const items = list.filter((x) => statusOk(x) || selected.includes(x.id));
  if (!items.length) return h('span', { class: 'muted small' }, 'ما فيه عناصر. أضفها من الإعدادات.');
  return h('div', { class: 'checks' }, items.map((x) => h('label', {},
    h('input', { type: 'checkbox', name, value: x.id, checked: selected.includes(x.id) }), x.name)));
}

function openPost(post, day) {
  const p = post || {
    title: '', caption: '', platform: S.filters.platform || 'instagram', format: '', status: 'idea',
    planned_at: day ? `${day}T19:00` : null, campaign_id: S.filters.campaign ? Number(S.filters.campaign) : null,
    owner_email: S.me.email, product_ids: [], tool_ids: [], asset_url: '', post_url: '', notes: '', published_at: null,
  };
  const ro = !canEdit();
  const formatSel = h('select', { name: 'format', required: true });
  const fillFormats = (platform, current) => {
    formatSel.replaceChildren(...PLATFORMS[platform].formats.map((f) => opt(f, FORMATS[f], current)));
  };
  fillFormats(p.platform, p.format);
  const platformSel = h('select', { name: 'platform', onchange: (e) => fillFormats(e.target.value, formatSel.value) },
    Object.entries(PLATFORMS).map(([k, v]) => opt(k, v.label, p.platform)));
  const statusSel = h('select', { name: 'status' }, Object.entries(STATUSES).map(([k, v]) => opt(k, v, p.status)));
  const pubFields = h('div', { class: 'field full', style: { display: 'contents' } },
    field('تاريخ النشر الفعلي', h('input', { type: 'datetime-local', name: 'published_at', value: p.published_at || '' })),
    field('رابط المنشور', h('input', { type: 'url', name: 'post_url', value: p.post_url || '', placeholder: 'https://', dir: 'ltr' })));
  const togglePub = () => { pubFields.style.display = statusSel.value === 'published' ? 'contents' : 'none'; };
  statusSel.addEventListener('change', togglePub);
  togglePub();

  const form = h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); save(); } },
    h('header', {},
      h('h2', {}, post ? (ro ? 'تفاصيل المنشور' : 'تعديل منشور') : 'منشور جديد'),
      h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'إغلاق', onclick: () => modal().close() }, '✕')),
    h('div', { class: 'scroll' }, h('fieldset', { class: 'body', disabled: ro, style: { border: 0, margin: 0 } },
      field('العنوان / الفكرة', h('input', { name: 'title', required: true, value: p.title, maxlength: 300 }), true),
      field('المنصة', platformSel),
      field('الصيغة', formatSel),
      field('الموعد المخطط', h('input', { type: 'datetime-local', name: 'planned_at', value: p.planned_at || '' })),
      field('المرحلة', statusSel),
      field('الحملة', h('select', { name: 'campaign_id' }, opt('', '— بدون حملة —', p.campaign_id),
        S.campaigns.filter((c) => c.status !== 'archived' || c.id === p.campaign_id).map((c) => opt(c.id, c.name, p.campaign_id)))),
      field('المسؤول', h('select', { name: 'owner_email' }, opt('', '—', p.owner_email),
        S.team.filter((m) => m.active || m.email === p.owner_email).map((m) => opt(m.email, m.name, p.owner_email)))),
      field('المحاصيل', checks('product_ids', S.products, p.product_ids, (x) => x.status === 'available'), true),
      field('أدوات التحضير', checks('tool_ids', S.tools, p.tool_ids, (x) => x.status === 'active'), true),
      field('الكابشن', h('textarea', { name: 'caption', rows: 4 }, p.caption || ''), true),
      field('رابط الملفات (Drive / Dropbox…)', h('input', { type: 'url', name: 'asset_url', value: p.asset_url || '', placeholder: 'https://', dir: 'ltr' }), true),
      pubFields,
      field('ملاحظات', h('textarea', { name: 'notes', rows: 2 }, p.notes || ''), true),
      post && h('div', { class: 'field full muted small' }, `أضافه ${memberName(post.created_by)} · ${post.created_at}`))),
    h('footer', {},
      !ro && h('button', { class: 'btn primary', type: 'submit' }, 'حفظ'),
      !ro && post && post.status !== 'published' && h('button', { class: 'btn', type: 'button', onclick: () => { modal().close(); openPublish(post); } }, '✓ تم النشر'),
      h('span', { class: 'spacer' }),
      !ro && post && h('button', { class: 'btn danger', type: 'button', onclick: del }, 'حذف'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => modal().close() }, 'إلغاء')));

  async function save() {
    const fd = new FormData(form);
    const body = {
      title: fd.get('title'), caption: fd.get('caption'), platform: fd.get('platform'), format: fd.get('format'),
      planned_at: fd.get('planned_at') || null, status: fd.get('status'),
      campaign_id: fd.get('campaign_id') ? Number(fd.get('campaign_id')) : null,
      owner_email: fd.get('owner_email') || null, asset_url: fd.get('asset_url') || null, notes: fd.get('notes'),
      product_ids: fd.getAll('product_ids').map(Number), tool_ids: fd.getAll('tool_ids').map(Number),
      published_at: fd.get('status') === 'published' ? fd.get('published_at') || null : null,
      post_url: fd.get('post_url') || null,
    };
    await guard(async () => {
      await api(post ? `posts/${post.id}` : 'posts', { method: post ? 'PUT' : 'POST', body });
      modal().close();
      toast('تم الحفظ');
      await refresh();
    })();
  }
  async function del() {
    if (!confirm(`حذف «${post.title}»؟ ما يمكن التراجع.`)) return;
    await guard(async () => {
      await api(`posts/${post.id}`, { method: 'DELETE' });
      modal().close();
      toast('تم الحذف');
      await refresh();
    })();
  }

  modal().replaceChildren(form);
  modal().showModal();
}

function openPublish(p) {
  const form = h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); go(); } },
    h('header', {}, h('h2', {}, `تم نشر «${p.title}»`),
      h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'إغلاق', onclick: () => modal().close() }, '✕')),
    h('div', { class: 'body' },
      field('تاريخ ووقت النشر', h('input', { type: 'datetime-local', name: 'published_at', required: true, value: p.published_at || nowLocal() })),
      field('رابط المنشور', h('input', { type: 'url', name: 'post_url', value: p.post_url || '', placeholder: 'https://', dir: 'ltr' })),
      h('p', { class: 'field full muted small' }, 'بعد الحفظ ينحسب المنشور في التقارير لكل حملة ومحصول وأداة مربوطة فيه.')),
    h('footer', {}, h('button', { class: 'btn primary', type: 'submit' }, 'تأكيد النشر'),
      h('span', { class: 'spacer' }), h('button', { class: 'btn ghost', type: 'button', onclick: () => { modal().close(); render(); } }, 'إلغاء')));
  async function go() {
    const fd = new FormData(form);
    await guard(async () => {
      await api(`posts/${p.id}`, { method: 'PATCH', body: { status: 'published', published_at: fd.get('published_at'), post_url: fd.get('post_url') || null } });
      modal().close();
      toast('تم تسجيله كمنشور ✓');
      await refresh();
    })();
  }
  modal().replaceChildren(form);
  modal().showModal();
}

// ---------------------------------------------------------------- reports

function presetRange(preset) {
  const t = parseDay(S.today);
  const y = t.getFullYear(); const m = t.getMonth();
  switch (preset) {
    case 'this_month': return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    case 'last_month': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case 'last_30': return [iso(addDays(t, -29)), iso(t)];
    case 'this_quarter': { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))]; }
    case 'this_year': return [`${y}-01-01`, `${y}-12-31`];
    case 'all': return ['', ''];
    default: return [S.rep.from, S.rep.to];
  }
}

async function loadReports() {
  if (S.rep.preset !== 'custom') [S.rep.from, S.rep.to] = presetRange(S.rep.preset);
  const q = new URLSearchParams();
  if (S.rep.from) q.set('from', S.rep.from);
  if (S.rep.to) q.set('to', S.rep.to);
  if (S.rep.platform) q.set('platform', S.rep.platform);
  S.rep.data = await api('reports?' + q);
}

function bars(rows, { color, empty = 'ما فيه بيانات' } = {}) {
  if (!rows.length) return h('div', { class: 'muted small' }, empty);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar' + (r.count ? '' : ' zero') },
    h('span', { class: 'name', title: r.name }, r.name),
    h('span', { class: 'track' }, h('span', { class: 'fill', style: { width: `${(r.count / max) * 100}%`, '--c': r.color || color || 'var(--accent)' } })),
    h('span', { class: 'n' }, r.count))));
}

function reportCSV(r) {
  const rows = [['القسم', 'الاسم', 'عدد المنشورات المنشورة']];
  const range = `${r.range.from || 'البداية'} → ${r.range.to || 'اليوم'}${r.range.platform ? ' · ' + PLATFORMS[r.range.platform].label : ''}`;
  rows.push(['الفترة', range, r.totals.published]);
  r.byCampaign.forEach((x) => rows.push(['حملة', x.name, x.count]));
  if (r.noCampaign) rows.push(['حملة', 'بدون حملة', r.noCampaign]);
  r.byProduct.forEach((x) => rows.push(['محصول', x.name, x.count]));
  r.byTool.forEach((x) => rows.push(['أداة', x.name, x.count]));
  r.byPlatform.forEach((x) => {
    rows.push(['منصة', x.name, x.count]);
    x.formats.forEach((f) => rows.push(['صيغة', `${x.name} / ${FORMATS[f.format]}`, f.count]));
  });
  r.byOwner.forEach((x) => rows.push(['مسؤول', x.name, x.count]));
  return toCSV(rows);
}

function postsCSV(r) {
  const name = (list, id) => byId(list, id)?.name || '';
  return toCSV([
    ['تاريخ النشر', 'العنوان', 'المنصة', 'الصيغة', 'الحملة', 'المحاصيل', 'الأدوات', 'المسؤول', 'الرابط'],
    ...r.published.map((p) => [
      fmtDT(p.published_at), p.title, PLATFORMS[p.platform].label, FORMATS[p.format] || p.format, name(S.campaigns, p.campaign_id),
      p.product_ids.map((id) => name(S.products, id)).join(' | '), p.tool_ids.map((id) => name(S.tools, id)).join(' | '),
      memberName(p.owner_email), p.post_url || '',
    ]),
  ]);
}

function renderReports(root) {
  const r = S.rep.data;
  const reload = guard(async () => { await loadReports(); render(); });
  const presets = { this_month: 'هالشهر', last_month: 'الشهر الماضي', last_30: 'آخر 30 يوم', this_quarter: 'هالربع', this_year: 'هالسنة', all: 'كل الوقت', custom: 'مخصص' };

  root.append(h('div', { class: 'toolbar' },
    h('h2', {}, 'التقارير'),
    h('select', { 'aria-label': 'الفترة', onchange: (e) => { S.rep.preset = e.target.value; reload(); } },
      Object.entries(presets).map(([k, v]) => opt(k, v, S.rep.preset))),
    h('input', { type: 'date', 'aria-label': 'من', value: S.rep.from, onchange: (e) => { S.rep.preset = 'custom'; S.rep.from = e.target.value; reload(); } }),
    h('span', { class: 'muted' }, '←'),
    h('input', { type: 'date', 'aria-label': 'إلى', value: S.rep.to, onchange: (e) => { S.rep.preset = 'custom'; S.rep.to = e.target.value; reload(); } }),
    h('select', { 'aria-label': 'المنصة', onchange: (e) => { S.rep.platform = e.target.value; reload(); } },
      opt('', 'كل المنصات', S.rep.platform), Object.entries(PLATFORMS).map(([k, v]) => opt(k, v.label, S.rep.platform))),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: () => download(`report-${S.rep.from || 'all'}_${S.rep.to || S.today}.csv`, reportCSV(r)) }, '⬇ ملخص CSV'),
    h('button', { class: 'btn', onclick: () => download(`published-posts-${S.rep.from || 'all'}_${S.rep.to || S.today}.csv`, postsCSV(r)) }, '⬇ المنشورات CSV'),
  ));

  root.append(h('div', { class: 'kpis' },
    [[r.totals.published, 'منشور فعلًا'], [r.totals.planned, 'مخطط في الفترة'], [`${r.totals.completion}%`, 'نسبة الإنجاز'],
      [r.totals.overdue, 'متأخر عن موعده'], [r.byCampaign.filter((c) => c.count).length, 'حملات نشرت لها']]
      .map(([v, l]) => h('div', { class: 'card kpi' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l)))));

  const section = (title, extra, ...body) => h('div', { class: 'card section' }, h('h3', {}, h('span', {}, title), extra && h('span', { class: 'muted small' }, extra)), ...body);

  root.append(h('div', { class: 'grid2' },
    section('لكل حملة', r.noCampaign ? `+ ${r.noCampaign} بدون حملة` : null, bars(r.byCampaign)),
    section('لكل محصول', r.noProduct ? `${r.noProduct} منشور بدون محصول` : null, bars(r.byProduct, { color: '#8b4a25' })),
    section('لكل أداة تحضير', r.noTool ? `${r.noTool} منشور بدون أداة` : null, bars(r.byTool, { color: '#2f6f5e' })),
    section('لكل منصة وصيغة', null, h('div', { class: 'bars' }, r.byPlatform.map((p) => [
      bars([{ name: p.name, count: p.count, color: `var(--${PLATFORMS[p.platform].short.toLowerCase()})` }]),
      h('div', { class: 'sub' }, bars(p.formats.map((f) => ({ name: FORMATS[f.format], count: f.count })), { color: 'var(--muted)' })),
    ]))),
    section('إنجاز الحملات', 'منشور / مخطط', r.campaignProgress.length
      ? h('div', { class: 'bars progress' }, r.campaignProgress.map((c) => h('div', { class: 'bar' },
        h('span', { class: 'name' }, c.name),
        h('span', { class: 'track' }, h('span', { class: 'fill', style: { width: `${c.pct}%`, '--c': c.color } })),
        h('span', { class: 'n' }, `${c.published}/${c.planned} · ${c.pct}%`))))
      : h('div', { class: 'muted small' }, 'ما فيه منشورات مخططة لحملات في هالفترة')),
    section('لكل شخص في الفريق', null, bars(r.byOwner)),
    section('تنبيهات', 'متوفر وما انذكر من 30 يوم', r.stale.length
      ? h('div', { class: 'alerts' }, r.stale.map((s) => h('div', { class: 'alert' },
        h('span', {}, s.kind === 'product' ? '🫘' : '⚙️'),
        h('span', {}, h('b', {}, s.name), ' — ', s.last ? `آخر نشر قبل ${s.days} يوم` : 'ما انذكر أبدًا'))))
      : h('div', { class: 'muted small' }, 'كل المحاصيل والأدوات المتوفرة انذكرت مؤخرًا 👌')),
    r.byMonth.length > 1 && section('حسب الشهر', null, bars(r.byMonth.map((m) => ({ name: m.month, count: m.count })))),
  ));

  root.append(h('div', { class: 'card section', style: { marginTop: '12px' } },
    h('h3', {}, h('span', {}, `المنشورات المنشورة (${r.published.length})`)),
    r.published.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['التاريخ', 'العنوان', 'المنصة', 'الحملة', 'المحاصيل', 'الأدوات', 'المسؤول'].map((t) => h('th', {}, t)))),
      h('tbody', {}, [...r.published].reverse().map((p) => h('tr', {},
        h('td', { style: { whiteSpace: 'nowrap' } }, fmtDT(p.published_at)),
        h('td', {}, p.post_url ? h('a', { href: p.post_url, target: '_blank', rel: 'noopener' }, p.title) : p.title),
        h('td', {}, platformBadge(p.platform), ' ', FORMATS[p.format] || p.format),
        h('td', {}, byId(S.campaigns, p.campaign_id)?.name || '—'),
        h('td', {}, p.product_ids.map((id) => byId(S.products, id)?.name).filter(Boolean).join('، ') || '—'),
        h('td', {}, p.tool_ids.map((id) => byId(S.tools, id)?.name).filter(Boolean).join('، ') || '—'),
        h('td', {}, memberName(p.owner_email))))))) : h('div', { class: 'muted small' }, 'ما فيه منشورات منشورة في هالفترة')));
}

// ---------------------------------------------------------------- settings

const LIST_DEFS = {
  campaigns: {
    label: 'الحملات', single: 'حملة', statuses: CAMPAIGN_STATUSES,
    fields: [['name', 'الاسم', 'text'], ['start_date', 'البداية', 'date'], ['end_date', 'النهاية', 'date'], ['color', 'اللون', 'color'], ['goal', 'الهدف', 'textarea']],
    cols: (x) => [h('span', {}, h('span', { class: 'swatch', style: { background: x.color } }), x.name), `${x.start_date || '—'} → ${x.end_date || '—'}`, x.goal || ''],
    heads: ['الاسم', 'الفترة', 'الهدف'],
  },
  products: {
    label: 'المحاصيل', single: 'محصول', statuses: PRODUCT_STATUSES,
    fields: [['name', 'الاسم', 'text'], ['origin', 'البلد / المنطقة', 'text'], ['process', 'المعالجة', 'text']],
    cols: (x) => [x.name, x.origin || '—', x.process || '—'], heads: ['الاسم', 'البلد', 'المعالجة'],
  },
  tools: {
    label: 'أدوات التحضير', single: 'أداة', statuses: TOOL_STATUSES,
    fields: [['name', 'الاسم', 'text'], ['category', 'الفئة', 'text']],
    cols: (x) => [x.name, x.category || '—'], heads: ['الاسم', 'الفئة'],
  },
};

function openListItem(table, item) {
  const def = LIST_DEFS[table];
  const x = item || { status: Object.keys(def.statuses)[table === 'campaigns' ? 1 : 0], color: '#8b4a25' };
  const form = h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); save(); } },
    h('header', {}, h('h2', {}, item ? `تعديل ${def.single}` : `إضافة ${def.single}`),
      h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'إغلاق', onclick: () => modal().close() }, '✕')),
    h('div', { class: 'body' },
      def.fields.map(([k, label, type]) => field(label,
        type === 'textarea' ? h('textarea', { name: k, rows: 2 }, x[k] || '') : h('input', { name: k, type, value: x[k] || '', required: k === 'name' }),
        type === 'textarea')),
      field('الحالة', h('select', { name: 'status' }, Object.entries(def.statuses).map(([k, v]) => opt(k, v, x.status))))),
    h('footer', {}, h('button', { class: 'btn primary', type: 'submit' }, 'حفظ'), h('span', { class: 'spacer' }),
      item && h('button', { class: 'btn danger', type: 'button', onclick: del }, 'حذف'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => modal().close() }, 'إلغاء')));
  async function save() {
    const body = Object.fromEntries(new FormData(form));
    await guard(async () => {
      await api(item ? `${table}/${item.id}` : table, { method: item ? 'PUT' : 'POST', body });
      modal().close(); toast('تم الحفظ'); await bootstrap(); render();
    })();
  }
  async function del() {
    if (!confirm(`حذف «${item.name}»؟`)) return;
    await guard(async () => {
      await api(`${table}/${item.id}`, { method: 'DELETE' });
      modal().close(); toast('تم الحذف'); await bootstrap(); render();
    })();
  }
  modal().replaceChildren(form);
  modal().showModal();
}

function openMember(m) {
  const form = h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); save(); } },
    h('header', {}, h('h2', {}, m ? 'تعديل عضو' : 'إضافة عضو'),
      h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'إغلاق', onclick: () => modal().close() }, '✕')),
    h('div', { class: 'body' },
      field('الإيميل (نفس اللي يدخل فيه)', h('input', { name: 'email', type: 'email', required: true, value: m?.email || '', readonly: !!m, dir: 'ltr' })),
      field('الاسم', h('input', { name: 'name', required: true, value: m?.name || '' })),
      field('الدور', h('select', { name: 'role' }, Object.entries(ROLES).map(([k, v]) => opt(k, v, m?.role || 'editor')))),
      field('الحالة', h('select', { name: 'active' }, opt('1', 'نشط', m ? String(m.active) : '1'), opt('0', 'موقوف', m ? String(m.active) : '1'))),
      h('p', { class: 'field full muted small' }, 'تذكير: لازم الإيميل يكون مسموح كمان في سياسة Cloudflare Access عشان يقدر يفتح الرابط.')),
    h('footer', {}, h('button', { class: 'btn primary', type: 'submit' }, 'حفظ'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => modal().close() }, 'إلغاء')));
  async function save() {
    const b = Object.fromEntries(new FormData(form));
    await guard(async () => {
      await api(m ? `team/${encodeURIComponent(m.email)}` : 'team', { method: m ? 'PUT' : 'POST', body: { ...b, active: b.active === '1' } });
      modal().close(); toast('تم الحفظ'); await bootstrap(); render();
    })();
  }
  modal().replaceChildren(form);
  modal().showModal();
}

async function renderSettings(root) {
  const tabs = { campaigns: 'الحملات', products: 'المحاصيل', tools: 'أدوات التحضير', team: 'الفريق', activity: 'سجل التعديلات' };
  root.append(h('div', { class: 'toolbar' }, h('h2', {}, 'الإعدادات'),
    !isAdmin() && h('span', { class: 'muted small' }, 'التعديل هنا للمدير فقط')));
  root.append(h('div', { class: 'subtabs' }, Object.entries(tabs).map(([k, v]) =>
    h('button', { class: 'btn' + (S.settingsTab === k ? ' primary' : ''), onclick: () => { S.settingsTab = k; render(); } }, v))));

  const card = h('div', { class: 'card section' });
  root.append(card);
  const t = S.settingsTab;

  if (LIST_DEFS[t]) {
    const def = LIST_DEFS[t];
    const rows = S[t];
    card.append(h('h3', {}, h('span', {}, `${def.label} (${rows.length})`),
      isAdmin() && h('button', { class: 'btn primary', onclick: () => openListItem(t, null) }, '+ إضافة')));
    card.append(rows.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, [...def.heads, 'الحالة', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((x) => h('tr', {},
        def.cols(x).map((c) => h('td', {}, c)),
        h('td', {}, h('span', { class: 'pill' }, def.statuses[x.status])),
        h('td', {}, isAdmin() && h('button', { class: 'btn ghost small', onclick: () => openListItem(t, x) }, 'تعديل'))))))) : h('div', { class: 'empty' }, 'لسه ما أضفت شي'));
  } else if (t === 'team') {
    card.append(h('h3', {}, h('span', {}, `الفريق (${S.team.length})`),
      isAdmin() && h('button', { class: 'btn primary', onclick: () => openMember(null) }, '+ إضافة عضو')));
    card.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['الاسم', 'الإيميل', 'الدور', 'الحالة', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, S.team.map((m) => h('tr', {},
        h('td', {}, m.name), h('td', { dir: 'ltr', style: { textAlign: 'end' } }, m.email), h('td', {}, ROLES[m.role]),
        h('td', {}, h('span', { class: 'pill' }, m.active ? 'نشط' : 'موقوف')),
        h('td', {}, isAdmin() && h('button', { class: 'btn ghost small', onclick: () => openMember(m) }, 'تعديل'))))))));
  } else {
    card.append(h('h3', {}, h('span', {}, 'آخر التعديلات')));
    const log = await api('activity?limit=200');
    const labels = { create: 'أضاف', update: 'عدّل', delete: 'حذف', upsert: 'حدّث', deactivate: 'أوقف' };
    const entity = { post: 'منشور', campaigns: 'حملة', products: 'محصول', tools: 'أداة', team: 'عضو' };
    card.append(log.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['الوقت (UTC)', 'مين', 'وش سوى', 'على', 'تفاصيل'].map((x) => h('th', {}, x)))),
      h('tbody', {}, log.map((l) => {
        let d = {}; try { d = JSON.parse(l.details || '{}'); } catch { /* ignore */ }
        const act = l.action.startsWith('status:') ? `نقل إلى ${STATUSES[l.action.slice(7)] || l.action.slice(7)}` : labels[l.action] || l.action;
        return h('tr', {}, h('td', { style: { whiteSpace: 'nowrap' } }, l.at), h('td', {}, memberName(l.actor)), h('td', {}, act),
          h('td', {}, `${entity[l.entity] || l.entity} #${l.entity_id ?? ''}`), h('td', { class: 'muted small' }, d.title || d.name || ''));
      })))) : h('div', { class: 'empty' }, 'ما فيه تعديلات بعد'));
  }
}

// ---------------------------------------------------------------- app shell

async function bootstrap() {
  const b = await api('bootstrap');
  Object.assign(S, { me: b.me, campaigns: b.campaigns, products: b.products, tools: b.tools, team: b.team, today: b.today });
}

async function refresh() {
  if (S.view === 'calendar') await loadCalendar();
  if (S.view === 'board') await loadBoard();
  if (S.view === 'reports') await loadReports();
  render();
}

function render() {
  const root = document.getElementById('app');
  root.replaceChildren();
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.view === S.view));
  const views = { calendar: renderCalendar, board: renderBoard, reports: renderReports, settings: renderSettings };
  const p = views[S.view](root);
  if (p instanceof Promise) p.catch((e) => toast(e.message, true));
}

async function route() {
  const v = location.hash.slice(1);
  S.view = ['calendar', 'board', 'reports', 'settings'].includes(v) ? v : 'calendar';
  try { await refresh(); } catch (e) { toast(e.message, true); }
}

async function start() {
  try {
    await bootstrap();
  } catch (e) {
    document.getElementById('app').replaceChildren(h('div', { class: 'card empty' },
      h('h2', {}, 'ما قدرنا ندخلك'), h('p', {}, e.message)));
    return;
  }
  S.cal.cursor = parseDay(S.today);
  document.getElementById('me').replaceChildren(h('b', {}, S.me.name), ' · ', ROLES[S.me.role]);
  window.addEventListener('hashchange', route);
  await route();
}

start();
