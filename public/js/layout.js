/**
 * Dynamic layout helpers: floating orbs + responsive project card grid.
 * Card aspect ~3:2, columns computed from container width (no fixed positions).
 */

const ORB_COUNT = 6;

/** 背景球只生成一次，翻页 / resize 不再重排，避免「背景跟着变」 */
let worldSeeded = false;

/**
 * @param {HTMLElement | null} root
 * @param {{ force?: boolean }} [opts] force=true 仅主题切换等少数场景重建
 */
export function initWorld(root, opts = {}) {
  if (!root) return;
  const force = !!opts.force;
  if (worldSeeded && !force && root.querySelector('.orb')) return;

  root.querySelectorAll('.orb').forEach((n) => n.remove());
  const w = window.innerWidth || 1200;
  const h = window.innerHeight || 800;

  // 固定布局：用确定性位置，不随机跳变
  const slots = [
    { left: 8, top: 12, pink: true, size: 0.38 },
    { left: 62, top: 8, pink: false, size: 0.42 },
    { left: 78, top: 48, pink: true, size: 0.32 },
    { left: 12, top: 58, pink: false, size: 0.36 },
    { left: 42, top: 72, pink: true, size: 0.28 },
    { left: 55, top: 32, pink: false, size: 0.3 },
  ];

  for (let i = 0; i < ORB_COUNT; i++) {
    const s = slots[i] || slots[i % slots.length];
    const orb = document.createElement('div');
    orb.className = `orb ${s.pink ? 'orb--pink' : 'orb--blue'}`;
    const size = Math.round(Math.min(w, h) * s.size);
    orb.style.width = size + 'px';
    orb.style.height = size + 'px';
    orb.style.left = s.left + '%';
    orb.style.top = s.top + '%';
    // 极慢漂移，几乎不打扰；翻页时位置不变
    orb.style.setProperty('--dur', `${28 + i * 4}s`);
    orb.style.setProperty('--delay', `${-i * 3}s`);
    orb.style.setProperty('--dx1', `${12 + i * 2}px`);
    orb.style.setProperty('--dy1', `${-10 - i}px`);
    orb.style.setProperty('--dx2', `${-8 - i}px`);
    orb.style.setProperty('--dy2', `${8 + i}px`);
    root.appendChild(orb);
  }
  worldSeeded = true;
}

export function resetWorldSeed() {
  worldSeeded = false;
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
