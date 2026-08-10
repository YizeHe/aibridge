import { API } from './api.js';

/**
 * 图标顺序点击验证码。
 * 兼容两种 challenge 形状：
 * - @yunstorage/icon-captcha: items[].svg (完整 SVG 字符串)
 * - 简化版: items[].path (path d 属性)
 */
export async function mountIconCaptcha(container) {
  container.innerHTML = '<div class="field">正在加载验证码...</div>';
  const data = await API.get('/api/captcha/challenge');
  const ch = data.data && (data.data.items || data.data.token) ? data.data : data;
  const selected = [];
  container.innerHTML = '';
  container.dataset.token = ch.token || '';
  container.dataset.slots = '[]';

  const prompt = document.createElement('div');
  prompt.className = 'icon-captcha-prompt';
  prompt.textContent = ch.prompt || '请按提示顺序点击图标';

  const canvas = document.createElement('div');
  canvas.className = 'icon-captcha-canvas captcha-canvas';

  const status = document.createElement('div');
  status.className = 'field';
  status.style.fontSize = '0.78rem';
  status.style.marginTop = '0.35rem';
  status.textContent = '已选：0 / 3';

  const wrap = document.createElement('div');
  wrap.className = 'icon-captcha-widget';

  const items = ch.items || [];
  items.forEach((it) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'icon-captcha-item captcha-item';
    el.style.left = (it.x ?? 50) + '%';
    el.style.top = (it.y ?? 50) + '%';
    el.title = it.label || it.iconId || '';

    const glyph = document.createElement('span');
    glyph.className = 'icon-captcha-glyph';

    if (it.svg && String(it.svg).includes('<svg')) {
      glyph.innerHTML = it.svg;
    } else if (it.path && String(it.path).includes('<')) {
      glyph.innerHTML = it.path;
    } else if (it.path) {
      glyph.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${String(it.path).replace(/"/g, '')}"/></svg>`;
    } else if (it.glyph) {
      glyph.innerHTML = it.glyph;
    } else {
      // last resort: first letter of label, not "?"
      const label = (it.label || it.iconId || '·').toString();
      glyph.textContent = label.slice(0, 1).toUpperCase();
      glyph.style.fontWeight = '700';
      glyph.style.fontSize = '14px';
    }

    el.appendChild(glyph);
    el.onclick = () => {
      if (selected.includes(it.slotId)) return;
      selected.push(it.slotId);
      el.classList.add('selected');
      el.style.outline = '2px solid var(--accent, #5b8def)';
      el.style.outlineOffset = '2px';
      status.textContent = `已选：${selected.length} / 3`;
      container.dataset.slots = JSON.stringify(selected);
    };
    canvas.appendChild(el);
  });

  wrap.append(prompt, canvas, status);
  container.appendChild(wrap);

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
