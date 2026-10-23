// Microsoft account → Minecraft token: device-code login, then Xbox Live → XSTS → Minecraft services.
// Needs a user-registered Azure app (public client flows on) that Mojang has approved for the Minecraft API.
const MS = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
const UA = 'lumen-launcher/0.1 (+https://github.com/bluexoak/lumen-launcher)';
const I = require('./i18n');

class AuthError extends Error {}

async function req(url, { form, json, token } = {}) {
  const r = await fetch(url, {
    method: form || json ? 'POST' : 'GET',
    headers: {
      'User-Agent': UA, Accept: 'application/json',
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form ? new URLSearchParams(form) : json ? JSON.stringify(json) : undefined,
  });
  const text = await r.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  return { status: r.status, ok: r.ok, body, text };
}

// Azure errors come back as AADSTS codes inside error_description
function msError(b) {
  const d = b.error_description || '';
  if (/AADSTS700016/.test(d)) return new AuthError(I.t('auth.client_unknown'));
  if (/AADSTS7000218|AADSTS70002/.test(d)) return new AuthError(I.t('auth.public_flows'));
  if (/AADSTS9002346|AADSTS50020/.test(d)) return new AuthError(I.t('auth.account_type'));
  if (b.error === 'expired_token') return new AuthError(I.t('auth.expired'));
  if (b.error === 'authorization_declined') return new AuthError(I.t('auth.declined'));
  if (b.error === 'invalid_grant') return new AuthError(I.t('auth.relogin'));
  return new AuthError(I.t('auth.failed', { detail: d.split('\r\n')[0] || b.error || I.t('auth.unknown') }));
}

const XERR = { 2148916233: 'auth.no_xbox', 2148916235: 'auth.country', 2148916236: 'auth.age', 2148916237: 'auth.age', 2148916238: 'auth.child' };

// started from the UI; resolves once the user entered the code (or rejects on expiry / cancel)
async function startDeviceLogin(clientId) {
  const r = await req(`${MS}/devicecode`, { form: { client_id: clientId, scope: SCOPE } });
  if (!r.ok) throw msError(r.body);
  const { device_code, user_code, verification_uri, expires_in, interval = 5 } = r.body;
  let cancelled = false;
  const done = (async () => {
    let wait = interval * 1000;
    const until = Date.now() + expires_in * 1000;
    while (!cancelled && Date.now() < until) {
      await new Promise(res => setTimeout(res, wait));
      if (cancelled) break;
      const t = await req(`${MS}/token`, { form: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code } });
      if (t.ok) return minecraftLogin(t.body);
      if (t.body.error === 'authorization_pending') continue;
      if (t.body.error === 'slow_down') { wait += 5000; continue; }
      throw msError(t.body);
    }
    throw new AuthError(I.t(cancelled ? 'auth.cancelled' : 'auth.expired'));
  })();
  return { userCode: user_code, uri: verification_uri, done, cancel: () => { cancelled = true; } };
}

// silent login with the stored refresh token (Microsoft rotates it, so the result carries a new one)
async function refreshLogin(clientId, refreshToken) {
  const t = await req(`${MS}/token`, { form: { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, scope: SCOPE } });
  if (!t.ok) throw msError(t.body);
  return minecraftLogin(t.body);
}

async function minecraftLogin(ms) {
  const xbl = await req('https://user.auth.xboxlive.com/user/authenticate', {
    json: { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${ms.access_token}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' },
  });
  if (!xbl.ok) throw new AuthError(I.t('auth.xbl', { status: xbl.status }));
  const uhs = xbl.body.DisplayClaims?.xui?.[0]?.uhs;

  const xsts = await req('https://xsts.auth.xboxlive.com/xsts/authorize', {
    json: { Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.body.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' },
  });
  if (!xsts.ok) throw new AuthError(I.t(XERR[xsts.body.XErr] || 'auth.xsts', { status: xsts.status }));

  const mc = await req('https://api.minecraftservices.com/authentication/login_with_xbox', { json: { identityToken: `XBL3.0 x=${uhs};${xsts.body.Token}` } });
  if (mc.status === 403 || /Invalid app registration/i.test(mc.text))
    throw new AuthError(I.t('auth.not_approved'));
  if (!mc.ok) throw new AuthError(I.t('auth.mc', { status: mc.status }));
  const token = mc.body.access_token;

  const prof = await req('https://api.minecraftservices.com/minecraft/profile', { token });
  if (prof.status === 404) throw new AuthError(I.t('auth.no_game'));
  if (!prof.ok) throw new AuthError(I.t('auth.profile', { status: prof.status }));

  return {
    refreshToken: ms.refresh_token,
    mc: { token, expiresAt: Date.now() + (mc.body.expires_in - 60) * 1000, name: prof.body.name, uuid: prof.body.id, xuid: xsts.body.DisplayClaims?.xui?.[0]?.xid || '' },
  };
}

module.exports = { startDeviceLogin, refreshLogin, AuthError };

if (require.main === module) { // node auth.js → self-check against a fake Microsoft/Xbox/Mojang
  const assert = require('assert');
  const routes = {};
  global.fetch = async (url, o) => {
    const key = url.split('?')[0], body = o.body ? (o.body instanceof URLSearchParams ? Object.fromEntries(o.body) : JSON.parse(o.body)) : null;
    const [status, res] = routes[key](body, o.headers);
    return { status, ok: status < 300, text: async () => JSON.stringify(res) };
  };
  const happy = () => {
    routes[`${MS}/token`] = b => (b.refresh_token === 'r1' ? [200, { access_token: 'ms', refresh_token: 'r2' }] : [400, { error: 'invalid_grant' }]);
    routes['https://user.auth.xboxlive.com/user/authenticate'] = b => (assert.equal(b.Properties.RpsTicket, 'd=ms'), [200, { Token: 'xbl', DisplayClaims: { xui: [{ uhs: 'U' }] } }]);
    routes['https://xsts.auth.xboxlive.com/xsts/authorize'] = b => (assert.deepEqual(b.Properties.UserTokens, ['xbl']), [200, { Token: 'xsts', DisplayClaims: { xui: [{ uhs: 'U', xid: '42' }] } }]);
    routes['https://api.minecraftservices.com/authentication/login_with_xbox'] = b => (assert.equal(b.identityToken, 'XBL3.0 x=U;xsts'), [200, { access_token: 'mc', expires_in: 86400 }]);
    routes['https://api.minecraftservices.com/minecraft/profile'] = (_, h) => (assert.equal(h.Authorization, 'Bearer mc'), [200, { id: 'abc', name: 'Steve' }]);
  };
  (async () => {
    happy();
    const r = await refreshLogin('cid', 'r1');
    assert.equal(r.refreshToken, 'r2');
    assert.deepEqual({ ...r.mc, expiresAt: 0 }, { token: 'mc', expiresAt: 0, name: 'Steve', uuid: 'abc', xuid: '42' });
    await assert.rejects(refreshLogin('cid', 'bad'), /abgelaufen/);
    routes['https://api.minecraftservices.com/authentication/login_with_xbox'] = () => [403, { errorMessage: 'Invalid app registration' }];
    await assert.rejects(refreshLogin('cid', 'r1'), /nicht für die Minecraft-API freigeschaltet/);
    happy();
    routes['https://xsts.auth.xboxlive.com/xsts/authorize'] = () => [401, { XErr: 2148916233 }];
    await assert.rejects(refreshLogin('cid', 'r1'), /kein Xbox-Profil/);
    happy();
    routes['https://api.minecraftservices.com/minecraft/profile'] = () => [404, {}];
    await assert.rejects(refreshLogin('cid', 'r1'), /besitzt kein Minecraft/);
    assert.match(msError({ error: 'unauthorized_client', error_description: 'AADSTS700016: Application not found' }).message, /Client-ID nicht gefunden/);
    I.setLang('en');
    await assert.rejects(refreshLogin('cid', 'r1'), /doesn’t own Minecraft/);
    I.setLang('de');
    console.log('ok');
  })().catch(e => { console.error(e); process.exit(1); });
}
