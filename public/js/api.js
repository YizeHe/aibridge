/** Thin API client for AIBridge SPA */

const TOKEN_KEY = 'aibridge_session';

export const API = {
  get token() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  },
  setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
  async request(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const token = this.token;
    if (token) {
      headers['X-Session'] = token;
      headers['Authorization'] = `Session ${token}`;
    }
    let body = opts.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(path, {
      credentials: 'include',
      ...opts,
      headers,
      body,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = { success: false, message: res.statusText || 'invalid response' };
    }
    data._status = res.status;
    if (data.session) this.setToken(data.session);
    return data;
  },
  get(path) {
    return this.request(path);
  },
  post(path, body) {
    return this.request(path, { method: 'POST', body });
  },
  del(path) {
    return this.request(path, { method: 'DELETE' });
  },
};
