// Shared constants and helpers — imported by the browser (as an ES module)
// and by the API / tests on the server side.

export const PLATFORMS = {
  instagram: { label: 'إنستغرام', short: 'IG', formats: ['post', 'reel', 'story', 'carousel'] },
  tiktok:    { label: 'تيك توك',  short: 'TT', formats: ['video', 'story', 'live'] },
  snapchat:  { label: 'سناب شات', short: 'SC', formats: ['story', 'spotlight'] },
};

export const FORMATS = {
  post: 'منشور',
  reel: 'ريل',
  story: 'ستوري',
  carousel: 'كاروسيل',
  video: 'فيديو',
  live: 'لايف',
  spotlight: 'سبوتلايت',
};

// Ordered pipeline. 'cancelled' sits outside the pipeline.
export const STATUSES = {
  idea:      'فكرة',
  writing:   'كتابة',
  design:    'تصميم / تصوير',
  review:    'مراجعة',
  scheduled: 'مجدول',
  published: 'منشور',
  cancelled: 'ملغي',
};

export const ROLES = { admin: 'مدير', editor: 'محرر', viewer: 'مشاهد' };

export const CAMPAIGN_STATUSES = { planned: 'مخططة', active: 'نشطة', done: 'منتهية', archived: 'مؤرشفة' };
export const PRODUCT_STATUSES  = { available: 'متوفر', sold_out: 'نفد', archived: 'مؤرشف' };
export const TOOL_STATUSES     = { active: 'نشطة', archived: 'مؤرشفة' };

export function isValidFormat(platform, format) {
  return !!PLATFORMS[platform] && PLATFORMS[platform].formats.includes(format);
}

/** 'YYYY-MM-DD…' → 'YYYY-MM-DD' (or null). */
export function dayOf(value) {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null;
}

/** Inclusive date-range check on the day part of an ISO-ish string. */
export function inRange(value, from, to) {
  const d = dayOf(value);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** Build a CSV string (UTF-8 BOM so Excel on Windows/Mac shows Arabic correctly). */
export function toCSV(rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
