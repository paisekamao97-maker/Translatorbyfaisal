'use strict';

/* ── Scroll reveal with stagger ── */
document.addEventListener('DOMContentLoaded', () => {
  const revealEls = document.querySelectorAll('.reveal');
  if (!revealEls.length) return;

  const obs = new IntersectionObserver(entries => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        const delay = parseFloat(e.target.dataset.delay || 0);
        setTimeout(() => e.target.classList.add('visible'), delay * 1000);
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  // Stagger siblings
  let lastParent = null, sibIdx = 0;
  revealEls.forEach(el => {
    if (el.parentElement === lastParent) sibIdx++;
    else { lastParent = el.parentElement; sibIdx = 0; }
    if (!el.dataset.delay) el.dataset.delay = sibIdx * 0.07;
    obs.observe(el);
  });

  /* Nav active link */
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });

  /* Ticker pause on hover */
  const ticker = document.querySelector('.ticker-inner');
  if (ticker) {
    ticker.addEventListener('mouseenter', () => ticker.style.animationPlayState = 'paused');
    ticker.addEventListener('mouseleave', () => ticker.style.animationPlayState = 'running');
  }
});

/* ── Toast helper ── */
function showToast(msg, ms = 3500) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}
