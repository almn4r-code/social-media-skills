// Pure reporting logic. No I/O — easy to unit test.
//
// Counting rule: a post counts only when status === 'published' and its
// published_at day falls inside [from, to]. A post tagged with several
// products/tools counts once for each of them, but only once in the totals.

import { PLATFORMS, inRange, dayOf } from '../../public/lib/shared.js';

function tally(items, keysOf) {
  const counts = new Map();
  for (const item of items) {
    for (const key of keysOf(item)) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(toDay + 'T00:00:00Z') - Date.parse(fromDay + 'T00:00:00Z')) / 86400000);
}

const byCountDesc = (a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'ar');

/**
 * @param {object} data   { posts, campaigns, products, tools, team }
 *                        posts carry product_ids[] and tool_ids[]
 * @param {object} opts   { from, to, platform, today, staleDays }
 */
export function buildReport(data, opts = {}) {
  const { posts = [], campaigns = [], products = [], tools = [], team = [] } = data;
  const { from = null, to = null, platform = null, today = null, staleDays = 30 } = opts;

  const onPlatform = (p) => !platform || p.platform === platform;
  const published = posts.filter((p) => p.status === 'published' && onPlatform(p) && inRange(p.published_at, from, to));
  const plannedInRange = posts.filter((p) => p.status !== 'cancelled' && onPlatform(p) && inRange(p.planned_at, from, to));

  // --- per campaign ---
  const campaignCounts = tally(published, (p) => [p.campaign_id ?? null]);
  const byCampaign = campaigns
    .filter((c) => c.status !== 'archived' || campaignCounts.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, color: c.color, count: campaignCounts.get(c.id) || 0 }))
    .sort(byCountDesc);
  const noCampaign = campaignCounts.get(null) || 0;

  // --- per product / tool (many-to-many) ---
  const productCounts = tally(published, (p) => p.product_ids || []);
  const byProduct = products
    .filter((x) => x.status !== 'archived' || productCounts.has(x.id))
    .map((x) => ({ id: x.id, name: x.name, count: productCounts.get(x.id) || 0 }))
    .sort(byCountDesc);
  const noProduct = published.filter((p) => !(p.product_ids || []).length).length;

  const toolCounts = tally(published, (p) => p.tool_ids || []);
  const byTool = tools
    .filter((x) => x.status !== 'archived' || toolCounts.has(x.id))
    .map((x) => ({ id: x.id, name: x.name, count: toolCounts.get(x.id) || 0 }))
    .sort(byCountDesc);
  const noTool = published.filter((p) => !(p.tool_ids || []).length).length;

  // --- per platform & format ---
  const byPlatform = Object.entries(PLATFORMS)
    .filter(([key]) => !platform || key === platform)
    .map(([key, meta]) => {
      const rows = published.filter((p) => p.platform === key);
      const formatCounts = tally(rows, (p) => [p.format]);
      return {
        platform: key,
        name: meta.label,
        count: rows.length,
        formats: meta.formats.map((f) => ({ format: f, count: formatCounts.get(f) || 0 })),
      };
    });

  // --- per owner ---
  const names = new Map(team.map((m) => [m.email, m.name]));
  const ownerCounts = tally(published, (p) => [p.owner_email || null]);
  const byOwner = [...ownerCounts.entries()]
    .map(([email, count]) => ({ email, name: email ? names.get(email) || email : 'بدون مسؤول', count }))
    .sort(byCountDesc);

  // --- per month ---
  const monthCounts = tally(published, (p) => [p.published_at.slice(0, 7)]);
  const byMonth = [...monthCounts.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => (a.month < b.month ? -1 : 1));

  // --- campaign progress (planned in range vs. published) ---
  const campaignProgress = campaigns
    .filter((c) => c.status !== 'archived')
    .map((c) => {
      const rows = posts.filter(
        (p) => p.campaign_id === c.id && p.status !== 'cancelled' && onPlatform(p) &&
          (inRange(p.planned_at, from, to) || (p.status === 'published' && inRange(p.published_at, from, to))),
      );
      const done = rows.filter((p) => p.status === 'published').length;
      return { id: c.id, name: c.name, color: c.color, planned: rows.length, published: done, pct: rows.length ? Math.round((done / rows.length) * 100) : 0 };
    })
    .filter((r) => r.planned > 0);

  // --- overdue: planned before today but not published ---
  const overdue = today
    ? posts.filter((p) => onPlatform(p) && !['published', 'cancelled'].includes(p.status) && dayOf(p.planned_at) && dayOf(p.planned_at) < today).length
    : 0;

  // --- stale: available products / active tools not featured recently (all time, all platforms) ---
  const stale = [];
  if (today) {
    const lastSeen = (ids, key) => {
      let last = null;
      for (const p of posts) {
        if (p.status !== 'published' || !p.published_at) continue;
        if (!(p[key] || []).includes(ids)) continue;
        const d = dayOf(p.published_at);
        if (!last || d > last) last = d;
      }
      return last;
    };
    for (const x of products.filter((x) => x.status === 'available')) {
      const last = lastSeen(x.id, 'product_ids');
      const days = last ? daysBetween(last, today) : null;
      if (days === null || days > staleDays) stale.push({ kind: 'product', id: x.id, name: x.name, last, days });
    }
    for (const x of tools.filter((x) => x.status === 'active')) {
      const last = lastSeen(x.id, 'tool_ids');
      const days = last ? daysBetween(last, today) : null;
      if (days === null || days > staleDays) stale.push({ kind: 'tool', id: x.id, name: x.name, last, days });
    }
  }

  return {
    range: { from, to, platform },
    totals: {
      published: published.length,
      planned: plannedInRange.length,
      completion: plannedInRange.length ? Math.round((plannedInRange.filter((p) => p.status === 'published').length / plannedInRange.length) * 100) : 0,
      overdue,
    },
    byCampaign, noCampaign,
    byProduct, noProduct,
    byTool, noTool,
    byPlatform, byOwner, byMonth,
    campaignProgress, stale,
    published: published.map((p) => ({
      id: p.id, title: p.title, platform: p.platform, format: p.format, published_at: p.published_at,
      campaign_id: p.campaign_id, product_ids: p.product_ids || [], tool_ids: p.tool_ids || [],
      owner_email: p.owner_email, post_url: p.post_url,
    })),
  };
}
