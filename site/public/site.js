// page behaviour: language switch memory, layout/colour showcases, reveal on scroll
// the language links remember the choice, so "/" sends this visitor to it next time
document.querySelectorAll('[data-lang]').forEach(a => a.addEventListener('click', () => {
  document.cookie = `lang=${a.dataset.lang}; path=/; max-age=31536000; SameSite=Lax; Secure`;
}));
// layout tabs + colour swatches: swap the screenshot with a short fade
document.querySelectorAll('[data-show]').forEach(box => {
  const img = box.querySelector('[data-target]'), label = box.querySelector('[data-label]'), cap = box.querySelector('[data-caption]');
  const buttons = [...box.querySelectorAll('[data-img]')], tabs = box.dataset.show === 'layouts';
  const pick = b => {
    buttons.forEach(x => x.setAttribute(tabs ? 'aria-selected' : 'aria-pressed', x === b));
    const name = tabs ? b.querySelector('b').textContent : b.dataset.name;
    img.classList.add('fade');
    setTimeout(() => {
      img.src = `/img/${document.documentElement.dataset.img}/${b.dataset.img}.jpg`;
      img.alt = `${box.dataset.alt} ${name}`;
      img.onload = () => img.classList.remove('fade');
    }, 180);
    label.textContent = `${box.dataset.kind} · ${name}`;
    if (cap) cap.textContent = b.dataset.text;
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => pick(b));
    if (tabs) b.addEventListener('keydown', e => {
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const next = buttons[(i + d + buttons.length) % buttons.length];
      next.focus(); pick(next);
    });
  });
  buttons.forEach(b => { new Image().src = `/img/${document.documentElement.dataset.img}/${b.dataset.img}.jpg`; }); // warm the cache so switching is instant
});
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('.rv').forEach(el => io.observe(el));
