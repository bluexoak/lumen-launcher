// "/" → /de/ or /en/: the visitor's saved choice (lang cookie from the switcher) first, else the browser's
// Accept-Language, else English. Every other path is served from the static assets.
const LANGS = ['de', 'en'];
const CANONICAL = 'lumenlauncher.app';
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export function pickLang(cookie = '', accept = '') {
  const saved = /(?:^|;\s*)lang=(de|en)(?:;|$)/.exec(cookie)?.[1];
  if (saved) return saved;
  const prefs = accept.split(',')
    .map(part => { const [tag, ...params] = part.trim().split(';'); const q = params.find(p => p.trim().startsWith('q=')); return { lang: tag.slice(0, 2).toLowerCase(), q: q ? parseFloat(q.split('=')[1]) : 1 }; })
    .filter(p => p.lang && p.q > 0)
    .sort((a, b) => b.q - a.q);
  return prefs.find(p => LANGS.includes(p.lang))?.lang || 'en';
}

// the site loads nothing from other origins and has no inline scripts, so the policy can be this strict
// (inline style attributes remain for the colour swatches)
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
// /download/setup and /download/zip always point at the newest GitHub release, so the site never needs a version bump.
// The release lookup is cached at the edge for 10 minutes (GitHub allows only 60 anonymous API calls per hour per IP).
const REPO = 'bluexoak/lumen-launcher';
const DOWNLOADS = { setup: /^Lumen-Setup-.+\.exe$/, zip: /^Lumen-.+-win-x64\.zip$/ };
async function latestAsset(kind, ctx) {
  const key = new Request(`https://${CANONICAL}/__latest-release`);
  let res = await caches.default.match(key);
  if (!res) {
    const gh = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': CANONICAL, Accept: 'application/vnd.github+json' } });
    if (!gh.ok) return null;
    res = new Response(gh.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' } });
    ctx.waitUntil(caches.default.put(key, res.clone()));
  }
  const release = await res.json();
  return release.assets?.find(a => DOWNLOADS[kind].test(a.name))?.browser_download_url || null;
}

const secure = res => {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // www.lumenlauncher.app and the old *.workers.dev address keep working but point to one canonical home
    if (url.hostname !== CANONICAL && !LOCAL.test(url.hostname)) {
      return secure(Response.redirect(`https://${CANONICAL}${url.pathname}${url.search}`, 301));
    }
    const dl = /^\/download\/(setup|zip)\/?$/.exec(url.pathname);
    if (dl) {
      const asset = await latestAsset(dl[1], ctx).catch(() => null);
      // if GitHub is unreachable, the release page still offers every file
      return secure(new Response(null, { status: 302, headers: { Location: asset || `https://github.com/${REPO}/releases/latest`, 'Cache-Control': 'no-store' } }));
    }
    if (url.pathname !== '/') return secure(await env.ASSETS.fetch(request));
    const lang = pickLang(request.headers.get('Cookie') || '', request.headers.get('Accept-Language') || '');
    return secure(new Response(null, {
      status: 302,
      headers: { Location: `/${lang}/${url.search}`, Vary: 'Accept-Language, Cookie', 'Cache-Control': 'private, no-store' },
    }));
  },
};
