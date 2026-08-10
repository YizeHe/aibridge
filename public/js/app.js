/**
 * AIBridge 前端 SPA — 中文界面、液态玻璃项目卡片、明暗主题、商业会员
 */
import { API } from './api.js';
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
  turnstileSiteKey: '',
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
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return String(iso);
  }
}

function themeIcon() {
  const dark = getTheme() === 'dark';
  if (dark) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/></svg>`;
}

function setFlash(msg, isErr = false) {
  state.error = isErr ? msg : '';
  state.notice = isErr ? '' : msg;
}

const SKILLS_URL = 'https://aibridge.tanstudio.me/skills/SKILLS.md';

/** 组装发给 AI 的提示词（含 SKILLS 链接 + 当前用户 API Key） */
function buildSkillsPrompt(apiKey) {
  const keyLine = apiKey
    ? `我的 API Key：${apiKey}`
    : '我的 API Key：（请先在网站登录后重新复制提示词）';
  return [
    `请打开并严格按照 SKILLS 说明操作：${SKILLS_URL}`,
    keyLine,
    '请用上述 Key 连接 AIBridge，按 SKILLS 下载/运行本地 Agent，并与我当前项目互通。',
  ].join('\n');
}

/** 给 AI 用的 SKILLS：仅一键复制提示词（含 API Key） */
function skillsBlock() {
  return `
    <section class="skills-block liquid-glass">
      <h3 style="margin:0;font-size:1.05rem">SKILLS（给 AI）</h3>
      <p style="margin:0;color:var(--text-dim);font-size:0.9rem;line-height:1.55">
        一键复制提示词发给 AI（已含 SKILLS 链接与你的 API Key）。登录后复制最完整。
      </p>
      <div class="skills-actions">
        <button type="button" class="btn btn-primary" id="copy-skills-prompt">复制提示词给 AI</button>
      </div>
    </section>`;
}

async function resolveApiKeyForCopy() {
  if (state.user?.api_key) return state.user.api_key;
  try {
    const r = await API.get('/api/me');
    if (r.success && (r.user || r.data)) {
      state.user = r.user || r.data;
      return state.user.api_key || '';
    }
  } catch {
    /* not logged in */
  }
  return '';
}

function bindSkillsCopy(root) {
  const btn = root.querySelector('#copy-skills-prompt');
  if (!btn) return;
  btn.onclick = async () => {
    try {
      const apiKey = await resolveApiKeyForCopy();
      if (!apiKey) {
        setFlash('请先登录后再复制（提示词需带上你的 API Key）', true);
        return;
      }
      await navigator.clipboard.writeText(buildSkillsPrompt(apiKey));
      setFlash('提示词已复制（含 API Key）');
    } catch {
      setFlash('复制失败，请手动复制', true);
    }
  };
}

function loadTurnstileScript() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const existing = document.getElementById('cf-turnstile-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      return;
    }
    const s = document.createElement('script');
    s.id = 'cf-turnstile-script';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Turnstile 脚本加载失败'));
    document.head.appendChild(s);
  });
}

async function mountTurnstile(container, siteKey) {
  container.innerHTML = '';
  if (!siteKey) {
    container.innerHTML =
      '<div class="field" style="color:var(--danger)">未配置 Turnstile Site Key</div>';
    return { getToken: () => '' };
  }
  await loadTurnstileScript();
  const holder = document.createElement('div');
  container.appendChild(holder);
  let token = '';
  const widgetId = window.turnstile.render(holder, {
    sitekey: siteKey,
    theme: getTheme() === 'dark' ? 'dark' : 'light',
    callback: (t) => {
      token = t || '';
    },
    'expired-callback': () => {
      token = '';
    },
    'error-callback': () => {
      token = '';
    },
  });
  return {
    getToken: () => token,
    reset: () => {
      token = '';
      try {
        window.turnstile.reset(widgetId);
      } catch {
        /* */
      }
    },
  };
}

function backLink(href = '#/', label = '返回') {
  return `<a class="page-back" href="${href}">← ${label}</a>`;
}

function showFormModal(host, { title, fields, submitText, onSubmit }) {
  host.innerHTML = `
    <div class="modal-mask" id="form-modal">
      <div class="modal-card">
        <h3>${escapeHtml(title)}</h3>
        <form id="modal-form">
          ${fields
            .map(
              (f) => `
            <label class="field">${escapeHtml(f.label)}
              <input name="${escapeHtml(f.name)}" type="${f.type || 'text'}"
                ${f.required ? 'required' : ''}
                ${f.placeholder ? `placeholder="${escapeHtml(f.placeholder)}"` : ''}
                ${f.value ? `value="${escapeHtml(f.value)}"` : ''} />
            </label>`
            )
            .join('')}
          <div class="modal-actions">
            <button type="button" class="btn" id="modal-cancel">取消</button>
            <button type="submit" class="btn btn-primary">${escapeHtml(submitText || '确定')}</button>
          </div>
        </form>
      </div>
    </div>`;
  host.querySelector('#modal-cancel').onclick = () => {
    host.innerHTML = '';
  };
  host.querySelector('#modal-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    await onSubmit(data);
    host.innerHTML = '';
  };
}

async function ensureUser() {
  if (!API.token) {
    state.user = null;
    return null;
  }
  try {
    const r = await API.get('/api/me');
    if (!r.success) throw new Error(r.message || '未登录');
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
      state.turnstileSiteKey = r.turnstile_site_key || state.turnstileSiteKey || '';
    }
  } catch {
    state.commercial = false;
    state.plans = null;
  }
  if (!state.turnstileSiteKey) {
    try {
      const c = await API.get('/api/config');
      if (c.success) state.turnstileSiteKey = c.turnstile_site_key || '';
    } catch {
      /* */
    }
  }
}

/**
 * @param {HTMLElement} content
 * @param {{ backHref?: string, backLabel?: string } | null} opts
 */
function shell(content, opts = null) {
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
  if (opts && opts.backHref) {
    const back = document.createElement('a');
    back.className = 'page-back';
    back.href = opts.backHref;
    back.textContent = `← ${opts.backLabel || '返回'}`;
    page.appendChild(back);
  }
  page.appendChild(content);
  app.append(header, page);

  const nav = header.querySelector('#nav');
  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'theme-toggle';
  themeBtn.title = '切换浅色 / 深色';
  themeBtn.setAttribute('aria-label', '切换主题');
  themeBtn.innerHTML = themeIcon();
  themeBtn.onclick = () => {
    toggleTheme();
    themeBtn.innerHTML = themeIcon();
    initWorld(document.getElementById('world'));
  };

  if (state.user) {
    const isAdmin = state.user.role === 'admin';
    nav.innerHTML = `
      <a href="#/app">项目</a>
      <a href="#/account">账号</a>
      ${state.commercial ? '<a href="#/billing">会员</a>' : ''}
      ${isAdmin ? '<a href="#/admin">用户管理</a>' : ''}
      <a href="#/skills">SKILLS</a>
      <button type="button" class="nav-link" id="logout">退出</button>`;
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
      <a href="#/skills">SKILLS</a>
      <a href="#/login">登录</a>
      <a class="btn btn-primary" href="#/register" style="text-decoration:none">注册</a>`;
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
        <h1>浏览器与本地 AI Agent 的云端互通桥</h1>
        <p>
          注册账号、创建项目、用 API Key 连接本地 Agent，在网页里对话。
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/register" style="text-decoration:none">立即注册</a>
          <a class="btn" href="#/login" style="text-decoration:none">登录</a>
          <a class="btn" href="#/skills" style="text-decoration:none">复制提示词</a>
        </div>
      </section>
      <div class="project-grid" id="feature-grid" style="--cols:3;--gap:16px"></div>
      <div style="margin-top:1.75rem">${skillsBlock()}</div>
    </div>`);
  shell(el);
  bindSkillsCopy(el);
  const grid = el.querySelector('#feature-grid');
  const features = [
    {
      title: '项目通道',
      desc: '每个项目独立隔离消息，用户网页与本地 Agent 按项目互通。',
      meta: ['接口', '/api/agent/*'],
    },
    {
      title: '本地 Agent',
      desc: 'Go 客户端或任意 HTTP 工具轮询待处理消息并推送回复。',
      meta: ['说明', 'SKILLS.md'],
    },
    {
      title: '注册即用',
      desc: '图标验证码注册、会话登录，账号页复制 API Key 即可接入。',
      meta: ['鉴权', '会话 + Key'],
    },
  ];
  for (const f of features) {
    const card = document.createElement('article');
    // 轻量毛玻璃，不用重 refraction 避免裁字
    card.className = 'liquid-glass feature-card';
    card.innerHTML = `
      <h3>${escapeHtml(f.title)}</h3>
      <p>${escapeHtml(f.desc)}</p>
      <div class="meta"><span>${escapeHtml(f.meta[0])}</span><span class="mono">${escapeHtml(f.meta[1])}</span></div>`;
    grid.appendChild(card);
  }
  state.unsubGrid = watchProjectGrid(grid);
}

function viewSkills() {
  const el = $(`
    <div class="panel-wide">
      <div class="section-head">
        <h2>SKILLS 提示词</h2>
      </div>
      <p style="color:var(--text-dim);margin:0 0 1.25rem;line-height:1.6;max-width:40rem">
        登录后点击复制，提示词会带上 SKILLS 链接与你的 API Key，直接发给 AI 即可接入。
      </p>
      ${skillsBlock()}
      <div class="liquid-glass" style="margin-top:1rem">
        <h3 style="margin:0 0 0.5rem;font-size:1rem">接入步骤</h3>
        <ol style="margin:0;padding-left:1.25rem;color:var(--text-dim);line-height:1.7;font-size:0.92rem">
          <li>注册并登录</li>
          <li>创建一个项目（可选：在提示词里告诉 AI 项目名）</li>
          <li>复制提示词发给 AI（已含 Key 与 SKILLS 链接）</li>
          <li>AI 启动本地 Agent 后，在网页项目里发消息即可</li>
        </ol>
      </div>
    </div>`);
  shell(el, { backHref: '#/', backLabel: '返回首页' });
  bindSkillsCopy(el);
}

function viewLogin() {
  const el = document.createElement('div');
  el.className = 'panel liquid-glass';
  el.dataset.liquidGlass = '';
  el.dataset.preset = 'soft';
  el.dataset.scale = '36';
  el.dataset.radius = '24';
  el.innerHTML = `
    <h1 style="margin:0 0 1rem;font-size:1.35rem">登录</h1>
    <form id="f">
      <label class="field">用户名
        <input name="username" autocomplete="username" required />
      </label>
      <label class="field">密码
        <input name="password" type="password" autocomplete="current-password" required />
      </label>
      <button class="btn btn-primary" type="submit" style="width:100%">登录</button>
    </form>
    <p style="margin:1rem 0 0;font-size:0.88rem;color:var(--text-dim)">
      没有账号？ <a href="#/register">注册</a>
    </p>`;
  shell(el, { backHref: '#/', backLabel: '返回首页' });
  el.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const r = await API.post('/api/auth/login', {
      username: fd.get('username'),
      password: fd.get('password'),
    });
    if (!r.success) {
      setFlash(r.message || '登录失败', true);
      render();
      return;
    }
    if (r.session) API.setToken(r.session);
    state.user = r.user;
    setFlash('登录成功');
    location.hash = '#/app';
    render();
  };
}

async function viewRegister() {
  await loadPlans();
  const el = document.createElement('div');
  el.className = 'panel liquid-glass';
  el.innerHTML = `
    <h1 style="margin:0 0 1rem;font-size:1.35rem">注册</h1>
    <form id="f">
      <label class="field">用户名
        <input name="username" autocomplete="username" required minlength="2" maxlength="32" />
      </label>
      <label class="field">密码（至少 8 位）
        <input name="password" type="password" autocomplete="new-password" required minlength="8" />
      </label>
      <div id="turnstile" class="field" style="min-height:70px"></div>
      <button class="btn btn-primary" type="submit" style="width:100%">注册</button>
    </form>
    <p style="margin:1rem 0 0;font-size:0.88rem;color:var(--text-dim)">
      已有账号？ <a href="#/login">登录</a>
    </p>`;
  shell(el, { backHref: '#/', backLabel: '返回首页' });
  let ts = { getToken: () => '', reset: () => {} };
  try {
    ts = await mountTurnstile(el.querySelector('#turnstile'), state.turnstileSiteKey);
  } catch (err) {
    setFlash(err.message || '人机验证加载失败', true);
  }
  el.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const token = ts.getToken();
    if (!token) {
      setFlash('请先完成人机验证', true);
      return;
    }
    const r = await API.post('/api/auth/register', {
      username: fd.get('username'),
      password: fd.get('password'),
      turnstile_token: token,
    });
    if (!r.success) {
      setFlash(r.message || '注册失败', true);
      ts.reset();
      return;
    }
    if (r.session) API.setToken(r.session);
    state.user = r.user;
    setFlash('注册成功');
    location.hash = '#/app';
    render();
  };
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
        <h2>我的项目</h2>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem">
          <a class="btn" href="#/skills" style="text-decoration:none">复制提示词</a>
          <button type="button" class="btn btn-primary" id="new-p">新建项目</button>
        </div>
      </div>
      <div class="project-grid" id="pgrid"></div>
      <div id="empty" class="empty liquid-glass" style="${state.projects.length ? 'display:none' : ''}">
        <p style="margin:0 0 0.75rem">还没有项目。创建一个，即可与本地 Agent 对话。</p>
        <button type="button" class="btn btn-primary" id="new-p2">创建项目</button>
      </div>
      <div style="margin-top:1.5rem">${skillsBlock()}</div>
      <div id="modal-host"></div>
    </div>`);
  shell(el, { backHref: '#/', backLabel: '返回首页' });
  bindSkillsCopy(el);
  const grid = el.querySelector('#pgrid');
  const modalHost = el.querySelector('#modal-host');
  grid.innerHTML = '';
  for (const p of state.projects) {
    const card = document.createElement('article');
    card.className = 'liquid-glass project-card';
    card.innerHTML = `
      <h3>${escapeHtml(p.name)}</h3>
      <p>${escapeHtml(p.description || '暂无描述')}</p>
      <div class="meta">
        <span class="mono">${escapeHtml(p.slug)}</span>
      </div>
      <div class="actions">
        <button type="button" data-open="${p.id}">打开</button>
        <button type="button" data-del="${p.id}">删除</button>
      </div>`;
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-del]')) return;
      if (ev.target.closest('[data-open]') || !ev.target.closest('.actions')) {
        location.hash = `#/chat/${p.id}`;
      }
    });
    grid.appendChild(card);
  }

  const create = () => {
    showFormModal(modalHost, {
      title: '新建项目',
      submitText: '创建',
      fields: [
        { name: 'name', label: '项目名称', required: true, placeholder: '例如 cloud-demo' },
        { name: 'description', label: '描述（可选）', placeholder: '一句话说明' },
      ],
      onSubmit: async (data) => {
        const r = await API.post('/api/projects', {
          name: data.name,
          description: data.description || '',
        });
        if (!r.success) {
          setFlash(r.message || '创建失败', true);
          render();
          return;
        }
        location.hash = `#/chat/${r.project.id}`;
        render();
      },
    });
  };
  el.querySelector('#new-p').onclick = create;
  el.querySelector('#new-p2')?.addEventListener('click', create);
  grid.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('确定删除该项目？')) return;
      const id = btn.getAttribute('data-del');
      const r = await API.del(`/api/projects/${id}`);
      if (!r.success) setFlash(r.message || '删除失败', true);
      render();
    };
  });
  state.unsubGrid = watchProjectGrid(grid);
}

function langForPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    jsx: 'javascript',
    json: 'json',
    css: 'css',
    html: 'xml',
    htm: 'xml',
    md: 'markdown',
    py: 'python',
    go: 'go',
    rs: 'rust',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    sh: 'bash',
    bash: 'bash',
    sql: 'sql',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
  };
  return map[ext] || 'plaintext';
}

function isImagePath(path, ct = '') {
  if (ct.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(path || '');
}

function isMarkdownPath(path) {
  return /\.(md|markdown)$/i.test(path || '');
}

function altAiPath(path, version) {
  const i = path.lastIndexOf('.');
  if (i > 0) {
    return `${path.slice(0, i)}.ai-v${version}${path.slice(i)}`;
  }
  return `${path}.ai-v${version}`;
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
    setFlash(pr.message || '项目不存在', true);
    location.hash = '#/app';
    return render();
  }
  const project = pr.project;
  const msgRes = await API.get(`/api/projects/${id}/messages`);
  state.messages = msgRes.messages || [];

  /** @type {{path:string, content:string, version:number, content_type:string, encoding:string, dirty:boolean, remote?:any, pendingMerge?:any}|null} */
  let openFile = null;
  let filesMeta = [];
  let filesOpen = false;
  let mdSource = false;
  let sinceFiles = new Date(0).toISOString();
  /** @type {Array<{path:string, userContent:string, aiContent:string, aiVersion:number, content_type:string, encoding:string}>} */
  let pendingMerges = [];

  const el = $(`
    <div class="chat-layout">
      <div class="section-head" style="margin:0">
        <div style="display:flex;align-items:center;gap:0.5rem;min-width:0">
          <button type="button" class="btn" id="btn-files">文件</button>
          <div style="min-width:0">
            <a href="#/app" style="font-size:0.85rem;color:var(--text-dim)">返回项目</a>
            <h2 style="margin:0.15rem 0 0;font-size:1.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(project.name)}</h2>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center">
          <button type="button" class="btn btn-primary" id="btn-merge-top" style="display:none">合并</button>
          <a class="btn" href="#/skills" style="text-decoration:none">SKILLS</a>
        </div>
      </div>
      <div class="ws-shell" id="ws">
        <aside class="ws-files" id="files-pane">
          <div class="ws-files-head">
            <span>项目文件</span>
            <button type="button" class="btn" id="btn-new-file" style="padding:0.25rem 0.5rem;font-size:0.78rem">新建</button>
          </div>
          <div class="ws-files-list" id="file-list"></div>
        </aside>
        <div class="ws-main">
          <div class="chat-log scroll-thin" id="log"></div>
          <form class="chat-compose" id="compose">
            <textarea name="text" rows="2" placeholder="给 Agent 发消息...（Enter 发送，Shift+Enter 换行）" required></textarea>
            <button class="btn btn-primary" type="submit">发送</button>
          </form>
        </div>
        <section class="ws-editor" id="editor-pane">
          <div class="ws-conflict-banner" id="conflict-banner"></div>
          <div class="ws-editor-head">
            <div style="display:flex;align-items:center;gap:0.45rem;min-width:0">
              <span class="ws-editor-title mono" id="ed-title">未打开文件</span>
              <span class="ws-dirty" id="ed-dirty" style="display:none">已修改</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:0.35rem">
              <button type="button" class="btn" id="ed-md-toggle" style="display:none">源码</button>
              <button type="button" class="btn" id="ed-save">保存</button>
              <button type="button" class="btn" id="ed-close">关闭</button>
            </div>
          </div>
          <div class="ws-editor-body" id="ed-body"></div>
        </section>
      </div>
      <div id="modal-host"></div>
    </div>`);
  shell(el, { backHref: '#/app', backLabel: '返回项目列表' });

  const ws = el.querySelector('#ws');
  const log = el.querySelector('#log');
  const fileList = el.querySelector('#file-list');
  const edBody = el.querySelector('#ed-body');
  const edTitle = el.querySelector('#ed-title');
  const edDirty = el.querySelector('#ed-dirty');
  const conflictBanner = el.querySelector('#conflict-banner');
  const btnMergeTop = el.querySelector('#btn-merge-top');
  const btnMd = el.querySelector('#ed-md-toggle');
  const modalHost = el.querySelector('#modal-host');

  function paintMessages() {
    log.innerHTML = '';
    for (const m of state.messages) {
      const b = document.createElement('div');
      b.className = `bubble ${m.role === 'user' ? 'user' : 'agent'}`;
      b.innerHTML = `<div class="who">${m.role === 'user' ? '我' : 'Agent'} · ${fmtTime(m.ts || m.created_at)}</div><div class="msg-md">${md(m.text)}</div>`;
      log.appendChild(b);
    }
    log.scrollTop = log.scrollHeight;
  }
  paintMessages();

  function updateShellClass() {
    ws.classList.toggle('files-open', filesOpen);
    ws.classList.toggle('split', !!openFile);
    btnMergeTop.style.display = pendingMerges.length ? '' : 'none';
    btnMergeTop.textContent = pendingMerges.length > 1 ? `合并(${pendingMerges.length})` : '合并';
  }

  function paintFileList() {
    fileList.innerHTML = '';
    if (!filesMeta.length) {
      fileList.innerHTML = `<div style="padding:0.75rem;color:var(--text-dim);font-size:0.85rem">暂无文件。Agent 可通过 API 写入，或点「新建」。</div>`;
      return;
    }
    for (const f of filesMeta) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ws-file-item' + (openFile?.path === f.path ? ' active' : '');
      btn.innerHTML = `<span class="mono" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span>`;
      btn.onclick = () => openFilePath(f.path);
      fileList.appendChild(btn);
    }
  }

  function renderEditor() {
    if (!openFile) {
      updateShellClass();
      return;
    }
    updateShellClass();
    edTitle.textContent = openFile.path;
    edDirty.style.display = openFile.dirty ? '' : 'none';
    conflictBanner.classList.toggle('show', !!openFile.pendingMerge);
    if (openFile.pendingMerge) {
      conflictBanner.textContent = '检测到 AI 改动与本地编辑冲突，可点右上角「合并」处理。';
    }
    const ct = openFile.content_type || '';
    const path = openFile.path;
    edBody.innerHTML = '';

    if (isImagePath(path, ct) && openFile.encoding === 'base64') {
      btnMd.style.display = 'none';
      const box = document.createElement('div');
      box.className = 'img-preview';
      const img = document.createElement('img');
      img.alt = path;
      img.src = `data:${ct || 'image/png'};base64,${openFile.content}`;
      box.appendChild(img);
      edBody.appendChild(box);
      return;
    }

    if (isMarkdownPath(path) && !mdSource) {
      btnMd.style.display = '';
      btnMd.textContent = '源码';
      const prev = document.createElement('div');
      prev.className = 'md-preview msg-md';
      prev.innerHTML = md(openFile.content);
      edBody.appendChild(prev);
      return;
    }

    if (isMarkdownPath(path)) {
      btnMd.style.display = '';
      btnMd.textContent = '预览';
    } else {
      btnMd.style.display = 'none';
    }

    const ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.value = openFile.content;
    ta.oninput = () => {
      openFile.content = ta.value;
      openFile.dirty = true;
      edDirty.style.display = '';
    };
    edBody.appendChild(ta);

    // optional highlight via pre if hljs available and not dirty editing focus - keep textarea for edit
    if (window.hljs && !openFile.dirty) {
      // keep textarea for editing; users need to type
    }
  }

  async function refreshFiles() {
    const r = await API.get(`/api/projects/${id}/files`);
    if (r.success) {
      filesMeta = r.files || [];
      paintFileList();
    }
  }

  async function openFilePath(path) {
    // save dirty warning
    if (openFile?.dirty && openFile.path !== path) {
      if (!confirm('当前文件有未保存修改，切换将保留在本地缓冲，是否继续？')) return;
    }
    const r = await API.get(`/api/projects/${id}/files/content?path=${encodeURIComponent(path)}`);
    if (!r.success) {
      setFlash(r.message || '打开失败', true);
      return;
    }
    const f = r.file;
    openFile = {
      path: f.path,
      content: f.content || '',
      version: f.version,
      content_type: f.content_type,
      encoding: f.encoding || 'utf8',
      dirty: false,
    };
    mdSource = false;
    renderEditor();
    paintFileList();
  }

  async function saveOpenFile() {
    if (!openFile) return;
    if (openFile.encoding === 'base64' && isImagePath(openFile.path, openFile.content_type)) {
      setFlash('图片暂请通过 Agent 覆盖写入', true);
      return;
    }
    const r = await API.request(`/api/projects/${id}/files`, {
      method: 'PUT',
      body: {
        path: openFile.path,
        content: openFile.content,
        encoding: openFile.encoding || 'utf8',
        content_type: openFile.content_type,
        base_version: openFile.version,
      },
    });
    if (!r.success) {
      if (r._status === 409 && r.file) {
        openFile.pendingMerge = {
          path: openFile.path,
          userContent: openFile.content,
          aiContent: r.file.content,
          aiVersion: r.file.version,
          content_type: r.file.content_type,
          encoding: r.file.encoding,
        };
        renderEditor();
        showConflictModal(openFile.pendingMerge);
        return;
      }
      setFlash(r.message || '保存失败', true);
      return;
    }
    openFile.version = r.file.version;
    openFile.content = r.file.content;
    openFile.dirty = false;
    openFile.pendingMerge = null;
    setFlash('已保存');
    await refreshFiles();
    renderEditor();
  }

  function showConflictModal(conflict) {
    modalHost.innerHTML = `
      <div class="modal-mask" id="merge-modal">
        <div class="modal-card">
          <h3>文件发生冲突</h3>
          <p>
            你正在编辑的 <span class="mono">${escapeHtml(conflict.path)}</span>
            已被 AI 修改。是否让 AI 智能合并双方改动？
          </p>
          <div class="modal-actions">
            <button type="button" class="btn" id="m-no">否，另存 AI 版本</button>
            <button type="button" class="btn btn-primary" id="m-yes">是，AI 智能合并</button>
          </div>
        </div>
      </div>`;
    modalHost.querySelector('#m-no').onclick = async () => {
      modalHost.innerHTML = '';
      await saveAiAsSeparate(conflict);
    };
    modalHost.querySelector('#m-yes').onclick = async () => {
      modalHost.innerHTML = '';
      await requestAiMerge(conflict);
    };
  }

  async function saveAiAsSeparate(conflict) {
    const ap = altAiPath(conflict.path, conflict.aiVersion);
    const r = await API.request(`/api/projects/${id}/files`, {
      method: 'PUT',
      body: {
        path: ap,
        content: conflict.aiContent,
        encoding: conflict.encoding || 'utf8',
        content_type: conflict.content_type,
      },
    });
    if (!r.success) {
      setFlash(r.message || '另存失败', true);
      return;
    }
    // keep user buffer; update remote version baseline from AI main path without overwriting user text
    if (openFile && openFile.path === conflict.path) {
      openFile.version = conflict.aiVersion;
      openFile.pendingMerge = null;
      openFile.dirty = true;
    }
    pendingMerges = pendingMerges.filter((x) => x.path !== conflict.path);
    setFlash(`AI 改动已另存为 ${ap}`);
    await refreshFiles();
    renderEditor();
    updateShellClass();
  }

  async function requestAiMerge(conflict) {
    const stamp = Date.now();
    const userPath = `.merge/${stamp}-user-${conflict.path.replace(/\//g, '__')}`;
    const aiPath = `.merge/${stamp}-ai-${conflict.path.replace(/\//g, '__')}`;
    await API.request(`/api/projects/${id}/files`, {
      method: 'PUT',
      body: { path: userPath, content: conflict.userContent, encoding: 'utf8', content_type: 'text/plain' },
    });
    await API.request(`/api/projects/${id}/files`, {
      method: 'PUT',
      body: {
        path: aiPath,
        content: conflict.aiContent,
        encoding: conflict.encoding || 'utf8',
        content_type: conflict.content_type || 'text/plain',
      },
    });
    const prompt = [
      '[AIBridge 合并请求]',
      `目标文件: ${conflict.path}`,
      `用户版本: ${userPath}`,
      `AI 版本: ${aiPath}`,
      '请智能合并用户与 AI 的改动，保留双方合理修改，将合并结果写回目标文件路径（使用 Agent 文件 API PUT /api/agent/file）。',
      '合并完成后在聊天中简要说明冲突点与处理方式。',
    ].join('\n');
    await API.post(`/api/projects/${id}/messages`, { text: prompt });
    if (!pendingMerges.find((x) => x.path === conflict.path)) {
      pendingMerges.push({ ...conflict });
    }
    if (openFile && openFile.path === conflict.path) {
      openFile.pendingMerge = conflict;
      // do not overwrite user buffer
      openFile.version = conflict.aiVersion;
      openFile.dirty = true;
    }
    setFlash('已请求 AI 合并，请等待 Agent 写回文件');
    await refreshFiles();
    const mr = await API.get(`/api/projects/${id}/messages`);
    if (mr.success) {
      state.messages = mr.messages || [];
      paintMessages();
    }
    renderEditor();
    updateShellClass();
  }

  async function handleRemoteFileChange(meta) {
    if (!openFile || openFile.path !== meta.path) {
      // still refresh list
      return;
    }
    if (meta.version <= openFile.version) return;

    const r = await API.get(
      `/api/projects/${id}/files/content?path=${encodeURIComponent(meta.path)}`
    );
    if (!r.success || !r.file) return;
    const remote = r.file;

    if (!openFile.dirty) {
      // safe to apply remote
      openFile.content = remote.content || '';
      openFile.version = remote.version;
      openFile.content_type = remote.content_type;
      openFile.encoding = remote.encoding;
      openFile.pendingMerge = null;
      renderEditor();
      return;
    }

    // dirty: ask merge
    const conflict = {
      path: openFile.path,
      userContent: openFile.content,
      aiContent: remote.content || '',
      aiVersion: remote.version,
      content_type: remote.content_type,
      encoding: remote.encoding || 'utf8',
    };
    openFile.pendingMerge = conflict;
    openFile.version = remote.version;
    if (!pendingMerges.find((x) => x.path === conflict.path)) pendingMerges.push(conflict);
    updateShellClass();
    renderEditor();
    showConflictModal(conflict);
  }

  el.querySelector('#btn-files').onclick = async () => {
    filesOpen = !filesOpen;
    updateShellClass();
    if (filesOpen) await refreshFiles();
  };
  el.querySelector('#btn-new-file').onclick = () => {
    showFormModal(modalHost, {
      title: '新建文件',
      submitText: '创建并打开',
      fields: [
        {
          name: 'path',
          label: '文件路径',
          required: true,
          placeholder: '例如 src/main.go 或 README.md',
        },
        {
          name: 'content',
          label: '初始内容（可选）',
          placeholder: '可留空',
        },
      ],
      onSubmit: async (data) => {
        const r = await API.request(`/api/projects/${id}/files`, {
          method: 'PUT',
          body: {
            path: data.path,
            content: data.content || '',
            encoding: 'utf8',
          },
        });
        if (!r.success) {
          setFlash(r.message || '创建失败', true);
          return;
        }
        await refreshFiles();
        openFilePath(r.file.path);
      },
    });
    // content field as textarea
    const form = modalHost.querySelector('#modal-form');
    const contentLabel = form?.querySelector('input[name="content"]')?.closest('label');
    if (contentLabel) {
      const input = contentLabel.querySelector('input');
      const ta = document.createElement('textarea');
      ta.name = 'content';
      ta.rows = 6;
      ta.placeholder = '可留空，创建后可在编辑器中修改';
      ta.style.cssText =
        'width:100%;border:1px solid var(--line);border-radius:12px;padding:0.65rem 0.8rem;background:color-mix(in srgb, var(--bg) 70%, #fff);resize:vertical';
      input.replaceWith(ta);
    }
  };
  el.querySelector('#ed-save').onclick = () => saveOpenFile();
  el.querySelector('#ed-close').onclick = () => {
    if (openFile?.dirty && !confirm('有未保存修改，确定关闭？')) return;
    openFile = null;
    updateShellClass();
    paintFileList();
  };
  btnMd.onclick = () => {
    mdSource = !mdSource;
    renderEditor();
  };
  btnMergeTop.onclick = () => {
    const c =
      (openFile?.pendingMerge && openFile.pendingMerge) ||
      pendingMerges[pendingMerges.length - 1];
    if (!c) {
      setFlash('当前没有待合并冲突');
      return;
    }
    showConflictModal(c);
  };

  // compose: Enter send, Shift+Enter newline
  const form = el.querySelector('#compose');
  const ta = form.querySelector('textarea');
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    const r = await API.post(`/api/projects/${id}/messages`, { text });
    if (!r.success) {
      setFlash(r.message || '发送失败', true);
      return;
    }
    if (r.message) state.messages.push(r.message);
    else state.messages.push({ role: 'user', text, ts: new Date().toISOString() });
    paintMessages();
  };

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
        if (r.messages.length !== prev) paintMessages();
      }
      const fr = await API.get(
        `/api/projects/${id}/files/changes?since=${encodeURIComponent(sinceFiles)}`
      );
      if (fr.success) {
        if (fr.server_time) sinceFiles = fr.server_time;
        const changed = fr.files || [];
        if (changed.length) {
          await refreshFiles();
          for (const meta of changed) {
            await handleRemoteFileChange(meta);
          }
        }
      }
    } catch {
      /* */
    }
  };
  const timer = setInterval(poll, 2500);
  state.es = { close: () => clearInterval(timer) };
  updateShellClass();
  await refreshFiles();
  sinceFiles = new Date().toISOString();
}

async function viewAdmin() {
  const u = await ensureUser();
  if (!u) {
    location.hash = '#/login';
    return render();
  }
  if (u.role !== 'admin') {
    setFlash('需要管理员权限', true);
    location.hash = '#/app';
    return render();
  }
  const r = await API.get('/api/admin/users');
  if (!r.success) {
    setFlash(r.message || '加载用户失败', true);
    return;
  }
  const users = r.users || [];
  const el = $(`
    <div class="panel-wide liquid-glass">
      <div class="section-head" style="margin-bottom:0.75rem">
        <h2 style="margin:0">用户管理</h2>
        <span style="color:var(--text-dim);font-size:0.85rem">共 ${users.length} 人</span>
      </div>
      <div style="overflow:auto">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>角色</th>
              <th>套餐</th>
              <th>会员到期</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="admin-body"></tbody>
        </table>
      </div>
    </div>`);
  shell(el, { backHref: '#/app', backLabel: '返回项目' });
  const body = el.querySelector('#admin-body');
  for (const user of users) {
    const tr = document.createElement('tr');
    const banned = Number(user.banned) === 1;
    tr.innerHTML = `
      <td>${user.id}</td>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${escapeHtml(user.plan)}</td>
      <td class="mono" style="font-size:0.78rem">${user.premium_until ? escapeHtml(String(user.premium_until).slice(0, 19)) : '—'}</td>
      <td>${banned ? '已封禁' : '正常'}</td>
      <td class="admin-actions"></td>`;
    const actions = tr.querySelector('.admin-actions');
    if (user.username !== 'root') {
      const banBtn = document.createElement('button');
      banBtn.type = 'button';
      banBtn.className = 'btn';
      banBtn.style.cssText = 'padding:0.2rem 0.45rem;font-size:0.75rem';
      banBtn.textContent = banned ? '解封' : '封禁';
      banBtn.onclick = async () => {
        const res = await API.post(`/api/admin/users/${user.id}/ban`, { banned: !banned });
        setFlash(res.success ? '已更新' : res.message || '失败', !res.success);
        render();
      };
      actions.appendChild(banBtn);

      const premBtn = document.createElement('button');
      premBtn.type = 'button';
      premBtn.className = 'btn';
      premBtn.style.cssText = 'padding:0.2rem 0.45rem;font-size:0.75rem';
      premBtn.textContent = user.plan === 'premium' ? '取消会员' : '开通会员';
      premBtn.onclick = async () => {
        const toPremium = user.plan !== 'premium';
        let premium_until = null;
        if (toPremium) {
          const d = new Date();
          d.setMonth(d.getMonth() + 1);
          premium_until = d.toISOString();
        }
        const res = await API.post(`/api/admin/users/${user.id}/premium`, {
          premium: toPremium,
          plan: toPremium ? 'premium' : 'free',
          premium_until,
        });
        setFlash(res.success ? '会员状态已更新' : res.message || '失败', !res.success);
        render();
      };
      actions.appendChild(premBtn);

      const pwBtn = document.createElement('button');
      pwBtn.type = 'button';
      pwBtn.className = 'btn';
      pwBtn.style.cssText = 'padding:0.2rem 0.45rem;font-size:0.75rem';
      pwBtn.textContent = '改密';
      pwBtn.onclick = async () => {
        showFormModal(document.body.appendChild(document.createElement('div')), {
          title: `修改 ${user.username} 的密码`,
          submitText: '保存',
          fields: [{ name: 'password', label: '新密码（至少 8 位）', type: 'password', required: true }],
          onSubmit: async (data) => {
            const res = await API.post(`/api/admin/users/${user.id}/password`, {
              password: data.password,
            });
            setFlash(res.success ? '密码已更新' : res.message || '失败', !res.success);
          },
        });
      };
      actions.appendChild(pwBtn);
    } else {
      actions.textContent = '—';
    }
    body.appendChild(tr);
  }
}

async function viewAccount() {
  const u = await ensureUser();
  if (!u) {
    location.hash = '#/login';
    return render();
  }
  const full = await API.get('/api/me');
  const user = full.user || u;
  const memberLabel =
    user.is_premium || user.plan === 'premium'
      ? `已开通${user.premium_until ? ' · 至 ' + escapeHtml(String(user.premium_until).slice(0, 10)) : ''}`
      : '未开通';
  const el = $(`
    <div class="panel-wide liquid-glass">
      <h2 style="margin:0 0 1rem">账号</h2>
      <div class="field">用户名<div style="color:var(--text);font-weight:600">${escapeHtml(user.username)}</div></div>
      <div class="field">API Key
        <div class="mono" id="api-key">${escapeHtml(user.api_key || '')}</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.5rem 0 1rem">
        <button type="button" class="btn" id="copy-key">复制 Key</button>
        <button type="button" class="btn" id="rotate-key">轮换 Key</button>
        <a class="btn" href="#/skills" style="text-decoration:none">复制提示词</a>
      </div>
      ${
        state.commercial
          ? `<div class="field">会员
            <div>${memberLabel}</div>
          </div>
          <a class="btn btn-primary" href="#/billing" style="text-decoration:none">开通 / 续费</a>
          <hr style="border:0;border-top:1px solid var(--line);margin:1.25rem 0" />
          <h3 style="margin:0 0 0.75rem;font-size:1rem">激活码</h3>
          <form id="redeem">
            <label class="field">输入激活码
              <input name="code" required placeholder="例如 RemoteAiGENT" autocomplete="off" />
            </label>
            <button class="btn" type="submit">兑换</button>
          </form>`
          : ''
      }
      <hr style="border:0;border-top:1px solid var(--line);margin:1.25rem 0" />
      <h3 style="margin:0 0 0.75rem;font-size:1rem">修改密码</h3>
      <form id="pw">
        <label class="field">当前密码<input type="password" name="old_password" required /></label>
        <label class="field">新密码（至少 8 位）<input type="password" name="new_password" required minlength="8" /></label>
        <button class="btn" type="submit">更新密码</button>
      </form>
    </div>`);
  shell(el, { backHref: '#/app', backLabel: '返回项目' });
  el.querySelector('#copy-key').onclick = async () => {
    try {
      await navigator.clipboard.writeText(user.api_key || '');
      setFlash('API Key 已复制');
    } catch {
      setFlash('复制失败', true);
    }
    render();
  };
  el.querySelector('#rotate-key').onclick = async () => {
    if (!confirm('确定轮换 API Key？旧 Key 将立即失效。')) return;
    const r = await API.post('/api/apikey/rotate', {});
    if (!r.success) setFlash(r.message || '轮换失败', true);
    else setFlash('API Key 已轮换');
    render();
  };
  el.querySelector('#pw').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const r = await API.post('/api/auth/password', {
      old_password: fd.get('old_password'),
      new_password: fd.get('new_password'),
    });
    setFlash(r.message || (r.success ? '密码已更新' : '更新失败'), !r.success);
    render();
  };
  const redeemForm = el.querySelector('#redeem');
  if (redeemForm) {
    redeemForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const r = await API.post('/api/redeem', { code: fd.get('code') });
      setFlash(r.message || (r.success ? '激活成功' : '激活失败'), !r.success);
      if (r.success && r.user) state.user = r.user;
      render();
    };
  }
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
        { id: 'monthly', name: '月付', price: 5, period: '月' },
        { id: 'yearly', name: '年付', price: 50, period: '年' },
      ];
  const el = $(`
    <div>
      <div class="section-head"><h2>会员</h2></div>
      <p style="color:var(--text-dim);margin:0 0 1.25rem;max-width:36rem;line-height:1.6">
        自助开通会员。支付成功后自动延长有效期。月付 5 元，年付 50 元。
        开通后可创建不限数量项目。也可在账号页使用激活码兑换。
      </p>
      <div class="price-grid" id="prices"></div>
    </div>`);
  shell(el, { backHref: '#/account', backLabel: '返回账号' });
  const grid = el.querySelector('#prices');
  for (const p of plans) {
    const period =
      p.period === 'month' || p.period === 'monthly'
        ? '月'
        : p.period === 'year' || p.period === 'yearly'
          ? '年'
          : p.period || '';
    const card = document.createElement('article');
    card.className = 'liquid-glass price-card';
    card.innerHTML = `
      <h3>${escapeHtml(p.name || p.id)}</h3>
      <div class="price">${Number(p.price).toFixed(0)}<span> 元 / ${escapeHtml(period)}</span></div>
      <p>会员有效期内项目数量不限。</p>
      <div class="pay-row">
        <button type="button" class="btn btn-primary" data-plan="${p.id}" data-pay="alipay">支付宝</button>
        <button type="button" class="btn" data-plan="${p.id}" data-pay="wxpay">微信支付</button>
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
        setFlash(r.message || '创建支付失败', true);
        render();
        return;
      }
      if (r.payUrl) {
        location.href = r.payUrl;
        return;
      }
      setFlash('未返回支付链接', true);
      render();
    };
  });
}

async function render() {
  initWorld(document.getElementById('world'));
  await loadPlans();
  const hash = location.hash || '#/';
  const path = hash.replace(/^#/, '') || '/';

  if (path === '/' || path === '') return viewHome();
  if (path === '/login') return viewLogin();
  if (path === '/register') return viewRegister();
  if (path === '/skills') return viewSkills();
  if (path === '/app' || path === '/projects') return viewProjects();
  if (path === '/account') return viewAccount();
  if (path === '/billing') return viewBilling();
  if (path === '/admin') return viewAdmin();
  const chat = path.match(/^\/chat\/(\d+)/);
  if (chat) return viewChat(chat[1]);

  if (API.token) {
    location.hash = '#/app';
    return viewProjects();
  }
  return viewHome();
}

window.addEventListener('hashchange', () => render());
window.addEventListener('resize', () => initWorld(document.getElementById('world')));

(async () => {
  await ensureUser();
  await render();
})();
