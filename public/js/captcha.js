async function mountIconCaptcha(container) {
  container.innerHTML = '<div class="text-sm text-slate-400">Loading captcha...</div>';
  const data = await API.get('/api/captcha/challenge');
  // createChallenge may return fields at top-level or under data
  const ch = data.data || data;
  const selected = [];
  container.innerHTML = '';
  container.dataset.token = ch.token || '';
  container.dataset.slots = '[]';

  const prompt = document.createElement('div');
  prompt.className = 'text-sm text-slate-300 mb-2';
  prompt.textContent = ch.prompt || 'Complete captcha';

  const canvas = document.createElement('div');
  canvas.className = 'captcha-canvas mb-2';
  const status = document.createElement('div');
  status.className = 'text-xs text-slate-400';
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
      el.innerHTML = `<svg viewBox="0 0 24 24"><path d="${path}" fill="currentColor"/></svg>`;
    } else {
      el.textContent = (it.label || '?').slice(0, 2);
      el.style.fontSize = '11px';
      el.style.color = '#0f172a';
    }
    el.onclick = () => {
      if (selected.includes(it.slotId)) return;
      selected.push(it.slotId);
      el.classList.add('selected');
      status.textContent = 'Selected: ' + selected.length + ' / 3';
      container.dataset.slots = JSON.stringify(selected);
      if (selected.length >= 3) {
        status.textContent = 'Ready (3 icons selected)';
        status.className = 'text-xs text-emerald-400';
      }
    };
    canvas.appendChild(el);
  });

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'text-xs text-sky-400 mt-1';
  reset.textContent = 'Reload captcha';
  reset.onclick = () => mountIconCaptcha(container);

  container.appendChild(prompt);
  container.appendChild(canvas);
  container.appendChild(status);
  container.appendChild(reset);
}
