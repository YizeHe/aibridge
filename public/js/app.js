const state = { user: null, projects: [], projectId: null, ws: null };

function $(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function md(text) {
  if (window.marked && window.DOMPurify) {
    marked.setOptions({ gfm: true, breaks: true });
    return DOMPurify.sanitize(marked.parse(text || ''));
  }
  return String(text || '').replace(/</g, '&lt;');
}

function shell(content) {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const nav = $(`
    <header class="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-20">
      <div class="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
        <a href="#/" class="font-semibold tracking-tight text-white">AIBridge</a>
        <nav class="flex items-center gap-4 text-sm text-slate-300" id="nav"></nav>
      </div>
    </header>`);
  const main = document.createElement('main');
  main.className = 'mx-auto max-w-6xl px-4 py-8';
  main.appendChild(content);
  app.appendChild(nav);
  app.appendChild(main);
  const n = nav.querySelector('#nav');
  if (state.user) {
    n.innerHTML = `
      <a class="hover:text-white" href="#/app">Projects</a>
      <a class="hover:text-white" href="#/account">Account</a>
      ${state.user.role === 'admin' ? '<a class="hover:text-white" href="#/admin">Admin</a>' : ''}
      <button id="logout" class="rounded-lg bg-slate-800 px-3 py-1.5 hover:bg-slate-700">Logout</button>`;
    n.querySelector('#logout').onclick = async () => {
      try { await API.post('/api/auth/logout', {}); } catch {}
      API.setToken('');
      state.user = null;
      location.hash = '#/login';
      render();
    };
  } else {
    n.innerHTML = `
      <a class="hover:text-white" href="#/login">Sign in</a>
      <a class="rounded-lg bg-sky-600 px-3 py-1.5 text-white hover:bg-sky-500" href="#/register">Register</a>`;
  }
}

async function ensureUser() {
  if (!API.token) return null;
  try {
    const r = await API.get('/api/me');
    state.user = r.user || r.data;
    return state.user;
  } catch {
    API.setToken('');
    state.user = null;
    return null;
  }
}

function viewHome() {
  const el = $(`
    <div class="grid gap-10 lg:grid-cols-2 lg:items-center">
      <div>
        <p class="text-sky-400 text-sm font-medium mb-3">Cloudflare AI agent bridge</p>
        <h1 class="text-4xl font-semibold tracking-tight text-white mb-4">Chat with your local AI agents from the web</h1>
        <p class="text-slate-400 mb-6 leading-relaxed">
          Create a project, connect an agent with your API key and the AIBridge skill.
          Free accounts get one project; premium is unlimited.
        </p>
        <div class="flex gap-3">
          <a href="#/register" class="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500">Get started</a>
          <a href="#/login" class="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-900">Sign in</a>
        </div>
      </div>
      <div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div class="text-xs text-slate-500 mb-3">Agent protocol</div>
        <pre class="text-xs text-emerald-300/90 overflow-auto">GET /api/agent/pending?project=NAME
X-API-Key: ab_xxx

POST /api/agent/reply
{"project":"NAME","text":"markdown reply"}</pre>
      </div>
    </div>`);
  shell(el);
}

function viewLogin() {
  const el = $(`
    <div class="mx-auto max-w-md">
      <h1 class="text-2xl font-semibold mb-6">Sign in</h1>
      <form id="f" class="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <label class="block text-sm">Username
          <input name="username" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" required />
        </label>
        <label class="block text-sm">Password
          <input name="password" type="password" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" required />
        </label>
        <p id="err" class="text-sm text-rose-400 hidden"></p>
        <button class="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-medium hover:bg-sky-500">Sign in</button>
      </form>
    </div>`);
  shell(el);
  el.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await API.post('/api/auth/login', {
        username: fd.get('username'),
        password: fd.get('password'),
      });
      API.setToken(r.session || r.token || '');
      state.user = r.user;
      location.hash = '#/app';
      render();
    } catch (ex) {
      const err = el.querySelector('#err');
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  };
}

function viewRegister() {
  const el = $(`
    <div class="mx-auto max-w-md">
      <h1 class="text-2xl font-semibold mb-6">Create account</h1>
      <form id="f" class="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <label class="block text-sm">Username
          <input name="username" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" required />
        </label>
        <label class="block text-sm">Password (min 8)
          <input name="password" type="password" minlength="8" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" required />
        </label>
        <div>
          <div class="text-sm mb-2">Human verification</div>
          <div id="captcha"></div>
        </div>
        <p id="err" class="text-sm text-rose-400 hidden"></p>
        <button class="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-medium hover:bg-sky-500">Register</button>
      </form>
    </div>`);
  shell(el);
  const box = el.querySelector('#captcha');
  mountIconCaptcha(box);
  el.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const err = el.querySelector('#err');
    const slots = JSON.parse(box.dataset.slots || '[]');
    if (slots.length < 3) {
      err.textContent = 'Complete captcha first';
      err.classList.remove('hidden');
      return;
    }
    try {
      const r = await API.post('/api/auth/register', {
        username: fd.get('username'),
        password: fd.get('password'),
        captcha_token: box.dataset.token,
        captcha_slots: slots,
      });
      API.setToken(r.session || '');
      state.user = r.user;
      location.hash = '#/app';
      render();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      mountIconCaptcha(box);
    }
  };
}

async function viewApp() {
  if (!(await ensureUser())) {
    location.hash = '#/login';
    return render();
  }
  const pr = await API.get('/api/projects');
  const projects = pr.projects || pr.data || [];
  const el = $(`
    <div>
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">Projects</h1>
        <button id="newp" class="rounded-lg bg-sky-600 px-3 py-2 text-sm hover:bg-sky-500">New project</button>
      </div>
      <div id="list" class="grid gap-3 sm:grid-cols-2"></div>
      <p class="mt-4 text-sm text-slate-500">Free: 1 project. Premium: unlimited.</p>
    </div>`);
  shell(el);
  const list = el.querySelector('#list');
  if (!projects.length) list.innerHTML = '<div class="text-slate-500 text-sm">No projects yet.</div>';
  projects.forEach((p) => {
    list.appendChild(
      $(`<a href="#/chat/${p.id}" class="block rounded-xl border border-slate-800 bg-slate-900/50 p-4 hover:border-slate-600">
        <div class="font-medium text-white">${p.name}</div>
        <div class="text-xs text-slate-500 mt-1">${p.slug} · #${p.id}</div>
      </a>`)
    );
  });
  el.querySelector('#newp').onclick = async () => {
    const name = prompt('Project name');
    if (!name) return;
    try {
      await API.post('/api/projects', { name });
      viewApp();
    } catch (e) {
      alert(e.message);
    }
  };
}

async function viewChat(id) {
  if (!(await ensureUser())) {
    location.hash = '#/login';
    return render();
  }
  const pr = await API.get('/api/projects');
  const project = (pr.projects || []).find((p) => Number(p.id) === Number(id));
  if (!project) {
    location.hash = '#/app';
    return render();
  }
  const el = $(`
    <div class="flex flex-col h-[calc(100vh-8rem)]">
      <div class="mb-3">
        <a href="#/app" class="text-sm text-slate-500 hover:text-slate-300">Projects</a>
        <h1 class="text-xl font-semibold">${project.name}</h1>
      </div>
      <div id="log" class="flex-1 overflow-auto space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4"></div>
      <form id="f" class="mt-3 flex gap-2">
        <textarea id="t" rows="2" class="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="Message your agent..."></textarea>
        <button class="rounded-xl bg-sky-600 px-4 text-sm font-medium hover:bg-sky-500">Send</button>
      </form>
    </div>`);
  shell(el);
  const log = el.querySelector('#log');
  function addMsg(m) {
    const isUser = m.role === 'user';
    const wrap = document.createElement('div');
    wrap.className = 'max-w-3xl ' + (isUser ? 'ml-auto' : '');
    wrap.innerHTML = `<div class="text-[11px] text-slate-500 mb-1">${isUser ? 'You' : 'Agent'}</div>
      <div class="rounded-xl border px-3 py-2 text-sm ${isUser ? 'border-sky-900 bg-sky-950/40 whitespace-pre-wrap' : 'border-slate-700 bg-slate-950/60 md'}"></div>`;
    const body = wrap.lastElementChild;
    if (isUser) body.textContent = m.content || m.text || '';
    else body.innerHTML = md(m.content || m.text || '');
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }
  const hist = await API.get('/api/projects/' + id + '/messages');
  (hist.messages || hist.data || []).forEach(addMsg);

  // SSE if available
  try {
    const es = new EventSource('/api/projects/' + id + '/events?session=' + encodeURIComponent(API.token));
    es.onmessage = (ev) => {
      try {
        const p = JSON.parse(ev.data);
        if (p.message) addMsg(p.message);
        else if (p.content) addMsg(p);
      } catch {}
    };
  } catch {}

  el.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const t = el.querySelector('#t');
    const content = t.value.trim();
    if (!content) return;
    t.value = '';
    try {
      const r = await API.post('/api/projects/' + id + '/messages', { content, text: content });
      const m = r.message || r.data;
      if (m) addMsg(m);
    } catch (ex) {
      alert(ex.message);
    }
  };
}

async function viewAccount() {
  if (!(await ensureUser())) {
    location.hash = '#/login';
    return render();
  }
  const u = state.user;
  const el = $(`
    <div class="max-w-xl space-y-6">
      <h1 class="text-2xl font-semibold">Account</h1>
      <div class="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-2 text-sm">
        <div><span class="text-slate-500">Username</span> · ${u.username}</div>
        <div><span class="text-slate-500">Role / plan</span> · ${u.role}${u.plan ? ' / ' + u.plan : ''}</div>
        <div class="break-all"><span class="text-slate-500">API Key</span><br/><code class="text-emerald-300/90">${u.api_key || ''}</code></div>
        <button id="rotate" class="mt-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800">Rotate API key</button>
      </div>
      <form id="pw" class="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-3">
        <h2 class="font-medium">Change password</h2>
        <input name="old_password" type="password" placeholder="Current password" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" required />
        <input name="new_password" type="password" placeholder="New password (min 8)" minlength="8" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" required />
        <button class="rounded-lg bg-sky-600 px-3 py-2 text-sm hover:bg-sky-500">Update</button>
      </form>
    </div>`);
  shell(el);
  el.querySelector('#rotate').onclick = async () => {
    if (!confirm('Rotate API key?')) return;
    const r = await API.post('/api/apikey/rotate', {});
    alert('New key: ' + (r.api_key || ''));
    await ensureUser();
    viewAccount();
  };
  el.querySelector('#pw').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await API.post('/api/auth/password', {
        old_password: fd.get('old_password'),
        new_password: fd.get('new_password'),
      });
      alert('Password updated');
      e.target.reset();
    } catch (ex) {
      alert(ex.message);
    }
  };
}

async function viewAdmin() {
  if (!(await ensureUser()) || state.user.role !== 'admin') {
    location.hash = '#/app';
    return render();
  }
  const r = await API.get('/api/admin/users');
  const users = r.users || r.data || [];
  const el = $(`
    <div>
      <h1 class="text-2xl font-semibold mb-4">Admin</h1>
      <div class="overflow-auto rounded-xl border border-slate-800">
        <table class="w-full text-sm">
          <thead class="bg-slate-900 text-slate-400 text-left"><tr>
            <th class="px-3 py-2">ID</th><th class="px-3 py-2">User</th><th class="px-3 py-2">Plan</th>
            <th class="px-3 py-2">Banned</th><th class="px-3 py-2">Actions</th>
          </tr></thead>
          <tbody id="tb"></tbody>
        </table>
      </div>
    </div>`);
  shell(el);
  const tb = el.querySelector('#tb');
  users.forEach((u) => {
    const tr = document.createElement('tr');
    tr.className = 'border-t border-slate-800';
    tr.innerHTML = `<td class="px-3 py-2">${u.id}</td><td class="px-3 py-2">${u.username}</td>
      <td class="px-3 py-2">${u.plan || u.role}</td><td class="px-3 py-2">${u.banned ? 'yes' : 'no'}</td>
      <td class="px-3 py-2 space-x-2">
        <button data-a="prem" class="text-sky-400 text-xs">Premium</button>
        <button data-a="free" class="text-slate-400 text-xs">Free</button>
        <button data-a="ban" class="text-rose-400 text-xs">Ban</button>
        <button data-a="unban" class="text-emerald-400 text-xs">Unban</button>
        <button data-a="pw" class="text-amber-400 text-xs">Reset PW</button>
      </td>`;
    tr.querySelectorAll('button').forEach((btn) => {
      btn.onclick = async () => {
        const a = btn.dataset.a;
        if (a === 'prem') await API.post('/api/admin/users/' + u.id + '/premium', { premium: true });
        if (a === 'free') await API.post('/api/admin/users/' + u.id + '/premium', { premium: false });
        if (a === 'ban') await API.post('/api/admin/users/' + u.id + '/ban', { banned: true });
        if (a === 'unban') await API.post('/api/admin/users/' + u.id + '/ban', { banned: false });
        if (a === 'pw') {
          const pw = prompt('New password');
          if (!pw) return;
          await API.post('/api/admin/users/' + u.id + '/password', { password: pw });
        }
        viewAdmin();
      };
    });
    tb.appendChild(tr);
  });
}

async function render() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/chat/')) return viewChat(Number(hash.split('/')[2]));
  if (hash === '#/login') return viewLogin();
  if (hash === '#/register') return viewRegister();
  if (hash === '#/app') return viewApp();
  if (hash === '#/account') return viewAccount();
  if (hash === '#/admin') return viewAdmin();
  return viewHome();
}

window.addEventListener('hashchange', render);
ensureUser().finally(render);
