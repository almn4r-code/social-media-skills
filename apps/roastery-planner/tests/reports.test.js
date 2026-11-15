import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/lib/reports.js';
import { toCSV, inRange, isValidFormat } from '../public/lib/shared.js';

const campaigns = [
  { id: 1, name: 'إطلاق', color: '#111', status: 'active' },
  { id: 2, name: 'V60', color: '#222', status: 'active' },
  { id: 3, name: 'قديمة', color: '#333', status: 'archived' },
];
const products = [
  { id: 10, name: 'قوجي', status: 'available' },
  { id: 11, name: 'هويلا', status: 'available' },
  { id: 12, name: 'نيري', status: 'sold_out' },
];
const tools = [
  { id: 20, name: 'V60', status: 'active' },
  { id: 21, name: 'كيمكس', status: 'active' },
];
const team = [{ email: 'a@x.com', name: 'أحمد' }];

const post = (o) => ({ product_ids: [], tool_ids: [], format: 'reel', platform: 'instagram', ...o });
const posts = [
  post({ id: 1, campaign_id: 1, status: 'published', planned_at: '2026-11-02T19:00', published_at: '2026-11-02T19:05', product_ids: [10], owner_email: 'a@x.com' }),
  post({ id: 2, campaign_id: 1, status: 'published', planned_at: '2026-11-03T19:00', published_at: '2026-11-03T20:00', product_ids: [10, 11], tool_ids: [20], format: 'story' }),
  post({ id: 3, campaign_id: 2, status: 'published', platform: 'tiktok', format: 'video', planned_at: '2026-11-05T21:00', published_at: '2026-11-05T21:00', tool_ids: [20, 21] }),
  post({ id: 4, campaign_id: null, status: 'published', platform: 'snapchat', format: 'story', planned_at: '2026-10-20T10:00', published_at: '2026-10-20T10:00' }),
  post({ id: 5, campaign_id: 2, status: 'review', planned_at: '2026-11-12T19:00', product_ids: [11] }),
  post({ id: 6, campaign_id: 1, status: 'cancelled', planned_at: '2026-11-04T19:00', product_ids: [10] }),
  post({ id: 7, campaign_id: 2, status: 'design', planned_at: '2026-11-08T19:00' }),
];
const data = { posts, campaigns, products, tools, team };
const nov = { from: '2026-11-01', to: '2026-11-30', today: '2026-11-10' };
const find = (rows, id) => rows.find((r) => r.id === id);

test('counts only published posts inside the range', () => {
  const r = buildReport(data, nov);
  assert.equal(r.totals.published, 3); // #4 is October, #5/#7 not published, #6 cancelled
});

test('per campaign, including the no-campaign bucket', () => {
  const r = buildReport(data, nov);
  assert.equal(find(r.byCampaign, 1).count, 2);
  assert.equal(find(r.byCampaign, 2).count, 1);
  assert.equal(find(r.byCampaign, 3), undefined, 'archived campaign with no posts is hidden');
  assert.equal(r.noCampaign, 0);
  assert.equal(buildReport(data, {}).noCampaign, 1);
});

test('multi-product posts count once per product, once in totals', () => {
  const r = buildReport(data, nov);
  assert.equal(find(r.byProduct, 10).count, 2);
  assert.equal(find(r.byProduct, 11).count, 1);
  assert.equal(find(r.byProduct, 12).count, 0, 'sold-out product still listed with zero');
  assert.equal(r.noProduct, 1);
  assert.equal(r.totals.published, 3);
});

test('per tool', () => {
  const r = buildReport(data, nov);
  assert.equal(find(r.byTool, 20).count, 2);
  assert.equal(find(r.byTool, 21).count, 1);
  assert.equal(r.noTool, 1);
});

test('per platform and format', () => {
  const r = buildReport(data, nov);
  const ig = r.byPlatform.find((p) => p.platform === 'instagram');
  assert.equal(ig.count, 2);
  assert.equal(ig.formats.find((f) => f.format === 'reel').count, 1);
  assert.equal(ig.formats.find((f) => f.format === 'story').count, 1);
  assert.equal(r.byPlatform.find((p) => p.platform === 'snapchat').count, 0);
});

test('platform filter narrows everything', () => {
  const r = buildReport(data, { ...nov, platform: 'tiktok' });
  assert.equal(r.totals.published, 1);
  assert.equal(find(r.byCampaign, 1).count, 0);
  assert.equal(r.byPlatform.length, 1);
});

test('per owner falls back to a label for unassigned posts', () => {
  const r = buildReport(data, nov);
  assert.equal(r.byOwner.find((o) => o.email === 'a@x.com').name, 'أحمد');
  assert.equal(r.byOwner.find((o) => o.email === null).count, 2);
});

test('campaign progress excludes cancelled posts', () => {
  const r = buildReport(data, nov);
  const c1 = find(r.campaignProgress, 1);
  assert.deepEqual([c1.planned, c1.published, c1.pct], [2, 2, 100]);
  const c2 = find(r.campaignProgress, 2);
  assert.deepEqual([c2.planned, c2.published, c2.pct], [3, 1, 33]);
});

test('overdue counts unpublished posts planned before today', () => {
  const r = buildReport(data, nov);
  assert.equal(r.totals.overdue, 1); // #7 planned 11-08, still in design; #5 is 11-12
});

test('stale lists available products / active tools not featured within staleDays', () => {
  const r = buildReport(data, { ...nov, today: '2026-12-20' });
  const names = r.stale.map((s) => s.name).sort();
  assert.deepEqual(names, ['V60', 'كيمكس', 'قوجي', 'هويلا'].sort());
  assert.ok(!names.includes('نيري'), 'sold-out products are not flagged');
  assert.equal(buildReport(data, nov).stale.length, 0);
});

test('helpers', () => {
  assert.ok(inRange('2026-11-30T23:59', '2026-11-01', '2026-11-30'));
  assert.ok(!inRange(null, null, null));
  assert.ok(isValidFormat('snapchat', 'spotlight'));
  assert.ok(!isValidFormat('snapchat', 'reel'));
  assert.equal(toCSV([['a', 'b,c'], ['"x"', null]]), '﻿a,"b,c"\r\n"""x""",');
});
