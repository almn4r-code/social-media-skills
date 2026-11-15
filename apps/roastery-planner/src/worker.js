// Single-file Pages "advanced mode" worker: serves the inlined static UI and
// the /api/* routes. Used by scripts/deploy.mjs (direct API deploy without the
// asset-upload step). Local dev keeps using functions/ + public/.
import { handle } from './api.js';
import { ASSETS } from './assets.generated.js';

const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handle(request, env);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const body = ASSETS[path];
    if (body === undefined) return new Response('Not found', { status: 404 });
    const ext = path.split('.').pop();
    return new Response(body, {
      headers: {
        'content-type': TYPES[ext] || 'application/octet-stream',
        'cache-control': ext === 'html' ? 'no-cache' : 'public, max-age=300',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
      },
    });
  },
};
