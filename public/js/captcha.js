import { API } from './api.js';

/** Icon-order captcha mount. Returns { token, slots } getters. */
export async function mountIconCaptcha(container) {
  container.innerHTML = '<div class="field">Loading verification...</div>';
  const data = await API.get('/api/captcha/challenge');
  const ch = data.data || data;
  const selected = [];
  container.innerHTML = '';
  container.dataset.token = ch.token || '';

  const prompt = document.createElement('div');
  prompt.className = 'field';
  prompt.style.marginBottom = '0.4rem';
  prompt.textContent = ch.prompt || 'Tap icons in order';

  const canvas = document.createElement('div');
  canvas.className = 'captcha-canvas';
  const status = document.createElement('div');
  status.className = 'field';
  status.style.fontSize = '0.78rem';
  status.textContent = 'Selected: 0 / 3';

  const items = ch.items || [];
  items.forEach((it) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'captcha-item';
    el.style.left = (it.x ?? 50) + '%';
    el.style.top = (it.y ?? 50) + '%';
    el.title = it.label || it.iconId || '';
    const path = it.path || it.glyph || '';
    if (String(path).includes('<')) {
      el.innerHTML = path;
    } else if (path) {
      el.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="${path}" fill="currentColor"/></svg>`;
    } else {
      el.textContent = (it.label || '?').slice(0, 2);
      el.style.fontSize = '11px';
    }
    el.onclick = () => {
      if (selected.includes(it.slotId)) return;
      selected.push(it.slotId);
      el.classList.add('selected');
      status.textContent = `Selected: ${selected.length} / 3`;
      container.dataset.slots = JSON.stringify(selected);
    };
    canvas.appendChild(el);
  });

  container.append(prompt, canvas, status);

  return {
    get token() {
      return container.dataset.token || '';
    },
    get slots() {
      try {
        return JSON.parse(container.dataset.slots || '[]');
      } catch {
        return [];
      }
    },
  };
}
