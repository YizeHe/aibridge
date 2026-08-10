/**
 * AIBridge SPA — liquid-glass project cards, light/dark theme, optional commercial pay.
 */
import { API } from './api.js';
import { mountIconCaptcha } from './captcha.js';
import {
  initWorld,
  watchProjectGrid,
  getTheme,
  toggleTheme,
} from './layout.js';

const state = {
  user: null,
  projects: [],
  projectId: null,
  messages: [],
  plans: null,
  commercial: false,
  error: '',
  notice: '',
  unsubGrid: null,
  es: null,
};

let glassModule = null;

async function loadGlass() {
  if (glassModule) return glassModule;
  try {
    glassModule = await import('/vendor/liquidglass/liquid-glass.js');
    return glassModule;
  } catch (e) {
    console.warn('liquid-glass unavailable', e);
    return null;
  }
}

function $(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function md(text) {
  if (window.marked && window.DOMPurify) {
    marked.setOptions({ gfm: true, breaks: true });
    return DOMPurify.sanitize(marked.parse(text || ''));
  }
  return escapeHtml(text).replace(/\n/g, '<br/>');
}

function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function themeIcon() {
  const dark = getTheme() === 'dark';
  // sun / moon as pure SVG paths — no emoji
  if (dark) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/></svg>`;
}

function setFlash(msg, isErr = false) {
  state.error = isErr ? msg : '';
  state.notice = isErr ? '' : msg;
}

async function ensureUser() {
  if (!API.token) {
    state.user = null;
    return null;
  }
  try {
    const r = await API.get('/api/me');
    if (!r.success) throw new Error(r.message || 'unauthorized');
    state.user = r.user || r.data;
    return state.user;
  } catch {
    API.setToken('');
    state.user = null;
    return null;
  }
}

async function loadPlans() {
  try {
    const r = await API.get('/api/plans');
    if (r.success) {
      state.commercial = !!r.commercial;
      state.plans = r.plans || [];
    }
  } catch {
    state.commercial = false;
    state.plans = null;
  }
}

function shell(content) {
  if (state.unsubGrid) {
    state.unsubGrid();
    state.unsubGrid = null;
  }
  const app = document.getElementById('app');
  app.innerHTML = '';
  const header = $(`
    <header class="topbar">
      <a class="brand" href="#/">AIBridge</a>
      <nav class="nav" id="nav"></nav>
    </header>`);
  const page = document.createElement('div');
  page.className = 'page';
  page.appendChild(content);
  app.append(header, page);

  const nav = header.querySelector('#nav');
  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'theme-toggle';
  themeBtn.title = 'Toggle light / dark';
  themeBtn.setAttribute('aria-label', 'Toggle theme');
  themeBtn.innerHTML = themeIcon();
  themeBtn.onclick = () => {
    toggleTheme();
    themeBtn.innerHTML = themeIcon();
    initWorld(document.getElementById('world'));
  };

  if (state.user) {
    nav.innerHTML = `
      <a href="#/app">Projects</a>
      <a href="#/account">Account</a>
      ${state.commercial ? '<a href="#/billing">Membership</a>' : ''}
      <button type="button" class="nav-link" id="logout">Sign out</button>`;
    nav.querySelector('#logout').onclick = async () => {
      try {
        await API.post('/api/auth/logout', {});
      } catch {
        /* ignore */
      }
      API.setToken('');
      state.user = null;
      location.hash = '#/';
      render();
    };
  } else {
    nav.innerHTML = `
      <a href="#/login">Sign in</a>
      <a class="btn btn-primary" href="#/register" style="text-decoration:none">Register</a>`;
  }
  nav.appendChild(themeBtn);

  if (state.error || state.notice) {
    const alert = document.createElement('div');
    alert.className = `alert ${state.error ? 'alert-error' : 'alert-ok'}`;
    alert.textContent = state.error || state.notice;
    page.prepend(alert);
    setTimeout(() => {
      state.error = '';
      state.notice = '';
      alert.remove();
    }, 4200);
  }
}

async function enhanceGlass(root) {
  const mod = await loadGlass();
  if (!mod?.autoBind) return;
  try {
    mod.autoBind(root || document);
  } catch (e) {
    console.warn(e);
  }
}

function viewHome() {
  const el = $(`
    <div>
      <section class="hero">
        <h1>Bridge the browser and your local AI agent</h1>
        <p>
          Create a project, connect an agent with your API key, and chat from the web.
          Demo: <a href="https://aibridge.tanstudio.me" target="_blank" rel="noopener">aibridge.tanstudio.me</a>
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/register" style="text-decoration:none">Get started</a>
          <a class="btn" href="#/login" style="text-decoration:none">Sign in</a>
        </div>
      </section>
      <div class="project-grid" id="feature-grid" style="--cols:3;--gap:16px">
        <article class="liquid-glass project-card" data-liquid-glass data-preset="soft" data-scale="42" data-radius="22">
          <h3>Project channels</h3>
          <p>Each project isolates pending messages between you and the agent.</p>
          <div class="meta"><span>API</span><span>/api/agent/*</span></div>
        </article>
        <article class="liquid-glass project-card" data-liquid-glass data-preset="crystal" data-scale="44" data-radius="22">
          <h3>Local agent client</h3>
          <p>Go binary or any HTTP client polls pending messages and posts replies.</p>
          <div class="meta"><span>Client</span><span>skills/</span></div>
        </article>
        <article class="liquid-glass project-card" data-liquid-glass data-preset="soft" data-scale="40" data-radius="22">
          <h3>Register and go</h3>
          <p>Icon captcha on register, session login, API key for agents.</p>
          <div class="meta"><span>Auth</span><span>session + key</span></div>
        </article>
      </div>
    </div>`);
  shell(el);
  const grid = el.querySelector('#feature-grid');
  state.unsubGrid = watchProjectGrid(grid);
  enhanceGlass(el);
}

function viewLogin() {
  const el = document.createElement('div');
  el.className = 'panel liquid-glass';
  el.dataset.liquidGlass = '';
  el.dataset.preset = 'soft';
  el.dataset.scale = '36';
  el.dataset.radius = '24';
  el.innerHTML = `
    <h1 style="margin:0 0 1rem;font-size:1.35rem">Sign in</h1>
    <form id="f">
      <label class="field">Username
        <input name="username" autocomplete="username" required />
      </label>
      <label class="field">Password
        <input name="password" type="password" autocomplete="current-password" required />
      </label>
      <button class="btn btn-primary" type="submit" style="width:100%">Sign in</button>
    </form>
    <p style="margin:1rem 0 0;font-size:0.88rem;color:var(--text-dim)">
      No account? <a href="#/register">Register</a>
    </p>`;
  shell(el);
  el.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const r = await API.post('/api/auth/login', {
      username: fd.get('username'),
      password: fd.get('password'),
    });
    if (!r.success) {
      setFlash(r.message || 'Login failed', true);
      render();
      return;
    }
    if (r.session) API.setToken(r.session);
    state.user = r.user;
    setFlash('Signed in');
    location.hash = '#/app';
    render();
  };
  enhanceGlass(el);
}

function viewRegister() {
  const el = document.createElement('div');
  el.className = 'panel liquid-glass';
  el.dataset.liquidGlass = '';
  el.dataset.preset = 'soft';
  el.dataset.scale = '36';
  el.dataset.radius = '24';
  el.innerHTML = `
    <h1 style="margin:0 0 1rem;font-size:1.35rem">Create account</h1>
    <form id="f">
      <label class="field">Username
        <input name="username" autocomplete="username" required minlength="2" maxlength="32" />
      </label>
      <label class="field">Password (min 8)
        <input name="password" type="password" autocomplete="new-password" required minlength="8" />
      </label>
      <div id="captcha" class="field"></div>
      <button class="btn btn-primary" type="submit" style="width:100%">Register</button>
    </form>
    <p style="margin:1rem 0 0;font-size:0.88rem;color:var(--text-dim)">
      Already have an account? <a href="#/login">Sign in</a>
    </p>`;
  shell(el);
  let cap = { token: '', slots: [] };
  mountIconCaptcha(el.querySelector('#captcha'))
    .then((c) => {
      cap = c;
    })
    .catch((err) => {
      setFlash(err.message || 'Captcha failed to load', true);
      render();
    });
  el.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const r = await API.post('/api/auth/register', {
      username: fd.get('username'),
      password: fd.get('password'),
      captcha_token: cap.token,
      captcha_slots: cap.slots,
    });
    if (!r.success) {
      setFlash(r.message || 'Register failed', true);
      render();
      return;
    }
    if (r.session) API.setToken(r.session);
    state.user = r.user;
    setFlash('Welcome — account created');
    location.hash = '#/app';
    render();
  };
  enhanceGlass(el);
}

async function viewProjects() {
  const u = await ensureUser();
  if (!u) {
    location.hash = '#/login';
    return render();
  }
  const list = await API.get('/api/projects');
  state.projects = list.projects || [];
  const el = $(`
    <div>
      <div class="section-head">
        <h2>Projects</h2>
        <button type="button" class="btn btn-primary" id="new-p">New project</button>
      </div>
      <div class="project-grid" id="pgrid"></div>
      <div id="empty" class="empty liquid-glass" data-liquid-glass data-preset="soft" data-scale="30" style="${state.projects.length ? 'display:none' : ''}">
        <div class="lg-content" style="text-align:center;padding:2rem">
          <p style="margin:0 0 0.75rem">No projects yet. Create one to start chatting with your agent.</p>
          <button type="button" class="btn btn-primary" id="new-p2">Create project</button>
        </div>
      </div>
    </div>`);
  shell(el);
  const grid = el.querySelector('#pgrid');
  for (const p of state.projects) {
    const card = $(`
      <article class="liquid-glass project-card" data-liquid-glass data-preset="crystal" data-scale="40" data-radius="22" data-id="${p.id}">
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.description || 'No description')}</p>
        <div class="meta">
          <span class="mono">${escapeHtml(p.slug)}</span>
          <div class="actions">
            <button type="button" data-open="${p.id}">Open</button>
            <button type="button" data-del="${p.id}">Delete</button>
          </div>
        </div>
      </article>`);
    // wrap content for glass
    const inner = document.createElement('div');
    // project-card structure: liquid-glass will wrap children into lg-content
    grid.appendChild(card);
  }
  // Fix: cards need content as direct children for liquid-glass wrap
  // Rebuild cards properly
  grid.innerHTML = '';
  for (const p of state.projects) {
    const card = document.createElement('article');
    card.className = 'liquid-glass project-card';
    card.dataset.liquidGlass = '';
    card.dataset.preset = 'crystal';
    card.dataset.scale = '40';
    card.dataset.radius = '22';
    card.innerHTML = `
      <h3>${escapeHtml(p.name)}</h3>
      <p>${escapeHtml(p.description || 'No description')}</p>
      <div class="meta">
        <span class="mono">${escapeHtml(p.slug)}</span>
        <div class="actions">
          <button type="button" data-open="${p.id}">Open</button>
          <button type="button" data-del="${p.id}">Delete</button>
        </div>
      </div>`;
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-del]')) return;
      if (ev.target.closest('[data-open]') || !ev.target.closest('.actions')) {
        location.hash = `#/chat/${p.id}`;
      }
    });
    grid.appendChild(card);
  }

  const create = async () => {
    const name = prompt('Project name');
    if (!name) return;
    const r = await API.post('/api/projects', { name, description: '' });
    if (!r.success) {
      setFlash(r.message || 'Create failed', true);
      render();
      return;
    }
    location.hash = `#/chat/${r.project.id}`;
    render();
  };
  el.querySelector('#new-p').onclick = create;
  el.querySelector('#new-p2')?.addEventListener('click', create);
  grid.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this project?')) return;
      const id = btn.getAttribute('data-del');
      const r = await API.del(`/api/projects/${id}`);
      if (!r.success) setFlash(r.message || 'Delete failed', true);
      render();
    };
  });
  state.unsubGrid = watchProjectGrid(grid);
  enhanceGlass(el);
}

async function viewChat(id) {
  const u = await ensureUser();
  if (!u) {
    location.hash = '#/login';
    return render();
  }
  state.projectId = Number(id);
  const pr = await API.get(`/api/projects/${id}`);
  if (!pr.success) {
    setFlash(pr.message || 'Project not found', true);
    location.hash = '#/app';
    return render();
  }
  const project = pr.project;
  const msgRes = await API.get(`/api/projects/${id}/messages`);
  state.messages = msgRes.messages || [];

  const el = $(`
    <div class="chat-layout">
      <div class="section-head" style="margin:0">
        <div>
          <a href="#/app" style="font-size:0.85rem;color:var(--text-dim)">Projects</a>
          <h2 style="margin:0.2rem 0 0">${escapeHtml(project.name)}</h2>
          <div class="mono" style="color:var(--text-faint);margin-top:0.15rem">slug: ${escapeHtml(project.slug)}</div>
        </div>
      </div>
      <div class="chat-log scroll-thin" id="log"></div>
      <form class="chat-compose" id="compose">
        <textarea name="text" rows="2" placeholder="Message your agent..." required></textarea>
        <button class="btn btn-primary" type="submit">Send</button>
      </form>
    </div>`);
  shell(el);
  const log = el.querySelector('#log');
  function paint() {
    log.innerHTML = '';
    for (const m of state.messages) {
      const b = document.createElement('div');
      b.className = `bubble ${m.role === 'user' ? 'user' : 'agent'}`;
      b.innerHTML = `<div class="who">${m.role === 'user' ? 'You' : 'Agent'} · ${fmtTime(m.ts || m.created_at)}</div><div class="msg-md">${md(m.text)}</div>`;
      log.appendChild(b);
    }
    log.scrollTop = log.scrollHeight;
  }
  paint();

  el.querySelector('#compose').onsubmit = async (e) => {
    e.preventDefault();
    const ta = e.target.text;
    const text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    const r = await API.post(`/api/projects/${id}/messages`, { text });
    if (!r.success) {
      setFlash(r.message || 'Send failed', true);
      return;
    }
    if (r.message) state.messages.push(r.message);
    else state.messages.push({ role: 'user', text, ts: new Date().toISOString() });
    paint();
  };

  // poll messages
  if (state.es) {
    try {
      state.es.close();
    } catch {
      /* */
    }
  }
  const poll = async () => {
    try {
      const r = await API.get(`/api/projects/${id}/messages`);
      if (r.success && Array.isArray(r.messages)) {
        const prev = state.messages.length;
        state.messages = r.messages;
        if (r.messages.length !== prev) paint();
      }
    } catch {
      /* */
    }
  };
  const timer = setInterval(poll, 2500);
  state.es = { close: () => clearInterval(timer) };
}

async function viewAccount() {
  const u = await ensureUser();
  if (!u) {
    location.hash = '#/login';
    return render();
  }
  const full = await API.get('/api/me');
  const user = full.user || u;
  const el = $(`
    <div class="panel-wide liquid-glass" data-liquid-glass data-preset="soft" data-scale="34" data-radius="24">
      <div class="lg-content" style="padding:1.4rem">
        <h2 style="margin:0 0 1rem">Account</h2>
        <div class="field">Username<div style="color:var(--text);font-weight:600">${escapeHtml(user.username)}</div></div>
        <div class="field">API Key
          <div class="mono" id="api-key">${escapeHtml(user.api_key || '')}</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.5rem 0 1rem">
          <button type="button" class="btn" id="copy-key">Copy key</button>
          <button type="button" class="btn" id="rotate-key">Rotate key</button>
        </div>
        ${
          state.commercial
            ? `<div class="field">Membership
            <div>${user.is_premium || user.plan === 'premium' ? 'Active' : 'Free'} ${user.premium_until ? '· until ' + escapeHtml(user.premium_until) : ''}</div>
          </div>
          <a class="btn btn-primary" href="#/billing" style="text-decoration:none">Manage membership</a>`
            : ''
        }
        <hr style="border:0;border-top:1px solid var(--line);margin:1.25rem 0" />
        <h3 style="margin:0 0 0.75rem;font-size:1rem">Change password</h3>
        <form id="pw">
          <label class="field">Current password<input type="password" name="old_password" required /></label>
          <label class="field">New password<input type="password" name="new_password" required minlength="8" /></label>
          <button class="btn" type="submit">Update password</button>
        </form>
      </div>
    </div>`);
  shell(el);
  el.querySelector('#copy-key').onclick = async () => {
    try {
      await navigator.clipboard.writeText(user.api_key || '');
      setFlash('API key copied');
    } catch {
      setFlash('Copy failed', true);
    }
    render();
  };
  el.querySelector('#rotate-key').onclick = async () => {
    if (!confirm('Rotate API key? Agents using the old key will stop working.')) return;
    const r = await API.post('/api/apikey/rotate', {});
    if (!r.success) setFlash(r.message || 'Rotate failed', true);
    else setFlash('API key rotated');
    render();
  };
  el.querySelector('#pw').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const r = await API.post('/api/auth/password', {
      old_password: fd.get('old_password'),
      new_password: fd.get('new_password'),
    });
    setFlash(r.message || (r.success ? 'Password updated' : 'Failed'), !r.success);
    render();
  };
  enhanceGlass(el);
}

async function viewBilling() {
  const u = await ensureUser();
  if (!u) {
    location.hash = '#/login';
    return render();
  }
  await loadPlans();
  if (!state.commercial) {
    location.hash = '#/account';
    return render();
  }
  const plans = state.plans?.length
    ? state.plans
    : [
        { id: 'monthly', name: 'Monthly', price: 5, period: 'month' },
        { id: 'yearly', name: 'Yearly', price: 50, period: 'year' },
      ];
  const el = $(`
    <div>
      <div class="section-head"><h2>Membership</h2></div>
      <p style="color:var(--text-dim);margin:0 0 1.25rem;max-width:36rem">
        Self-service plans. After payment succeeds, premium access is extended automatically.
      </p>
      <div class="price-grid" id="prices"></div>
    </div>`);
  shell(el);
  const grid = el.querySelector('#prices');
  for (const p of plans) {
    const card = document.createElement('article');
    card.className = 'liquid-glass price-card';
    card.dataset.liquidGlass = '';
    card.dataset.preset = 'soft';
    card.dataset.scale = '38';
    card.dataset.radius = '22';
    card.innerHTML = `
      <h3 style="margin:0">${escapeHtml(p.name || p.id)}</h3>
      <div class="price">${Number(p.price).toFixed(0)}<span> CNY / ${escapeHtml(p.period || '')}</span></div>
      <p style="margin:0;color:var(--text-dim);font-size:0.9rem">Unlimited projects while membership is active.</p>
      <div style="display:flex;flex-wrap:wrap;gap:0.45rem;margin-top:0.5rem">
        <button type="button" class="btn btn-primary" data-plan="${p.id}" data-pay="alipay">Alipay</button>
        <button type="button" class="btn" data-plan="${p.id}" data-pay="wxpay">WeChat Pay</button>
      </div>`;
    grid.appendChild(card);
  }
  grid.querySelectorAll('button[data-plan]').forEach((btn) => {
    btn.onclick = async () => {
      const plan = btn.getAttribute('data-plan');
      const payType = btn.getAttribute('data-pay');
      btn.disabled = true;
      const r = await API.post('/api/pay/create', { plan, payType });
      btn.disabled = false;
      if (!r.success) {
        setFlash(r.message || 'Payment create failed', true);
        render();
        return;
      }
      if (r.payUrl) {
        location.href = r.payUrl;
        return;
      }
      setFlash('No pay URL returned', true);
      render();
    };
  });
  enhanceGlass(el);
}

async function render() {
  initWorld(document.getElementById('world'));
  await loadPlans();
  const hash = location.hash || '#/';
  const path = hash.replace(/^#/, '') || '/';

  if (path === '/' || path === '') return viewHome();
  if (path === '/login') return viewLogin();
  if (path === '/register') return viewRegister();
  if (path === '/app' || path === '/projects') return viewProjects();
  if (path === '/account') return viewAccount();
  if (path === '/billing') return viewBilling();
  const chat = path.match(/^\/chat\/(\d+)/);
  if (chat) return viewChat(chat[1]);

  // default
  if (API.token) {
    location.hash = '#/app';
    return viewProjects();
  }
  return viewHome();
}

window.addEventListener('hashchange', () => render());
window.addEventListener('resize', () => initWorld(document.getElementById('world')));

// boot
(async () => {
  await ensureUser();
  await render();
})();
