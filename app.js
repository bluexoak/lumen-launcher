const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ---------- language (i18n.js): mirrored in localStorage so the first paint is already in the right language ----------
const t = I18N.t;
I18N.setLang((() => { try { return localStorage.getItem('lang'); } catch { return null; } })() || I18N.resolve('auto', navigator.language));
document.documentElement.lang = I18N.lang;
$$('[data-i18n]').forEach(el => (el.innerHTML = t(el.dataset.i18n)));
$$('[data-i18n-ph]').forEach(el => (el.placeholder = t(el.dataset.i18nPh)));
$$('[data-i18n-title]').forEach(el => (el.title = t(el.dataset.i18nTitle)));

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errMsg = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const hue = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261) % 360; // FNV-1a
const compact = n => new Intl.NumberFormat(I18N.lang, { notation: 'compact' }).format(n);
const LOADER = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt' };
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  term: '<svg viewBox="0 0 24 24"><path d="m5 8 4 4-4 4M12 17h7"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  mods: '<svg viewBox="0 0 24 24"><path d="M9 4h6v3a2 2 0 1 0 4 0h1v6h-3a2 2 0 1 0 0 4h3v3H4v-6h3a2 2 0 1 0 0-4H4V4z"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};
const state = { instances: [], running: new Set(), busy: new Set(), logs: new Map(), consoleFor: null, settings: {} };

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), err ? 7000 : 3500);
}

// ---------- navigation ----------
function show(view) {
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === view));
  if (view === 'discover' && !hits.length && !disc.loading) search();
}
$$('nav button').forEach(b => (b.onclick = () => show(b.dataset.view)));

// ---------- library ----------
const art = i => (i.icon ? `<img class="art" src="${esc(i.icon)}" alt="">` : `<span class="art glyph">${esc((i.name[0] || '?').toUpperCase())}</span>`);
const metaLine = i => `${esc(i.mc)} · ${LOADER[i.loader]}${i.modpack ? ' · Modpack ' + esc(i.modpack.version) : ''}`;
function playBtn(i, cls = '') {
  const run = state.running.has(i.id), busy = state.busy.has(i.id);
  return `<button class="play ${cls} ${run ? 'stop' : ''}" data-act="${run ? 'kill' : 'launch'}" ${busy ? 'disabled' : ''}>
    ${run ? ICON.stop + t('inst.stop') : busy ? t('inst.preparing') : ICON.play + t('inst.play')}</button>`;
}

// ---------- layouts (book, carousel, …) vs. plain grid ----------
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
state.view = store.get('view') === 'grid' ? 'grid' : 'layout';

// layout and theme are mirrored in localStorage so they apply before settings.json has loaded (no flash of the defaults)
const LAYOUT_IDS = ['book', 'carousel', 'list', 'shelf', 'terminal'];
function applyLayout(l, rerender = true) {
  state.layout = LAYOUT_IDS.includes(l) ? l : 'book';
  document.documentElement.dataset.layout = state.layout;
  store.set('layout', state.layout);
  const r = document.querySelector(`#settings-form input[name=layout][value="${state.layout}"]`);
  if (r) r.checked = true;
  if (rerender) { renderInstances(); renderPacks(); }
}
applyLayout(store.get('layout'), false);
$$('#settings-form input[name=layout]').forEach(r => (r.onchange = async () => {
  applyLayout(r.value);
  try { await api.invoke('save-settings', { layout: r.value }); } catch (e) { toast(errMsg(e), true); }
}));

const THEMES = ['nacht', 'papier', 'neon', 'pixel', 'poster'];
// shelf: the cover turns to face the mouse; resting angle comes back when it leaves the window
let tiltFrame = 0;
addEventListener('mousemove', e => {
  if (tiltFrame || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  tiltFrame = requestAnimationFrame(() => {
    tiltFrame = 0;
    const b = document.querySelector('.view.active .lay-shelf .book3d');
    if (!b) return;
    const r = b.getBoundingClientRect(), clamp = v => Math.max(-1, Math.min(1, v));
    const dx = clamp((e.clientX - r.left - r.width / 2) / innerWidth * 2), dy = clamp((e.clientY - r.top - r.height / 2) / innerHeight * 2);
    b.style.setProperty('--ry', (dx * 28).toFixed(1) + 'deg');
    b.style.setProperty('--rx', (-dy * 16).toFixed(1) + 'deg');
  });
});
document.addEventListener('mouseleave', () => document.querySelectorAll('.book3d').forEach(b => b.style.cssText = ''));

// window buttons (drawn by Windows) take the colour of whatever the page shows under them
// ponytail: polls every 400ms instead of hooking every render path; cheap, one elementFromPoint
let barColor = '';
setInterval(() => {
  let el = document.elementFromPoint(innerWidth - 70, 20), bg = '';
  for (; el && !bg; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (!/^rgba\(.*, 0\)$|transparent/.test(c)) bg = c; }
  const [r, g, b] = (bg || 'rgb(12, 14, 19)').match(/\d+/g).map(Number);
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  if (hex === barColor) return;
  barColor = hex;
  api.invoke('titlebar', hex, 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? '#3a3a3a' : '#b8bfcc').catch(() => {});
}, 400);

function applyTheme(t) {
  t = THEMES.includes(t) ? t : 'nacht';
  document.documentElement.dataset.theme = t;
  store.set('theme', t);
  const r = document.querySelector(`#settings-form input[name=theme][value="${t}"]`);
  if (r) r.checked = true;
}
applyTheme(store.get('theme'));
$$('#settings-form input[name=theme]').forEach(r => (r.onchange = async () => {
  applyTheme(r.value);
  try { await api.invoke('save-settings', { theme: r.value }); } catch (e) { toast(errMsg(e), true); }
}));
state.sel = null;
const pad2 = n => String(n).padStart(2, '0');
const ago = t => {
  const rtf = new Intl.RelativeTimeFormat(I18N.lang, { numeric: 'auto', style: 'short' }), s = (t - Date.now()) / 1000;
  for (const [u, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]])
    if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return I18N.t('time.now');
};

// dominant icon colour: saturation-weighted hue histogram (an average would turn multi-coloured icons grey)
const colors = new Map();
const colorOf = i => colors.get(i.id) || { h: hue(i.name), s: 45 };
function extractColor(i) {
  if (!i.icon || colors.has(i.id)) return;
  colors.set(i.id, null);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, 32, 32);
      const d = x.getImageData(0, 0, 32, 32).data, bins = Array.from({ length: 36 }, () => ({ w: 0, s: 0 }));
      for (let p = 0; p < d.length; p += 4) {
        const r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
        if (d[p + 3] < 128 || s < 0.2 || mx < 0.2) continue;
        const k = mx - mn, h = (mx === r ? (g - b) / k + 6 : mx === g ? (b - r) / k + 2 : (r - g) / k + 4) * 60 % 360;
        const bin = bins[Math.floor(h / 10)], w = s * mx;
        bin.w += w; bin.s += s * w;
      }
      const best = bins.reduce((a, b, n) => (b.w > bins[a].w ? n : a), 0), bin = bins[best];
      colors.set(i.id, bin.w ? { h: best * 10 + 5, s: Math.round(Math.min(bin.s / bin.w, 0.85) * 100) } : { h: hue(i.name), s: 8 });
      $$(`.lay[data-id="${CSS.escape(i.id)}"], [data-sel="${CSS.escape(i.id)}"]`).forEach(el => setVars(el, i));
    } catch {} // tainted canvas / broken image → keep name-hash colour
  };
  img.src = i.icon;
}
const colorVars = i => { const c = colorOf(i); return { '--h': c.h, '--s': c.s + '%' }; };
const setVars = (el, i) => Object.entries(colorVars(i)).forEach(([k, v]) => el.style.setProperty(k, v)); // Object.assign ignores custom properties
const styleVars = i => Object.entries(colorVars(i)).map(([k, v]) => `${k}:${v}`).join(';');

// the layout-neutral description of one item that every layout in layouts.js renders (see the header there)
function instModel(i) {
  const [big, ...rest] = i.mc.split(/(?=\.\d+$)/);
  return {
    id: i.id, title: i.name, color: i, icon: i.icon, banner: i.coverUrl || i.banner,
    plate: { big, small: rest.join(''), vert: `Minecraft · ${LOADER[i.loader]}` },
    kicker: state.running.has(i.id) ? t('inst.running') : LOADER[i.loader] + (i.modpack ? ' · Modpack' : ' · ' + t('inst.own')),
    lede: null,
    specs: [['Minecraft', i.mc], ['Loader', LOADER[i.loader] + (i.loaderVersion ? ' ' + i.loaderVersion : '')],
      ...(i.loader !== 'vanilla' ? [['Mods', String(i.modCount ?? 0)]] : []), ...(i.modpack ? [['Modpack', i.modpack.version]] : []),
      [t('inst.last_played'), i.lastPlayed ? ago(i.lastPlayed) : t('inst.never')]],
    short: `${i.mc} · ${LOADER[i.loader]}`,
    cta: `${playBtn(i, 'big')}
      ${i.loader !== 'vanilla' ? `<button class="icon" data-act="mods" title="${t('inst.mods')}">${ICON.mods}</button>` : ''}
      <button class="icon" data-act="logs" title="${t('inst.console')}">${ICON.term}</button>
      <button class="icon" data-act="folder" title="${t('inst.folder')}">${ICON.folder}</button>
      <button class="icon" data-act="settings" title="${t('inst.settings')}">${ICON.gear}</button>
      <button class="icon danger" data-act="delete" title="${t('inst.delete')}">${ICON.trash}</button>`,
  };
}
function libCtx() {
  const list = state.instances, n = Math.max(0, list.findIndex(i => i.id === state.sel));
  state.sel = list[n]?.id;
  return { items: list.map(instModel), n, total: list.length, ram: list[n]?.ram || state.settings.ram || 4096, unit: t('lay.unit_inst'), hint: t('inst.play'), label: t('nav.library'), busy: state.busy.has(state.sel),
    controls: `${viewToggle()}<button class="btn ghost sm" data-act="new">+ ${t('lib.new')}</button>` };
}

const viewToggle = () => `<div class="vt">
  <button data-view-set="layout" class="${state.view === 'layout' ? 'on' : ''}" title="${t('view.layout')}"><svg viewBox="0 0 24 24"><path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v14"/></svg></button>
  <button data-view-set="grid" class="${state.view === 'grid' ? 'on' : ''}" title="${t('view.grid')}"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg></button></div>`;

const hints = action => state.gamepad
  ? `<span><kbd>◀ ▶</kbd> ${t('hint.browse')}</span><span><kbd>A</kbd> ${action}</span><span><kbd>Y</kbd> ${t('hint.grid')}</span>`
  : `<span><kbd>←</kbd><kbd>→</kbd> ${t('hint.browse')}</span><span><kbd>Enter</kbd> ${action}</span><span><kbd>G</kbd> ${t('hint.grid')}</span>`;

function setView(v) {
  state.view = v;
  store.set('view', v);
  renderInstances();
  renderPacks();
}
const toggleView = () => setView(state.view === 'layout' ? 'grid' : 'layout');

// every view that can be shown in a layout: its items, the selected one, how to select and what Enter/A does
const VIEWS = {
  library: {
    list: () => state.instances, id: x => x.id, sel: () => state.sel,
    select: (id, dir) => { state.sel = id; renderInstances(dir); },
    primary: () => { const id = state.sel; if (id && !state.running.has(id) && !state.busy.has(id)) act('launch', id); },
  },
  discover: {
    list: () => hits, id: x => x.project_id, sel: () => disc.sel,
    select: (id, dir) => { disc.sel = id; renderPacks(dir); },
    primary: () => { const p = hits.find(h => h.project_id === disc.sel); if (p && packSupported(p)) openPack(p); },
    more: () => { if (!$('#more').hidden && !disc.loading) search(true); },
  },
};
const viewId = () => $('.view.active')?.id;
const activeLayout = () => { const v = $('.view.active'); return v?.classList.contains('layout-mode') && !$('dialog[open]') ? VIEWS[v.id] : null; };
function select(b, id) {
  const list = b.list(), d = list.findIndex(x => b.id(x) === id) - list.findIndex(x => b.id(x) === b.sel());
  if (d) b.select(id, d > 0 ? 'next' : 'prev');
}
function turn(d) {
  const b = activeLayout();
  if (!b) return;
  const list = b.list(), n = list.findIndex(x => b.id(x) === b.sel()), next = Math.min(list.length - 1, Math.max(0, n + d));
  if (next === n) return d > 0 && b.more?.();
  b.select(b.id(list[next]), d > 0 ? 'next' : 'prev');
  if (next >= list.length - 3) b.more?.(); // prefetch the next page before the reader hits the end
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && e.target.matches('input')) return e.target.blur();
  if (!VIEWS[viewId()] || $('dialog[open]') || e.target.matches('input, select, textarea')) return;
  if (e.key === 'g' || e.key === 'G') return toggleView();
  const b = activeLayout();
  if (!b) return;
  const d = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 }[e.key];
  if (d) { e.preventDefault(); turn(d); }
  if (e.key === 'Home') { e.preventDefault(); turn(-1e9); }
  if (e.key === 'End') { e.preventDefault(); turn(1e9); }
  if (e.key === 'Enter' && !e.target.closest('button')) b.primary();
});

let wheelAt = 0;
$$('#library, #discover').forEach(el => el.addEventListener('wheel', e => {
  if (!activeLayout()) return;
  e.preventDefault();
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (Math.abs(d) < 4 || performance.now() - wheelAt < 320) return;
  wheelAt = performance.now();
  turn(Math.sign(d));
}, { passive: false }));

// gamepad: d-pad / left stick to turn (with key-repeat), A = primary action (or a dialog's primary button), B close, Y toggle view
const gp = { dir: 0, t: 0, rep: false, prev: [], on: false };
function pollPad(ts) {
  const g = [...navigator.getGamepads()].find(Boolean);
  if (!g) { gp.on = false; state.gamepad = false; renderInstances(); return renderPacks(); }
  const btn = n => !!g.buttons[n]?.pressed, press = n => btn(n) && !gp.prev[n];
  const dir = btn(15) || g.axes[0] > 0.5 ? 1 : btn(14) || g.axes[0] < -0.5 ? -1 : 0;
  if (dir !== gp.dir) { gp.rep = false; if (dir) turn(dir); gp.t = ts; }
  else if (dir && ts - gp.t > (gp.rep ? 150 : 420)) { gp.rep = true; gp.t = ts; turn(dir); }
  gp.dir = dir;
  const dlg = $('dialog[open]');
  if (press(0)) dlg ? dlg.querySelector('.btn.primary:not(:disabled)')?.click() : activeLayout()?.primary();
  if (press(1)) dlg ? dlg.close() : $('#console-close').click();
  if (press(3) && VIEWS[viewId()] && !dlg) toggleView();
  gp.prev = g.buttons.map(b => b.pressed);
  requestAnimationFrame(pollPad);
}
window.addEventListener('gamepadconnected', () => {
  state.gamepad = true;
  renderInstances();
  renderPacks();
  if (!gp.on) { gp.on = true; requestAnimationFrame(pollPad); }
});

function renderInstances(turnDir) {
  const list = state.instances, layout = state.view === 'layout' && list.length > 0;
  $('#library').classList.toggle('layout-mode', layout);
  $('#library .vt-slot').innerHTML = list.length ? viewToggle() : '';
  if (layout) { renderLayout($('#book'), libCtx(), turnDir); $('#hero').innerHTML = $('#instances').innerHTML = ''; return; }
  $('#book').innerHTML = '';
  $('#lib-sub').textContent = list.length ? t(list.length === 1 ? 'lib.count1' : 'lib.count', { n: list.length }) : '';
  const h = list[0];
  $('#hero').innerHTML = h ? `
    <div class="hero" data-id="${esc(h.id)}" style="--h:${hue(h.name)}">
      ${art(h)}
      <div class="meta"><div class="eyebrow">${state.running.has(h.id) ? t('inst.running_short') : h.lastPlayed ? t('inst.continue') : t('inst.new')}</div><h2>${esc(h.name)}</h2><p>${metaLine(h)}</p></div>
      ${playBtn(h, 'btn')}
      <div class="progress ${state.busy.has(h.id) ? 'on' : ''}"><i></i></div>
    </div>` : '';
  $('#instances').innerHTML = list.length ? list.map(i => `
    <article class="card" data-id="${esc(i.id)}" style="--h:${hue(i.name)}">
      <div class="banner">${art(i)}<span class="tag">${LOADER[i.loader]}</span>${state.running.has(i.id) ? `<span class="tag live">${t('inst.running_tag')}</span>` : ''}</div>
      <div class="body"><h3 title="${esc(i.name)}">${esc(i.name)}</h3><p>${metaLine(i)}</p></div>
      <div class="actions">${playBtn(i)}
        ${i.loader !== 'vanilla' ? `<button class="icon" data-act="mods" title="${t('inst.mods')}">${ICON.mods}</button>` : ''}
        <button class="icon" data-act="logs" title="${t('inst.console')}">${ICON.term}</button>
        <button class="icon" data-act="folder" title="${t('inst.folder')}">${ICON.folder}</button>
        <button class="icon" data-act="settings" title="${t('inst.settings')}">${ICON.gear}</button>
      <button class="icon danger" data-act="delete" title="${t('inst.delete')}">${ICON.trash}</button>
      </div>
      <div class="progress ${state.busy.has(i.id) ? 'on' : ''}"><i></i></div>
    </article>`).join('') : `
    <div class="empty"><div><h3>${t('lib.empty')}</h3><p>${t('lib.empty_text')}</p>
      <div class="row"><button class="btn primary" data-act="new">${t('lib.new')}</button><button class="btn ghost" data-act="discover">${t('lib.empty_discover')}</button></div></div></div>`;
}

async function loadInstances() {
  state.instances = await api.invoke('instances');
  renderInstances();
}

async function act(name, id) {
  const inst = state.instances.find(i => i.id === id);
  if (name === 'new') return openNew();
  if (name === 'discover') return show('discover');
  if (name === 'folder') return api.invoke('open-folder', id);
  if (name === 'logs') return openConsole(id);
  if (name === 'mods') return openMods(id);
  if (name === 'settings') return openInstSettings(id);
  if (name === 'kill') return api.invoke('kill', id);
  if (name === 'delete') {
    if (state.running.has(id)) return toast(t('inst.stop_first'), true);
    if (!confirm(t('inst.confirm_delete', { name: inst.name }))) return;
    await api.invoke('delete', id);
    return loadInstances();
  }
  if (name === 'launch') {
    state.busy.add(id);
    state.logs.set(id, '');
    renderInstances();
    if (state.consoleFor === id) openConsole(id);
    try { await api.invoke('launch', id); }
    catch (e) { toast(errMsg(e), true); appendLog(id, '\n' + errMsg(e) + '\n'); }
    finally { state.busy.delete(id); await loadInstances(); }
  }
}
document.addEventListener('click', e => {
  const v = e.target.closest('[data-view-set]'), sel = e.target.closest('[data-sel]');
  if (v) return setView(v.dataset.viewSet);
  if (sel) return select(VIEWS[sel.closest('.view').id], sel.dataset.sel);
  if (e.target.closest('[data-pack-install]')) return VIEWS.discover.primary();
  const b = e.target.closest('[data-act]');
  if (b && b.closest('#library')) act(b.dataset.act, b.closest('[data-id]')?.dataset.id);
});

api.on('progress', (id, done, total) => {
  const pct = (done / total) * 100 + '%';
  if (id === 'pack') { const bar = $('#pack-dlg .bar i'); if (bar) bar.style.width = pct; return; }
  $$(`[data-id="${CSS.escape(id)}"] .progress`).forEach(p => { p.classList.add('on'); p.firstElementChild.style.width = pct; });
});
api.on('state', (id, s, code) => {
  s === 'running' ? state.running.add(id) : state.running.delete(id);
  if (s === 'stopped' && code) toast(t('inst.exit_code', { code }), true);
  $('#console').classList.toggle('live', state.running.has(state.consoleFor));
  renderInstances();
});

// ---------- console ----------
function appendLog(id, s) {
  const log = ((state.logs.get(id) || '') + s).slice(-300_000);
  state.logs.set(id, log);
  if (state.consoleFor !== id) return;
  const pre = $('#console-log'), atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  pre.textContent = log;
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}
api.on('log', appendLog);
function openConsole(id) {
  state.consoleFor = id;
  $('#console-title').textContent = state.instances.find(i => i.id === id)?.name || '';
  $('#console-log').textContent = state.logs.get(id) || t('console.empty');
  $('#console').classList.add('open');
  $('#console').classList.toggle('live', state.running.has(id));
  $('#console-log').scrollTop = 1e9;
}
$('#console-close').onclick = () => { $('#console').classList.remove('open'); state.consoleFor = null; };

// ---------- new instance ----------
let versions = [];
function fillVersions() {
  const all = $('#snapshots').checked;
  $('#mc-select').innerHTML = versions.filter(v => all || v.type === 'release')
    .map(v => `<option value="${esc(v.id)}">${esc(v.id)}${v.type !== 'release' ? ' · ' + esc(v.type) : ''}</option>`).join('');
}
async function openNew() {
  $('#new-form').reset();
  $('#new-dlg').showModal();
  if (!versions.length) {
    try { versions = await api.invoke('mc-versions'); } catch (e) { toast(errMsg(e), true); }
  }
  fillVersions();
}
$('#new-btn').onclick = openNew;
$('#snapshots').onchange = fillVersions;
$('#new-dlg').addEventListener('close', async () => {
  if ($('#new-dlg').returnValue !== 'ok') return;
  const f = new FormData($('#new-form'));
  try {
    await api.invoke('create', { name: f.get('name').trim(), mc: f.get('mc'), loader: f.get('loader') });
    await loadInstances();
    toast(t('inst.created'));
  } catch (e) { toast(errMsg(e), true); }
});

// ---------- discover ----------
let query = '', offset = 0, hits = [], searchTimer;
const disc = { sel: null, total: 0, loading: false };
const PACK_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'];
const packLoaders = p => p.categories.filter(c => PACK_LOADERS.includes(c));
const packSupported = p => { const l = packLoaders(p); return !l.length || l.includes('fabric') || l.includes('quilt'); };
const packItem = p => ({ id: p.project_id, name: p.title, icon: p.icon_url });
const cap = s => s[0].toUpperCase() + s.slice(1);

async function search(append) {
  if (!append) { offset = 0; disc.sel = null; if (!$('#discover').classList.contains('layout-mode')) $('#packs').innerHTML = '<div class="skeleton"></div>'.repeat(8); }
  disc.loading = true;
  try {
    const r = await api.invoke('search', query, offset);
    if (!append) hits = [];
    hits.push(...r.hits);
    offset += r.hits.length;
    disc.total = r.total_hits;
    disc.searched = true;
    $('#more').hidden = offset >= r.total_hits;
    renderPacks(append ? null : 'next');
  } catch (e) { $('#packs').innerHTML = ''; toast(errMsg(e), true); }
  disc.loading = false;
}
const onSearchInput = e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { query = e.target.value.trim(); search(); }, 300);
};

function packModel(p) {
  const loaders = packLoaders(p), ok = packSupported(p), tags = p.categories.filter(c => !PACK_LOADERS.includes(c)).slice(0, 2).map(cap);
  return {
    id: p.project_id, title: p.title, color: packItem(p), icon: p.icon_url, banner: p.featured_gallery || p.gallery?.[0],
    plate: { big: p.title[0] || '?', small: '', vert: 'Modpack' },
    kicker: ['Modpack', ...tags].join(' · '),
    lede: p.description,
    specs: [[t('pack.author'), p.author], ['Downloads', compact(p.downloads)], [t('pack.followers'), compact(p.follows)],
      ['Minecraft', p.versions.at(-1) || '—'], ['Loader', loaders.map(cap).join(', ') || '—'],
      [t('pack.updated'), new Date(p.date_modified).toLocaleDateString(I18N.lang, { month: 'short', year: 'numeric' })]],
    short: [p.versions.at(-1), ...loaders.map(cap)].filter(Boolean).join(' · '),
    cta: `<button class="play big dl" data-pack-install ${ok ? '' : 'disabled'}>${ICON.dl}${ok ? t('pack.install') : t('pack.forge')}</button>`,
  };
}
function packCtx() {
  const n = Math.max(0, hits.findIndex(h => h.project_id === disc.sel));
  disc.sel = hits[n]?.project_id ?? null;
  return { items: hits.map(packModel), n, total: disc.total.toLocaleString(I18N.lang), ram: state.settings.ram || 4096, unit: t('lay.unit_pack'), hint: t('hint.install'), label: t('nav.discover'),
    empty: [t('disc.nothing'), t('disc.no_match', { q: query })],
    controls: `<label class="search compact"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="pack-q" type="search" placeholder="${t('disc.search_short')}"></label>${viewToggle()}`,
    bind: top => { const q = top.querySelector('input'); q.value = query; q.oninput = onSearchInput; } };
}

function renderPacks(turnDir) {
  const layout = state.view === 'layout' && disc.searched; // stays a layout on 0 hits so the search field in it survives
  $('#discover').classList.toggle('layout-mode', layout);
  $('#discover .vt-slot').innerHTML = viewToggle();
  if (layout) return renderLayout($('#pack-book'), packCtx(), turnDir);
  $('#pack-book').innerHTML = '';
  $('#search').value = query;
  $('#packs').innerHTML = hits.length ? hits.map((p, n) => `
      <article class="card" data-n="${n}">
        <div class="pack-top">${p.icon_url ? `<img class="art" src="${esc(p.icon_url)}" alt="">` : '<span class="art"></span>'}
          <div><h3>${esc(p.title)}</h3><small>${esc(t('disc.by', { author: p.author }))}</small></div></div>
        <p class="desc">${esc(p.description)}</p>
        <div class="stats"><span class="dl">${ICON.dl}${compact(p.downloads)}</span>
          ${p.categories.filter(c => !['fabric', 'quilt', 'forge', 'neoforge'].includes(c)).slice(0, 2).map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      </article>`).join('') : `<div class="empty"><div><h3>${t('disc.nothing')}</h3><p>${t('disc.try_other')}</p></div></div>`;
}

$('#search').oninput = onSearchInput;
$('#more').onclick = () => search(true);
$('#packs').onclick = e => { const c = e.target.closest('[data-n]'); if (c) openPack(hits[c.dataset.n]); };

async function openPack(p) {
  const dlg = $('#pack-dlg');
  dlg.innerHTML = `<div class="dlg">
    <div class="dlg-head">${p.icon_url ? `<img class="art" src="${esc(p.icon_url)}" alt="">` : '<span class="art"></span>'}
      <div><h2>${esc(p.title)}</h2><p>${esc(t('disc.by', { author: p.author }))} · ${esc(t('disc.downloads', { n: compact(p.downloads) }))}</p></div></div>
    <p class="dlg-body">${esc(p.description)}</p>
    <label class="field"><span>${t('pack.version')}</span><select id="pack-ver" disabled><option>${t('pack.loading')}</option></select></label>
    <div class="bar" hidden><i></i></div>
    <div class="row end"><button class="btn ghost" id="pack-cancel">${t('common.close')}</button><button class="btn primary" id="pack-install" disabled>${ICON.dl}${t('pack.install')}</button></div>
  </div>`;
  dlg.showModal();
  $('#pack-cancel').onclick = () => dlg.close();
  let vs;
  try { vs = await api.invoke('pack-versions', p.project_id); } catch (e) { return toast(errMsg(e), true); }
  const ok = v => v.loaders.some(l => l === 'fabric' || l === 'quilt' || l === 'minecraft');
  $('#pack-ver').innerHTML = vs.map((v, n) => `<option value="${n}" ${ok(v) ? '' : 'disabled'}>${esc(v.version_number)} · MC ${esc(v.game_versions.join(', '))} · ${esc(v.loaders.join('/'))}${ok(v) ? '' : t('pack.unsupported')}</option>`).join('');
  const first = vs.findIndex(ok);
  if (first < 0) return toast(t('pack.needs_forge'), true);
  $('#pack-ver').value = first;
  $('#pack-ver').disabled = $('#pack-install').disabled = false;
  $('#pack-install').onclick = async () => {
    $('#pack-install').disabled = $('#pack-ver').disabled = $('#pack-cancel').disabled = true;
    $('#pack-install').textContent = t('pack.installing');
    $('#pack-dlg .bar').hidden = false;
    try {
      await api.invoke('install-pack', p, vs[$('#pack-ver').value]);
      dlg.close();
      toast(t('pack.installed', { title: p.title }));
      await loadInstances();
      show('library');
    } catch (e) {
      toast(errMsg(e), true);
      $('#pack-install').disabled = $('#pack-ver').disabled = $('#pack-cancel').disabled = false;
      $('#pack-install').innerHTML = ICON.dl + t('pack.install');
    }
  };
}
$('#pack-dlg').addEventListener('cancel', e => { if ($('#pack-cancel')?.disabled) e.preventDefault(); });

// ---------- instance settings (name, memory, Java, JVM flags, cover image) ----------
let instEdit = null;
const gb = mb => (mb / 1024).toFixed(1).replace('.0', '') + ' GB';
const instForm = $('#inst-form');
function paintInstCover() {
  const i = state.instances.find(x => x.id === instEdit);
  if (!i) return;
  const pic = i.coverUrl || i.banner || i.icon;
  $('#inst-cover-img').innerHTML = pic ? `<img src="${esc(pic)}" alt="">` : `<span>${esc(t('is.cover_none'))}</span>`;
  $('#inst-cover-reset').disabled = !i.coverUrl;
}
function openInstSettings(id) {
  const i = state.instances.find(x => x.id === id), global = state.settings.ram || 4096, f = instForm;
  instEdit = id;
  f.name.value = i.name;
  f.ramOwn.checked = !!i.ram;
  f.ram.value = i.ram || global;
  f.ram.disabled = !i.ram;
  $('#inst-ram-val').textContent = gb(+f.ram.value);
  $('#inst-ram-default').textContent = t('is.ram_default', { gb: gb(global) });
  f.javaPath.value = i.javaPath || '';
  f.jvmArgs.value = i.jvmArgs || '';
  paintInstCover();
  $('#inst-dlg').showModal();
}
instForm.ramOwn.onchange = () => {
  instForm.ram.disabled = !instForm.ramOwn.checked;
  if (!instForm.ramOwn.checked) instForm.ram.value = state.settings.ram || 4096;
  $('#inst-ram-val').textContent = gb(+instForm.ram.value);
};
instForm.ram.oninput = () => ($('#inst-ram-val').textContent = gb(+instForm.ram.value));
$('#inst-cover-pick').onclick = async () => {
  try { if (await api.invoke('instance-cover', instEdit)) { await loadInstances(); paintInstCover(); } } catch (e) { toast(errMsg(e), true); }
};
$('#inst-cover-reset').onclick = async () => {
  try { await api.invoke('instance-cover-clear', instEdit); await loadInstances(); paintInstCover(); } catch (e) { toast(errMsg(e), true); }
};
// save only on the Save button; a validation error keeps the dialog open
instForm.onsubmit = async e => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  try {
    await api.invoke('update-instance', instEdit, { name: instForm.name.value, ram: instForm.ramOwn.checked ? +instForm.ram.value : null,
      javaPath: instForm.javaPath.value.trim(), jvmArgs: instForm.jvmArgs.value.trim() });
    $('#inst-dlg').close();
    toast(t('is.saved'));
    await loadInstances();
  } catch (err) { toast(errMsg(err), true); }
};

// ---------- per-instance mods ----------
const mods = { id: null, installed: [], tab: 'installed', q: '', hits: [], busy: new Set(), timer: null };
const modRow = (icon, title, sub, action) => `<div class="mod-row">${icon ? `<img class="art" src="${esc(icon)}" alt="">` : '<span class="art"></span>'}
  <div class="mod-meta"><b>${esc(title)}</b><small>${esc(sub)}</small></div>${action}</div>`;
const emptyBox = (h, p) => `<div class="empty"><div><h3>${h}</h3><p>${p}</p></div></div>`;

function renderMods() {
  const list = $('#mod-list');
  $('#mods-count').textContent = mods.installed.length;
  if (mods.tab === 'installed') {
    const q = mods.q.toLowerCase(), rows = mods.installed.filter(m => m.title.toLowerCase().includes(q));
    const outdated = mods.installed.filter(m => m.update).length;
    list.innerHTML = (outdated ? `<div class="update-bar"><span>${t(outdated === 1 ? 'mods.updates1' : 'mods.updates', { n: outdated })}</span>
      <button class="btn primary sm" data-upd-all ${mods.busy.size ? 'disabled' : ''}>${t('mods.update_all')}</button></div>` : '')
      + rows.map(m => modRow(m.icon, m.title, m.update ? `${m.version}  →  ${m.update}` : m.version || m.file,
      (m.update ? `<button class="btn sm upd" data-upd="${esc(m.file)}" ${mods.busy.size ? 'disabled' : ''}>${mods.busy.has(m.file) ? t('common.loading') : t('mods.update')}</button>` : '')
      + `<button class="btn ghost sm danger" data-rm="${esc(m.file)}">${t('mods.remove')}</button>`)).join('')
      || emptyBox(q ? t('mods.no_hits') : t('mods.none'), q ? t('mods.other_term') : t('mods.none_text'));
  } else {
    const have = new Set(mods.installed.map(m => m.projectId));
    list.innerHTML = mods.hits.map(p => modRow(p.icon_url, p.title, `${p.author} · ${compact(p.downloads)} · ${p.description}`,
      have.has(p.project_id) ? `<span class="done">${t('mods.is_installed')}</span>`
        : `<button class="btn primary sm" data-add="${esc(p.project_id)}" ${mods.busy.has(p.project_id) ? 'disabled' : ''}>${mods.busy.has(p.project_id) ? t('common.loading') : t('mods.install')}</button>`)).join('')
      || emptyBox(t('disc.nothing'), t('mods.none_found'));
  }
}

async function refreshInstalled() {
  try { mods.installed = await api.invoke('mods', mods.id); } catch (e) { toast(errMsg(e), true); }
  renderMods();
}

async function searchMods() {
  $('#mod-list').innerHTML = '<div class="row-skel"></div>'.repeat(6);
  try { mods.hits = (await api.invoke('search-mods', mods.id, mods.q)).hits; } catch (e) { mods.hits = []; toast(errMsg(e), true); }
  if (mods.tab === 'add') renderMods();
}

function setModTab(tab) {
  mods.tab = tab;
  mods.q = $('#mods-search').value = '';
  $(`#mods-dlg input[value="${tab}"]`).checked = true;
  $('#mods-search').placeholder = t(tab === 'add' ? 'mods.search' : 'mods.filter');
  tab === 'add' ? searchMods() : renderMods();
}

async function openMods(id) {
  const inst = state.instances.find(i => i.id === id);
  Object.assign(mods, { id, installed: [], q: '', hits: [] });
  $('#mods-search').value = '';
  $('#mods-title').textContent = inst.name;
  $('#mods-sub').textContent = `Minecraft ${inst.mc} · ${LOADER[inst.loader]}`;
  $('#mod-list').innerHTML = '<div class="row-skel"></div>'.repeat(4);
  $('#mods-dlg').showModal();
  setModTab('installed');
  await refreshInstalled();
}

$$('#mods-dlg input[name=mtab]').forEach(r => (r.onchange = () => setModTab(r.value)));
$('#mods-close').onclick = () => $('#mods-dlg').close();
$('#mods-search').oninput = e => {
  mods.q = e.target.value.trim();
  if (mods.tab === 'installed') return renderMods();
  clearTimeout(mods.timer);
  mods.timer = setTimeout(searchMods, 300);
};
$('#mod-list').onclick = async e => {
  const rm = e.target.closest('[data-rm]'), add = e.target.closest('[data-add]');
  const upd = e.target.closest('[data-upd]') ? [e.target.closest('[data-upd]').dataset.upd]
    : e.target.closest('[data-upd-all]') ? mods.installed.filter(m => m.update).map(m => m.file) : null;
  if (upd) {
    upd.forEach(f => mods.busy.add(f));
    renderMods();
    let ok = 0;
    for (const f of upd) {
      try { await api.invoke('update-mod', mods.id, f); ok++; } catch (err) { toast(`${f}: ${errMsg(err)}`, true); }
      mods.busy.delete(f);
    }
    if (ok) toast(t(ok === 1 ? 'mods.updated1' : 'mods.updated', { n: ok }));
    await refreshInstalled();
  }
  if (rm) {
    if (!confirm(t('mods.confirm_remove', { file: rm.dataset.rm }))) return;
    try { await api.invoke('remove-mod', mods.id, rm.dataset.rm); } catch (err) { toast(errMsg(err), true); }
    await refreshInstalled();
  }
  if (add) {
    const pid = add.dataset.add;
    mods.busy.add(pid);
    renderMods();
    try {
      const added = await api.invoke('install-mod', mods.id, pid, mods.installed.map(m => m.projectId).filter(Boolean));
      toast(added.length > 1 ? t('mods.added_deps', { name: added[0], n: added.length - 1 }) : t('mods.added', { name: added[0] }));
    } catch (err) { toast(errMsg(err), true); }
    mods.busy.delete(pid);
    await refreshInstalled();
  }
};

// ---------- settings ----------
const form = $('#settings-form');
// language setting → resolved language; reload when it differs from what this page was rendered in
function syncLanguage(setting) {
  const lang = I18N.resolve(setting, navigator.language);
  try { localStorage.setItem('lang', lang); } catch {}
  if (lang !== I18N.lang) location.reload();
}
form.language.onchange = async () => {
  try { await api.invoke('save-settings', { language: form.language.value }); syncLanguage(form.language.value); } catch (e) { toast(errMsg(e), true); }
};

function applySettings(s) {
  state.settings = s;
  form.language.value = s.language || 'auto';
  syncLanguage(s.language);
  if (s.theme) applyTheme(s.theme);
  if (s.layout && s.layout !== state.layout) applyLayout(s.layout);
  form.username.value = s.username;
  form.ram.value = s.ram;
  form.javaPath.value = s.javaPath || '';
  $('#ram-val').textContent = (s.ram / 1024).toFixed(1).replace('.0', '') + ' GB';
  form.clientId.value = s.clientId || '';
  const name = s.account?.name || s.username;
  $('#acc-name').textContent = name;
  $('#acc-kind').textContent = t(s.account ? 'acc.msa' : 'acc.offline');
  $('#avatar').textContent = name[0].toUpperCase();
  $('#ms-out').hidden = !!s.account;
  $('#ms-in').hidden = !s.account;
  if (s.account) { $('#ms-name').textContent = s.account.name; $('#ms-avatar').textContent = s.account.name[0].toUpperCase(); }
}

// ---------- Microsoft login (device code: user types the code on microsoft.com) ----------
form.clientId.onchange = async () => {
  try { applySettings(await api.invoke('save-settings', { clientId: form.clientId.value.trim() })); } catch (e) { toast(errMsg(e), true); }
};
let msLogin = null;
$('#ms-login').onclick = async () => {
  const btn = $('#ms-login');
  btn.disabled = true;
  try {
    applySettings(await api.invoke('save-settings', { clientId: form.clientId.value.trim() }));
    msLogin = await api.invoke('ms-login-start');
    $('#ms-code').textContent = msLogin.userCode;
    $('#ms-status').textContent = t('ms.wait');
    $('#ms-status').classList.remove('err');
    $('#ms-dlg').showModal();
  } catch (e) { toast(errMsg(e), true); }
  btn.disabled = false;
};
$('#ms-open').onclick = () => {
  navigator.clipboard.writeText(msLogin.userCode).catch(() => {});
  api.invoke('open-ms-link', msLogin.uri);
  $('#ms-status').textContent = t('ms.copied');
};
$('#ms-cancel').onclick = () => $('#ms-dlg').close();
$('#ms-dlg').addEventListener('close', () => { if (msLogin) api.invoke('ms-login-cancel'); msLogin = null; });
api.on('ms-login', async (kind, msg) => {
  if (!msLogin) return; // dialog was closed: the cancellation error needs no message
  if (kind === 'done') {
    msLogin = null;
    $('#ms-dlg').close();
    applySettings(await api.invoke('settings'));
    toast(t('ms.signed_as', { name: msg }));
  } else {
    $('#ms-status').textContent = msg;
    $('#ms-status').classList.add('err');
  }
});
$('#ms-logout').onclick = async () => applySettings(await api.invoke('ms-logout'));
form.ram.oninput = () => ($('#ram-val').textContent = (form.ram.value / 1024).toFixed(1).replace('.0', '') + ' GB');
form.onsubmit = async e => {
  e.preventDefault();
  try {
    applySettings(await api.invoke('save-settings', { username: form.username.value, ram: +form.ram.value, javaPath: form.javaPath.value.trim() }));
    toast(t('set.saved'));
  } catch (err) { toast(errMsg(err), true); }
};
$('#open-root').onclick = () => api.invoke('open-folder');

api.invoke('settings').then(applySettings);
loadInstances();
