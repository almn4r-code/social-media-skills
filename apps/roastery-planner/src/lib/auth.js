// Identifies the caller.
//
// Production: Cloudflare Access sits in front of the site and adds a signed
// JWT (Cf-Access-Jwt-Assertion). We verify it against the team's public keys,
// so the email can't be spoofed even if someone reaches the origin directly.
//
// Local dev: set DEV_USER_EMAIL in .dev.vars (never deployed).
//
// If neither is configured we refuse every request (fail closed).

let cachedKeys = null;
let cachedAt = 0;

const b64urlToBytes = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const b64urlToJSON = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function accessKeys(teamDomain) {
  if (cachedKeys && Date.now() - cachedAt < 3600_000) return cachedKeys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Could not fetch Access certs');
  cachedKeys = (await res.json()).keys || [];
  cachedAt = Date.now();
  return cachedKeys;
}

async function verifyAccessJwt(token, env) {
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  const header = b64urlToJSON(h);
  const payload = b64urlToJSON(p);
  const jwk = (await accessKeys(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return payload.email ? String(payload.email).toLowerCase() : null;
}

/** Returns the caller's email, or null. */
export async function callerEmail(request, env) {
  if (env.ACCESS_AUD && env.ACCESS_TEAM_DOMAIN) {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) return null;
    try {
      return await verifyAccessJwt(token, env);
    } catch {
      return null;
    }
  }
  if (env.DEV_USER_EMAIL) {
    // Dev only: allow overriding the user per request to test roles.
    return (request.headers.get('X-Dev-User') || env.DEV_USER_EMAIL).toLowerCase();
  }
  return null;
}

/** Emails in ADMIN_EMAILS (comma-separated) are always admins — used to bootstrap. */
export function bootstrapAdmins(env) {
  return String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
