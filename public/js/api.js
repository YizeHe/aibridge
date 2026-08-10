const API = {
  token: localStorage.getItem('ab_token') || '',
  setToken(t) {
    this.token = t || '';
    if (t) localStorage.setItem('ab_token', t);
    else localStorage.removeItem('ab_token');
  },
  async req(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (!(opts.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    if (this.token) {
      headers.Authorization = 'Bearer ' + this.token;
      headers['X-Session'] = this.token;
    }
    const res = await fetch(path, { ...opts, headers, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const err = new Error(data.message || res.statusText || 'request failed');
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get: (p) => API.req(p),
  post: (p, body) =>
    API.req(p, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body || {}),
    }),
  del: (p) => API.req(p, { method: 'DELETE' }),
};
