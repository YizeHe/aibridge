/**
 * Dynamic layout helpers: floating orbs + responsive project card grid.
 * Card aspect ~3:2, columns computed from container width (no fixed positions).
 */

const ORB_COUNT = 6;

export function initWorld(root) {
  if (!root) return;
  // remove previous orbs
  root.querySelectorAll('.orb').forEach((n) => n.remove());
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < ORB_COUNT; i++) {
    const orb = document.createElement('div');
    const pink = i % 2 === 0;
    orb.className = `orb ${pink ? 'orb--pink' : 'orb--blue'}`;
    const size = Math.round(Math.min(w, h) * (0.22 + Math.random() * 0.28));
    orb.style.width = size + 'px';
    orb.style.height = size + 'px';
    orb.style.left = Math.round(Math.random() * 85) + '%';
    orb.style.top = Math.round(Math.random() * 80) + '%';
    orb.style.setProperty('--dur', 14 + Math.random() * 12 + 's');
    orb.style.setProperty('--delay', -Math.random() * 10 + 's');
    orb.style.setProperty('--dx1', (20 + Math.random() * 40) * (Math.random() > 0.5 ? 1 : -1) + 'px');
    orb.style.setProperty('--dy1', (16 + Math.random() * 30) * (Math.random() > 0.5 ? 1 : -1) + 'px');
    orb.style.setProperty('--dx2', (18 + Math.random() * 36) * (Math.random() > 0.5 ? 1 : -1) + 'px');
    orb.style.setProperty('--dy2', (14 + Math.random() * 28) * (Math.random() > 0.5 ? 1 : -1) + 'px');
    root.appendChild(orb);
  }
}

/**
 * Fit as many ~3:2 cards as possible without crushing width.
 * Target card min width ~260px; gap scales with viewport.
 */
export function layoutProjectGrid(gridEl) {
  if (!gridEl) return { cols: 1, gap: 16 };
  const rect = gridEl.getBoundingClientRect();
  const width = Math.max(0, rect.width);
  const gap = width < 480 ? 12 : width < 900 ? 16 : 20;
  const minCard = width < 420 ? Math.max(160, width) : 260;
  let cols = Math.max(1, Math.floor((width + gap) / (minCard + gap)));
  // Prefer 1–4 columns; never force overflow
  cols = Math.min(4, cols);
  if (width < 360) cols = 1;
  gridEl.style.setProperty('--cols', String(cols));
  gridEl.style.setProperty('--gap', gap + 'px');
  return { cols, gap };
}

export function watchProjectGrid(gridEl) {
  if (!gridEl) return () => {};
  const apply = () => layoutProjectGrid(gridEl);
  apply();
  const ro = new ResizeObserver(() => apply());
  ro.observe(gridEl);
  window.addEventListener('resize', apply);
  return () => {
    ro.disconnect();
    window.removeEventListener('resize', apply);
  };
}

export function getTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function setTheme(mode) {
  const dark = mode === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem('aibridge-theme', dark ? 'dark' : 'light');
  } catch {
    /* ignore */
  }
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}
