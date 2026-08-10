/**
 * AI Bridge frontend SPA
 */
const $ = (sel, el = document) => el.querySelector(sel);

const state = {
  user: null,
  view: 'loading', // loading | auth | home | chat | admin | settings
  projects: [],
  project: null,
  messages: [],
  authTab: 'login',
  error: '',
  notice: '',
  captchaToken: '',
  captchaSlots: null,
  es: null,
  pollTimer: null,
};

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { credentials: 'include', ...opts, headers });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { success: false, message: 'invalid json' };
  }
  if (!res.ok && !data.message) data.message = res.statusText;
  data._status = res.status;
  return data;
}

function setView(v) {
  state.view = v;
  render();
}

function toast(msg, isErr = false) {
  state.error = isErr ? msg : '';
  state.notice = isErr ? '' : msg;
  render();
  setTimeout(() => {
    state.error = '';
    state.notice = '';
    render();
  }, 3500);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMd(text) {
  try {
    let html = marked.parse(text || '');
    if (window.DOMPurify) html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    return `<div class="msg-md text-sm leading-relaxed">${html}</div>`;
  } catch {
    return `<div class="text-sm whitespace-pre-wrap">${escapeHtml(text || '')}</div>`;
  }
}

function shell(content) {
  const u = state.user;
  return `
  <div class="min-h-full flex flex-col">
    <header class="border-b border-ink-600/80 bg-ink-900/80 backdrop-blur sticky top-0 z-20">
      <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <button type="button" data-nav="home" class="flex items-center gap-2 font-semibold tracking-tight text-slate-100 hover:text-white">
          <span class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent text-xs font-bold">AB</span>
          AI Bridge
        </button>
        <nav class="flex items-center gap-1 text-sm">
          ${
            u
              ? `
            <button data-nav="home" class="px-3 py-1.5 rounded-lg hover:bg-ink-700 ${state.view === 'home' ? 'bg-ink-700 text-white' : 'text-slate-300'}">项目</button>
            ${
              u.role === 'admin'
                ? `<button data-nav="admin" class="px-3 py-1.5 rounded-lg hover:bg-ink-700 ${state.view === 'admin' ? 'bg-ink-700 text-white' : 'text-slate-300'}">管理</button>`
                : ''
            }
            <button data-nav="settings" class="px-3 py-1.5 rounded-lg hover:bg-ink-700 ${state.view === 'settings' ? 'bg-ink-700 text-white' : 'text-slate-300'}">账号</button>
            <button data-action="logout" class="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-ink-700">退出</button>
          `
              : ''
          }
        </nav>
      </div>
    </header>
    ${
      state.error
        ? `<div class="bg-red-500/15 border-b border-red-500/30 text-red-200 text-sm px-4 py-2 text-center">${escapeHtml(state.error)}</div>`
        : ''
    }
    ${
      state.notice
        ? `<div class="bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-200 text-sm px-4 py-2 text-center">${escapeHtml(state.notice)}</div>`
        : ''
    }
    <main class="flex-1">${content}</main>
    <footer class="border-t border-ink-600/60 text-center text-xs text-slate-500 py-4">
      AI Bridge · aibridge.tanstudio.me · 开源项目通信桥
    </footer>
  </div>`;
}

function viewAuth() {
  const tab = state.authTab;
  return shell(`
  <div class="max-w-md mx-auto px-4 py-12">
    <div class="rounded-2xl border border-ink-600 bg-ink-900/90 shadow-xl shadow-black/30 p-6">
      <h1 class="text-xl font-semibold mb-1">欢迎使用 AI Bridge</h1>
      <p class="text-sm text-slate-400 mb-6">注册账号获取 API Key，配合本地 Agent 与 AI 实时对话。</p>
      <div class="flex rounded-lg bg-ink-800 p-1 mb-6">
        <button data-auth-tab="login" class="flex-1 py-2 text-sm rounded-md ${tab === 'login' ? 'bg-accent text-white' : 'text-slate-300'}">登录</button>
        <button data-auth-tab="register" class="flex-1 py-2 text-sm rounded-md ${tab === 'register' ? 'bg-accent text-white' : 'text-slate-300'}">注册</button>
      </div>
      <form id="auth-form" class="space-y-4">
        <div>
          <label class="block text-xs text-slate-400 mb-1">用户名</label>
          <input name="username" required autocomplete="username" class="w-full rounded-lg bg-ink-950 border border-ink-600 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" placeholder="2-32 字符" />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1">密码</label>
          <input name="password" type="password" required minlength="8" autocomplete="${tab === 'login' ? 'current-password' : 'new-password'}" class="w-full rounded-lg bg-ink-950 border border-ink-600 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" placeholder="至少 8 位" />
        </div>
        ${
          tab === 'register'
            ? `<div>
                <label class="block text-xs text-slate-400 mb-2">人机验证</label>
                <div id="captcha-box" class="rounded-xl border border-ink-600 bg-ink-950 p-3 min-h-[88px]"></div>
                <p class="text-[11px] text-slate-500 mt-1">按提示顺序点击图标完成验证</p>
              </div>`
            : ''
        }
        <button type="submit" class="w-full rounded-lg bg-accent hover:bg-accent-soft py-2.5 text-sm font-semibold transition">
          ${tab === 'login' ? '登录' : '注册并获取 API Key'}
        </button>
      </form>
    </div>
  </div>`);
}

function viewHome() {
  const u = state.user;
  const projects = state.projects || [];
  return shell(`
  <div class="max-w-6xl mx-auto px-4 py-8">
    <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">我的项目</h1>
        <p class="text-sm text-slate-400 mt-1">
          ${escapeHtml(u.username)} · ${u.plan === 'premium' ? 'Premium（项目不限）' : '免费（最多 1 个项目）'}
        </p>
      </div>
      <form id="create-project" class="flex gap-2 w-full sm:w-auto">
        <input name="name" required maxlength="64" placeholder="新项目名称" class="flex-1 sm:w-56 rounded-lg bg-ink-900 border border-ink-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
        <button class="rounded-lg bg-accent hover:bg-accent-soft px-4 py-2 text-sm font-semibold whitespace-nowrap">创建</button>
      </form>
    </div>
    ${
      projects.length === 0
        ? `<div class="rounded-2xl border border-dashed border-ink-600 bg-ink-900/40 p-10 text-center text-slate-400 text-sm">还没有项目。创建一个后，把 API Key 与 SKILLS.md 交给你的 AI 即可连通。</div>`
        : `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            ${projects
              .map(
                (p) => `
              <div class="rounded-2xl border border-ink-600 bg-ink-900/80 p-5 hover:border-accent/40 transition group">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <h2 class="font-semibold text-lg">${escapeHtml(p.name)}</h2>
                    <p class="text-xs text-slate-500 mt-1 font-mono">${escapeHtml(p.slug)}</p>
                  </div>
                  <button data-open-project="${p.id}" class="text-xs rounded-md bg-ink-800 group-hover:bg-accent px-2.5 py-1">打开</button>
                </div>
                <p class="text-xs text-slate-500 mt-4">更新 ${escapeHtml(new Date(p.updated_at).toLocaleString())}</p>
                <div class="mt-3 flex gap-2">
                  <button data-open-project="${p.id}" class="text-xs text-accent hover:underline">进入对话</button>
                  <button data-del-project="${p.id}" class="text-xs text-slate-500 hover:text-red-300">删除</button>
                </div>
              </div>`
              )
              .join('')}
          </div>`
    }
    <div class="mt-10 rounded-2xl border border-ink-600 bg-ink-900/50 p-5 text-sm text-slate-300 space-y-2">
      <h3 class="font-semibold text-slate-100">快速接入</h3>
      <ol class="list-decimal list-inside space-y-1 text-slate-400">
        <li>复制你的 API Key（账号页）</li>
        <li>把 <code class="text-sky-300">skills/SKILLS.md</code> 与项目名交给 AI</li>
        <li>AI 下载本地 Agent 并配置轮询后，回到这里打开项目对话</li>
      </ol>
    </div>
  </div>`);
}

function viewChat() {
  const p = state.project;
  const msgs = state.messages || [];
  return shell(`
  <div class="max-w-4xl mx-auto px-4 py-4 flex flex-col" style="height: calc(100vh - 8rem)">
    <div class="flex items-center justify-between gap-3 mb-3">
      <div>
        <button data-nav="home" class="text-xs text-slate-400 hover:text-white mb-1">返回项目</button>
        <h1 class="text-lg font-semibold">${escapeHtml(p?.name || '')}</h1>
        <p class="text-xs text-slate-500 font-mono">slug: ${escapeHtml(p?.slug || '')}</p>
      </div>
      <div class="flex items-center gap-2 text-xs text-slate-400">
        <span id="live-dot" class="inline-block h-2 w-2 rounded-full bg-red-500"></span>
        实时同步
      </div>
    </div>
    <div id="chat-log" class="flex-1 overflow-y-auto scroll-thin space-y-3 rounded-2xl border border-ink-600 bg-ink-900/40 p-4">
      ${
        msgs.length === 0
          ? `<div class="text-center text-slate-500 text-sm py-12">暂无消息。Agent 上线后可在此对话。</div>`
          : msgs
              .map((m) => {
                const mine = m.role === 'user';
                return `
            <div class="flex ${mine ? 'justify-end' : 'justify-start'}">
              <div class="max-w-[90%] rounded-2xl border px-4 py-3 ${
                mine
                  ? 'border-blue-700/50 bg-blue-950/50'
                  : 'border-emerald-800/40 bg-emerald-950/30'
              }">
                <div class="text-[11px] text-slate-500 mb-1">${mine ? '你' : 'Agent'} · ${escapeHtml(
                  new Date(m.ts || m.created_at).toLocaleString()
                )}</div>
                ${mine ? `<div class="text-sm whitespace-pre-wrap">${escapeHtml(m.text)}</div>` : renderMd(m.text)}
              </div>
            </div>`;
              })
              .join('')
      }
    </div>
    <form id="chat-form" class="mt-3 flex gap-2">
      <textarea id="chat-input" rows="2" placeholder="输入消息… Enter 发送，Shift+Enter 换行" class="flex-1 rounded-xl bg-ink-900 border border-ink-600 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent/50"></textarea>
      <button class="rounded-xl bg-accent hover:bg-accent-soft px-5 text-sm font-semibold">发送</button>
    </form>
  </div>`);
}

function viewSettings() {
  const u = state.user;
  return shell(`
  <div class="max-w-xl mx-auto px-4 py-8 space-y-6">
    <h1 class="text-2xl font-semibold">账号设置</h1>
    <section class="rounded-2xl border border-ink-600 bg-ink-900/80 p-5 space-y-3">
      <h2 class="font-semibold">资料</h2>
      <p class="text-sm text-slate-400">用户名：<span class="text-slate-200">${escapeHtml(u.username)}</span></p>
      <p class="text-sm text-slate-400">套餐：<span class="text-slate-200">${u.plan === 'premium' ? 'Premium' : '免费'}</span></p>
      <p class="text-sm text-slate-400">角色：<span class="text-slate-200">${u.role}</span></p>
    </section>
    <section class="rounded-2xl border border-ink-600 bg-ink-900/80 p-5 space-y-3">
      <h2 class="font-semibold">API Key</h2>
      <p class="text-xs text-slate-500">本地 Agent 与 AI 配置时使用。请勿泄露。</p>
      <div class="flex gap-2">
        <input id="api-key-display" readonly value="${escapeHtml(u.api_key || '')}" class="flex-1 rounded-lg bg-ink-950 border border-ink-600 px-3 py-2 text-xs font-mono" />
        <button data-action="copy-key" class="rounded-lg bg-ink-700 hover:bg-ink-600 px-3 text-sm">复制</button>
        <button data-action="rotate-key" class="rounded-lg border border-amber-700/50 text-amber-200 hover:bg-amber-950/40 px-3 text-sm">轮换</button>
      </div>
    </section>
    <section class="rounded-2xl border border-ink-600 bg-ink-900/80 p-5">
      <h2 class="font-semibold mb-3">修改密码</h2>
      <form id="pw-form" class="space-y-3">
        <input name="old_password" type="password" required placeholder="原密码" class="w-full rounded-lg bg-ink-950 border border-ink-600 px-3 py-2 text-sm" />
        <input name="new_password" type="password" required minlength="8" placeholder="新密码（至少 8 位）" class="w-full rounded-lg bg-ink-950 border border-ink-600 px-3 py-2 text-sm" />
        <button class="rounded-lg bg-accent hover:bg-accent-soft px-4 py-2 text-sm font-semibold">更新密码</button>
      </form>
    </section>
  </div>`);
}

function viewAdmin() {
  const users = state.adminUsers || [];
  return shell(`
  <div class="max-w-5xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold">用户管理</h1>
      <button data-action="refresh-admin" class="text-sm rounded-lg bg-ink-800 hover:bg-ink-700 px-3 py-1.5">刷新</button>
    </div>
    <div class="overflow-x-auto rounded-2xl border border-ink-600">
      <table class="w-full text-sm">
        <thead class="bg-ink-800 text-slate-400 text-left">
          <tr>
            <th class="px-3 py-2">ID</th>
            <th class="px-3 py-2">用户名</th>
            <th class="px-3 py-2">套餐</th>
            <th class="px-3 py-2">角色</th>
            <th class="px-3 py-2">状态</th>
            <th class="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          ${users
            .map(
              (u) => `
            <tr class="border-t border-ink-600/80 hover:bg-ink-900/60">
              <td class="px-3 py-2 font-mono text-xs">${u.id}</td>
              <td class="px-3 py-2">${escapeHtml(u.username)}</td>
              <td class="px-3 py-2">${u.plan}</td>
              <td class="px-3 py-2">${u.role}</td>
              <td class="px-3 py-2">${u.banned ? '<span class="text-red-300">封禁</span>' : '<span class="text-emerald-300">正常</span>'}</td>
              <td class="px-3 py-2 space-x-1">
                <button data-admin-premium="${u.id}" data-plan="${u.plan === 'premium' ? 'free' : 'premium'}" class="text-xs rounded bg-ink-700 px-2 py-1 hover:bg-ink-600">${u.plan === 'premium' ? '降为免费' : '开 Premium'}</button>
                <button data-admin-ban="${u.id}" data-banned="${u.banned ? '0' : '1'}" class="text-xs rounded bg-ink-700 px-2 py-1 hover:bg-ink-600">${u.banned ? '解封' : '封禁'}</button>
                <button data-admin-pw="${u.id}" class="text-xs rounded bg-ink-700 px-2 py-1 hover:bg-ink-600">改密</button>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  </div>`);
}

function render() {
  const root = $('#app');
  if (!root) return;
  stopLive();
  let html = '';
  switch (state.view) {
    case 'loading':
      html = shell(`<div class="py-24 text-center text-slate-400">加载中…</div>`);
      break;
    case 'auth':
      html = viewAuth();
      break;
    case 'home':
      html = viewHome();
      break;
    case 'chat':
      html = viewChat();
      break;
    case 'settings':
      html = viewSettings();
      break;
    case 'admin':
      html = viewAdmin();
      break;
    default:
      html = shell(`<div class="py-24 text-center">未知页面</div>`);
  }
  root.innerHTML = html;
  bindEvents();
  if (state.view === 'auth' && state.authTab === 'register') mountCaptcha();
  if (state.view === 'chat' && state.project) {
    startLive();
    const log = $('#chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }
}

function bindEvents() {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', async () => {
      const v = el.getAttribute('data-nav');
      if (v === 'home') {
        await loadProjects();
        setView('home');
      } else if (v === 'settings') setView('settings');
      else if (v === 'admin') {
        await loadAdmin();
        setView('admin');
      }
    });
  });

  document.querySelectorAll('[data-auth-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      state.authTab = el.getAttribute('data-auth-tab');
      state.captchaToken = '';
      state.captchaSlots = null;
      render();
    });
  });

  const authForm = $('#auth-form');
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(authForm);
      const username = String(fd.get('username') || '');
      const password = String(fd.get('password') || '');
      if (state.authTab === 'login') {
        const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
        if (!data.success) return toast(data.message || '登录失败', true);
        state.user = data.user;
        await loadProjects();
        setView('home');
        toast('登录成功');
      } else {
        if (!state.captchaToken || !state.captchaSlots) {
          return toast('请先完成人机验证', true);
        }
        const data = await api('/api/auth/register', {
          method: 'POST',
          body: {
            username,
            password,
            captcha_token: state.captchaToken,
            captcha_slots: state.captchaSlots,
          },
        });
        if (!data.success) return toast(data.message || '注册失败', true);
        state.user = data.user;
        await loadProjects();
        setView('home');
        toast('注册成功，请到账号页保存 API Key');
      }
    });
  }

  const createForm = $('#create-project');
  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(createForm);
      const name = String(fd.get('name') || '').trim();
      const data = await api('/api/projects', { method: 'POST', body: { name } });
      if (!data.success) return toast(data.message || '创建失败', true);
      await loadProjects();
      toast('项目已创建');
      render();
    });
  }

  document.querySelectorAll('[data-open-project]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = Number(el.getAttribute('data-open-project'));
      await openProject(id);
    });
  });

  document.querySelectorAll('[data-del-project]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = Number(el.getAttribute('data-del-project'));
      if (!confirm('确定删除该项目及其全部消息？')) return;
      const data = await api(`/api/projects/${id}`, { method: 'DELETE' });
      if (!data.success) return toast(data.message || '删除失败', true);
      await loadProjects();
      toast('已删除');
      render();
    });
  });

  const chatForm = $('#chat-form');
  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('#chat-input');
      const text = (input?.value || '').trim();
      if (!text || !state.project) return;
      input.value = '';
      const data = await api(`/api/projects/${state.project.id}/messages`, {
        method: 'POST',
        body: { text },
      });
      if (!data.success) return toast(data.message || '发送失败', true);
      if (data.message) {
        state.messages.push(data.message);
        render();
      }
    });
    const input = $('#chat-input');
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.requestSubmit();
      }
    });
  }

  $('[data-action="logout"]')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    state.user = null;
    state.projects = [];
    setView('auth');
  });

  $('[data-action="copy-key"]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.user?.api_key || '');
      toast('已复制 API Key');
    } catch {
      toast('复制失败，请手动选择', true);
    }
  });

  $('[data-action="rotate-key"]')?.addEventListener('click', async () => {
    if (!confirm('轮换后旧 Key 立即失效，确定？')) return;
    const data = await api('/api/apikey/rotate', { method: 'POST', body: {} });
    if (!data.success) return toast(data.message || '失败', true);
    state.user.api_key = data.api_key;
    toast('API Key 已轮换');
    render();
  });

  const pwForm = $('#pw-form');
  if (pwForm) {
    pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(pwForm);
      const data = await api('/api/auth/password', {
        method: 'POST',
        body: {
          old_password: String(fd.get('old_password') || ''),
          new_password: String(fd.get('new_password') || ''),
        },
      });
      if (!data.success) return toast(data.message || '失败', true);
      toast('密码已更新');
      pwForm.reset();
    });
  }

  $('[data-action="refresh-admin"]')?.addEventListener('click', async () => {
    await loadAdmin();
    render();
  });

  document.querySelectorAll('[data-admin-premium]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-admin-premium');
      const plan = el.getAttribute('data-plan');
      const data = await api(`/api/admin/users/${id}/premium`, {
        method: 'POST',
        body: { plan },
      });
      if (!data.success) return toast(data.message || '失败', true);
      await loadAdmin();
      render();
    });
  });

  document.querySelectorAll('[data-admin-ban]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-admin-ban');
      const banned = el.getAttribute('data-banned') === '1';
      const data = await api(`/api/admin/users/${id}/ban`, {
        method: 'POST',
        body: { banned },
      });
      if (!data.success) return toast(data.message || '失败', true);
      await loadAdmin();
      render();
    });
  });

  document.querySelectorAll('[data-admin-pw]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-admin-pw');
      const password = prompt('输入新密码（至少 8 位）');
      if (!password) return;
      const data = await api(`/api/admin/users/${id}/password`, {
        method: 'POST',
        body: { password },
      });
      if (!data.success) return toast(data.message || '失败', true);
      toast('密码已修改');
    });
  });
}

async function mountCaptcha() {
  const box = $('#captcha-box');
  if (!box) return;
  state.captchaToken = '';
  state.captchaSlots = null;

  try {
    const challenge = await api('/api/captcha/challenge');
    if (!challenge.token) {
      box.innerHTML = `<p class="text-sm text-red-300">无法加载验证码</p>`;
      return;
    }

    const { token, prompt, items, canvas } = challenge;
    const w = canvas?.width || 360;
    const h = canvas?.height || 200;
    const clicked = [];

    box.innerHTML = `
      <p class="text-xs text-slate-300 mb-2">${escapeHtml(prompt || '请按顺序点击图标')}</p>
      <div id="cap-canvas" class="relative mx-auto bg-white rounded-lg overflow-hidden" style="width:${w}px;max-width:100%;aspect-ratio:${w}/${h};height:auto;min-height:160px"></div>
      <div class="flex items-center justify-between mt-2">
        <span id="cap-status" class="text-[11px] text-slate-500">已点 ${clicked.length}/3</span>
        <button type="button" id="cap-reset" class="text-[11px] text-slate-400 hover:text-white">重置</button>
      </div>`;

    const canvasEl = $('#cap-canvas', box);
    for (const item of items || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'absolute flex items-center justify-center rounded-lg border border-slate-200 hover:border-blue-400 bg-slate-50 shadow-sm text-slate-800';
      // PublicChallenge items: { slotId, svg, x, y } percentages
      const x = item.x ?? item.pos?.x ?? 50;
      const y = item.y ?? item.pos?.y ?? 50;
      btn.style.left = `${x}%`;
      btn.style.top = `${y}%`;
      btn.style.width = '44px';
      btn.style.height = '44px';
      btn.style.transform = 'translate(-50%, -50%)';
      btn.dataset.slot = item.slotId;
      const svg = item.svg || item.icon?.svg || item.icon?.glyph || '';
      if (svg) {
        btn.innerHTML = svg;
        const svgEl = btn.querySelector('svg');
        if (svgEl) {
          svgEl.setAttribute('width', '22');
          svgEl.setAttribute('height', '22');
          svgEl.style.color = '#0f172a';
        }
      } else {
        btn.textContent = item.icon?.label || item.icon?.id || '?';
        btn.className += ' text-[10px]';
      }
      btn.addEventListener('click', async () => {
        if (clicked.includes(item.slotId)) return;
        if (clicked.length >= 3) return;
        clicked.push(item.slotId);
        btn.classList.add('ring-2', 'ring-blue-500');
        const st = $('#cap-status', box);
        if (st) st.textContent = `已点 ${clicked.length}/3`;
        if (clicked.length === 3) {
          const ver = await api('/api/captcha/verify', {
            method: 'POST',
            body: { token, slots: clicked },
          });
          if (ver.ok) {
            state.captchaToken = token;
            state.captchaSlots = [...clicked];
            if (st) {
              st.textContent = '验证通过';
              st.className = 'text-[11px] text-emerald-400';
            }
          } else {
            if (st) {
              st.textContent = '验证失败，请重置';
              st.className = 'text-[11px] text-red-300';
            }
            state.captchaToken = '';
            state.captchaSlots = null;
          }
        }
      });
      canvasEl.appendChild(btn);
    }

    $('#cap-reset', box)?.addEventListener('click', () => mountCaptcha());
  } catch (e) {
    box.innerHTML = `<p class="text-sm text-red-300">验证码错误: ${escapeHtml(e.message || e)}</p>`;
  }
}

async function loadProjects() {
  const data = await api('/api/projects');
  if (data.success) state.projects = data.projects || [];
}

async function loadAdmin() {
  const data = await api('/api/admin/users');
  if (data.success) state.adminUsers = data.users || [];
  else toast(data.message || '无权限', true);
}

async function openProject(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) {
    const data = await api(`/api/projects/${id}`);
    if (!data.success) return toast(data.message || '打开失败', true);
    state.project = data.project;
  } else {
    state.project = p;
  }
  const msgs = await api(`/api/projects/${id}/messages`);
  state.messages = msgs.messages || [];
  setView('chat');
}

function stopLive() {
  if (state.es) {
    try {
      state.es.close();
    } catch {
      /* ignore */
    }
    state.es = null;
  }
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function startLive() {
  stopLive();
  if (!state.project) return;
  const pid = state.project.id;
  const lastTs = state.messages.length
    ? state.messages[state.messages.length - 1].ts
    : new Date(0).toISOString();

  try {
    const es = new EventSource(`/api/projects/${pid}/events?since=${encodeURIComponent(lastTs)}`);
    state.es = es;
    es.onopen = () => {
      const dot = $('#live-dot');
      if (dot) {
        dot.classList.remove('bg-red-500');
        dot.classList.add('bg-emerald-500');
      }
    };
    es.onerror = () => {
      const dot = $('#live-dot');
      if (dot) {
        dot.classList.add('bg-red-500');
        dot.classList.remove('bg-emerald-500');
      }
    };
    es.onmessage = (ev) => {
      try {
        const p = JSON.parse(ev.data);
        if (p.type === 'message' && p.message) {
          if (!state.messages.find((m) => m.id === p.message.id)) {
            state.messages.push(p.message);
            // partial update
            const log = $('#chat-log');
            if (log) {
              const mine = p.message.role === 'user';
              const div = document.createElement('div');
              div.className = `flex ${mine ? 'justify-end' : 'justify-start'}`;
              div.innerHTML = `
                <div class="max-w-[90%] rounded-2xl border px-4 py-3 ${
                  mine ? 'border-blue-700/50 bg-blue-950/50' : 'border-emerald-800/40 bg-emerald-950/30'
                }">
                  <div class="text-[11px] text-slate-500 mb-1">${mine ? '你' : 'Agent'} · ${escapeHtml(
                    new Date(p.message.ts).toLocaleString()
                  )}</div>
                  ${
                    mine
                      ? `<div class="text-sm whitespace-pre-wrap">${escapeHtml(p.message.text)}</div>`
                      : renderMd(p.message.text)
                  }
                </div>`;
              // remove empty placeholder
              if (state.messages.length === 1) log.innerHTML = '';
              log.appendChild(div);
              log.scrollTop = log.scrollHeight;
            }
          }
        }
      } catch {
        /* ignore */
      }
    };
  } catch {
    // fallback poll
    state.pollTimer = setInterval(async () => {
      const since = state.messages.length
        ? state.messages[state.messages.length - 1].ts
        : '';
      const data = await api(
        `/api/projects/${pid}/messages${since ? `?since=${encodeURIComponent(since)}` : ''}`
      );
      if (data.messages?.length) {
        for (const m of data.messages) {
          if (!state.messages.find((x) => x.id === m.id)) state.messages.push(m);
        }
        render();
      }
    }, 2500);
  }
}

async function boot() {
  setView('loading');
  const me = await api('/api/me');
  if (me.success && me.user) {
    state.user = me.user;
    await loadProjects();
    setView('home');
  } else {
    setView('auth');
  }
}

boot();
