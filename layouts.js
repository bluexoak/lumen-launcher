// Layouts: whole UI languages for the browse views (library, discover). Each one turns the same ctx into markup:
//   ctx  = { items: [model], n: selected index, total, hint, label, busy, controls, bind?, empty? }
//   model = { id, title, color, icon, banner, plate: { big, small, vert }, kicker, lede, specs: [[k, v]], short, cta }
// Navigation (keys, wheel, gamepad, clicks on [data-sel]) lives in app.js and is the same for every layout.

const iconOrGlyph = (m, cls = '') => (m.icon ? `<img class="${cls}" src="${esc(m.icon)}" alt="">`
  : `<span class="${cls} glyph-txt">${esc((m.title[0] || '?').toUpperCase())}</span>`);
const selAttrs = (m, on, cls, style = '') => `class="${cls} ${on ? 'on' : ''}" data-sel="${esc(m.id)}" title="${esc(m.title)}" style="${styleVars(m.color)};${style}"`;
const specsHtml = m => `<dl class="specs ${m.specs.length > 5 ? 'three' : ''}">${m.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
const ledeHtml = (m, cls = 'lede') => (m.lede ? `<p class="${cls}">${esc(m.lede)}</p>` : '');

// picture for an item: gallery image, else the icon on a glow, else big typography from plate
function artHtml(m) {
  const p = m.plate;
  return m.banner ? `<img class="cover" src="${esc(m.banner)}" alt="">`
    : m.icon ? `<div class="icon-plate"><img class="glow" src="${esc(m.icon)}" alt=""><img class="big" src="${esc(m.icon)}" alt=""></div>`
    : `<div class="type-plate" style="--len:${Math.max(2, (p.big + p.small).length)}"><span class="vert">${esc(p.vert)}</span><div class="num">${esc(p.big)}<span>${esc(p.small)}</span></div></div>`;
}

// icon → ASCII art for the terminal (luminance ramp, 2:1 cells so a square icon stays square)
const asciiCache = new Map();
function asciiArt(m) {
  if (!m.icon || asciiCache.has(m.id)) return;
  asciiCache.set(m.id, '');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const W = 36, H = 18, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H).data, ramp = ' .:-=+*#%@';
      const lum = Array.from({ length: W * H }, (_, k) => (0.3 * d[k * 4] + 0.59 * d[k * 4 + 1] + 0.11 * d[k * 4 + 2]) / 255 * (d[k * 4 + 3] / 255));
      const lo = Math.min(...lum), span = Math.max(...lum) - lo || 1; // stretch contrast so dark icons still read
      let s = '';
      for (let y = 0; y < H; y++, s += '\n')
        for (let i = 0; i < W; i++) s += ramp[Math.min(9, Math.floor((lum[y * W + i] - lo) / span * 10))];
      asciiCache.set(m.id, s);
      $$(`pre.ascii[data-for="${CSS.escape(m.id)}"]`).forEach(el => (el.textContent = s));
    } catch {} // tainted canvas → no ASCII art
  };
  img.src = m.icon;
}

const LAYOUTS = {
  // coffee-table book: one spread per item
  book: ({ items, n }) => { const m = items[n]; return `
    <figure class="page art-page">${artHtml(m)}</figure>
    <div class="page text-page">
      <div class="slot-top"></div>
      <div class="copy">
        <div class="eyebrow">${esc(m.kicker)}</div>
        <h2 class="title ${m.title.length > 26 ? 'long' : ''}">${esc(m.title)}</h2>
        ${ledeHtml(m)}${specsHtml(m)}<div class="cta">${m.cta}</div>
      </div>
      <div class="strip">${items.map(x => `<button ${selAttrs(x, x === m, 'thumb')}>${iconOrGlyph(x)}</button>`).join('')}</div>
      <div class="hints"></div>
    </div>`; },

  // console home screen: full-bleed backdrop, info bottom-left, a row of tiles where the focused one grows
  carousel: ({ items, n }) => { const m = items[n]; return `
    <div class="car-bg a-fade" data-big="${esc(m.banner || m.icon ? '' : m.plate.big + m.plate.small)}">
      ${m.banner ? `<img class="car-cover" src="${esc(m.banner)}" alt="">` : m.icon ? `<img class="car-feat" src="${esc(m.icon)}" alt="">` : ''}</div>
    <div class="slot-top"></div>
    <div class="car-info">
      <div class="eyebrow a-rise">${esc(m.kicker)}</div>
      <h2 class="car-title a-rise">${esc(m.title)}</h2>
      <div class="car-meta a-rise">${m.specs.slice(0, 4).map(([k, v]) => `<span><small>${k}</small>${esc(v)}</span>`).join('')}</div>
      ${ledeHtml(m, 'car-lede a-rise')}
      <div class="cta a-rise">${m.cta}</div>
    </div>
    <div class="car-row">${items.map(x => `<button ${selAttrs(x, x === m, 'tile')}>${iconOrGlyph(x)}${x === m ? `<span class="tile-name">${esc(x.title)}</span>` : ''}</button>`).join('')}</div>
    <div class="hints"></div>`; },

  // frontend game list: big text list left, media and details right
  list: ({ items, n }) => { const m = items[n]; return `
    <div class="slot-top"></div>
    <div class="list-col">${items.map((x, k) => `<button ${selAttrs(x, x === m, 'lrow')}>
      <span class="lidx">${pad2(k + 1)}</span>${iconOrGlyph(x, 'licon')}<span class="lname">${esc(x.title)}</span><span class="lmeta">${esc(x.short)}</span></button>`).join('')}</div>
    <div class="detail-col">
      <figure class="media a-fade">${artHtml(m)}</figure>
      <div class="eyebrow a-rise">${esc(m.kicker)}</div>
      <h2 class="lay-title a-rise">${esc(m.title)}</h2>
      ${specsHtml(m)}${ledeHtml(m, 'lede a-rise')}
      <div class="cta a-rise">${m.cta}</div>
    </div>
    <div class="hints"></div>`; },

  // bookshelf: every item is a spine; the selected one is pulled out and shown as a cover
  shelf: ({ items, n }) => { const m = items[n]; return `
    <div class="slot-top"></div>
    <div class="shelf-stage">
      <div class="book3d a-pull"><div class="b-front">${m.banner ? `<img class="cover" src="${esc(m.banner)}" alt="">`
        : `<div class="b-cloth">${m.icon ? `<img src="${esc(m.icon)}" alt="">` : `<i>${esc(m.plate.big + m.plate.small)}</i>`}<b>${esc(m.title)}</b></div>`}</div></div>
      <div class="shelf-detail">
        <div class="eyebrow a-rise">${esc(m.kicker)}</div>
        <h2 class="lay-title a-rise">${esc(m.title)}</h2>
        ${ledeHtml(m, 'lede a-rise')}${specsHtml(m)}
        <div class="cta a-rise">${m.cta}</div>
      </div>
    </div>
    <div class="shelf"><div class="spines">${items.map(x => { const h = hue(x.id); return `<button ${selAttrs(x, x === m, 'spine', `--sh:${74 + h % 26}%;--sw:${48 + h % 22}px`)}
      data-band="${h % 3}">${x.icon ? `<img src="${esc(x.icon)}" alt="">` : ''}<span>${esc(x.title)}</span></button>`; }).join('')}</div></div>
    <div class="hints"></div>`; },

  // CRT text menu
  terminal: ({ items, n, label, ...ctx }) => { const m = items[n]; return `
    <div class="crt">
      <div class="slot-top"></div>
      <div class="term-head"><span>LUMEN 0.1 · ${esc(label.toUpperCase())}</span><span>RAM ${ctx.ram}M · ${new Date().toLocaleDateString(I18N.lang)}</span></div>
      <div class="term-main">
        <div class="term-list">${items.map((x, k) => `<button class="tl ${x === m ? 'on' : ''}" data-sel="${esc(x.id)}"><span class="tn">${pad2(k + 1)} ${esc(x.title.toUpperCase())}</span><span class="tm">${esc(x.short.toUpperCase())}</span></button>`).join('')}</div>
        <div class="term-detail">
          <pre class="ascii" data-for="${esc(m.id)}">${esc(asciiCache.get(m.id) || (m.icon ? '' : `\n\n   ${I18N.t('lay.no_image')}\n`))}</pre>
          <div class="tk">» ${esc(m.kicker.toUpperCase())}</div>
          <div class="tt">${esc(m.title.toUpperCase())}</div>
          ${m.specs.map(([k, v]) => `<div class="tkv"><span>${esc(k.toUpperCase())}</span><b>${esc(v)}</b></div>`).join('')}
          ${ledeHtml(m, 'term-lede')}
          <div class="cta">${m.cta}</div>
        </div>
      </div>
      <div class="term-prompt">C:\\LUMEN\\${esc(label.toUpperCase())}&gt; ${I18N.t('lay.open')} ${esc(m.id)}<i class="cursor">█</i></div>
      <div class="hints"></div>
    </div>`; },
};

// renders ctx into host with the active layout. The top bar (folio + ctx.controls) is a single node per host that gets
// moved into each new render's .slot-top, so a focused search field keeps focus and caret across re-renders.
function renderLayout(host, ctx, turnDir) {
  const name = LAYOUTS[state.layout] ? state.layout : 'book';
  if (!host.top) {
    host.top = document.createElement('div');
    host.top.className = 'top';
    host.top.innerHTML = `<span class="folio"></span><div class="row">${ctx.controls}</div>`;
    ctx.bind?.(host.top);
  }
  let shell = host.firstElementChild;
  if (shell?.dataset.layout !== name) {
    host.innerHTML = `<div class="lay lay-${name} ${name === 'book' ? 'book' : ''}" data-layout="${name}"></div>`;
    shell = host.firstElementChild;
    turnDir = turnDir || 'next';
  }
  const focused = host.top.contains(document.activeElement) ? document.activeElement : null, caret = focused?.selectionStart;
  const m = ctx.items[ctx.n];
  shell.dataset.id = m?.id || '';
  if (m) setVars(shell, m.color);
  shell.innerHTML = (m ? LAYOUTS[name](ctx)
    : `<div class="lay-empty"><div class="slot-top"></div><div><h2>${esc(ctx.empty?.[0] || '')}</h2><p>${esc(ctx.empty?.[1] || '')}</p></div></div>`)
    + `<div class="progress ${m && ctx.busy ? 'on' : ''}"><i></i></div>`;
  shell.querySelector('.slot-top').replaceWith(host.top);
  if (focused) { focused.focus(); focused.setSelectionRange?.(caret, caret); }
  host.top.querySelector('.folio').innerHTML = m ? I18N.t('lay.counter', { unit: ctx.unit, n: ctx.n + 1, total: ctx.total }) : I18N.t('lay.none');
  shell.querySelectorAll('.hints').forEach(h => (h.innerHTML = hints(ctx.hint)));
  if (turnDir) { shell.classList.remove('turn-next', 'turn-prev'); void shell.offsetWidth; shell.classList.add('turn-' + turnDir); }
  shell.querySelector('[data-sel].on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  ctx.items.forEach(x => extractColor(x.color));
  if (name === 'terminal' && m) asciiArt(m);
}
