/**
 * AI Bridge — Cloudflare Worker
 * Domain: aibridge.tanstudio.me
 */
import { createChallenge, verifyChallenge } from '@yunstorage/icon-captcha';
import type { Env } from './types';
import {
  apiKeyUser,
  changePassword,
  createSession,
  destroySession,
  ensureAdminSeed,
  getUserById,
  getUserByUsername,
  publicUser,
  registerUser,
  rotateApiKey,
  sessionUser,
  SESSION_TTL_SEC,
  verifyPassword,
} from './auth';
import { secrets, sha256Hex } from './crypto';
import {
  clearCookie,
  corsPreflight,
  json,
  readJson,
  setCookie,
} from './http';
import {
  addMessage,
  agentReply,
  listMessages,
  pendingUserMessages,
  toMessage,
  ackMessages,
} from './messages';
import {
  createProject,
  deleteProject,
  listProjects,
  getProject,
  resolveProjectForUser,
} from './projects';

let seeded = false;

async function seedOnce(env: Env) {
  if (seeded) return;
  try {
    await ensureAdminSeed(env.DB);
    seeded = true;
  } catch {
    // tables may not exist yet on first boot before migration
  }
}

function requireUser(u: Awaited<ReturnType<typeof sessionUser>>): asserts u is NonNullable<typeof u> {
  if (!u) throw new HttpError(401, '未登录');
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  await seedOnce(env);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // ── Captcha ───────────────────────────────────────────
  if (method === 'GET' && path === '/api/captcha/challenge') {
    const challenge = await createChallenge({ secret: secrets(env).captcha });
    return json(challenge);
  }

  if (method === 'POST' && path === '/api/captcha/verify') {
    const body = await readJson<{ token?: string; slots?: string[] }>(req);
    const result = await verifyChallenge(
      String(body.token || ''),
      Array.isArray(body.slots) ? body.slots : [],
      secrets(env).captcha
    );
    return json(result);
  }

  // ── Auth ──────────────────────────────────────────────
  if (method === 'POST' && path === '/api/auth/register') {
    const body = await readJson<{
      username?: string;
      password?: string;
      captcha_token?: string;
      captcha_slots?: string[];
      captchaToken?: string;
      slots?: string[];
    }>(req);

    const token = String(body.captcha_token || body.captchaToken || '');
    const slots = (body.captcha_slots || body.slots || []) as string[];
    if (!token || !slots.length) {
      return json({ success: false, message: '请完成人机验证' }, 400);
    }
    const cap = await verifyChallenge(token, slots, secrets(env).captcha);
    if (!cap.ok) {
      return json({ success: false, message: '人机验证失败: ' + (cap.reason || 'unknown') }, 400);
    }
    // one-time token
    const th = await sha256Hex(token);
    try {
      await env.DB.prepare('INSERT INTO captcha_used (token_hash) VALUES (?)').bind(th).run();
    } catch {
      return json({ success: false, message: '验证码已使用，请刷新' }, 400);
    }

    const reg = await registerUser(env.DB, String(body.username || ''), String(body.password || ''));
    if (!reg.ok) return json({ success: false, message: reg.error }, 400);

    const sid = await createSession(env.DB, reg.user.id);
    const headers = {
      'Set-Cookie': setCookie('aibridge_session', sid, { maxAge: SESSION_TTL_SEC }),
    };
    return json(
      {
        success: true,
        user: publicUser(reg.user),
        session: sid,
        message: '注册成功，请妥善保存 API Key',
      },
      200,
      headers
    );
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const body = await readJson<{ username?: string; password?: string }>(req);
    const u = await getUserByUsername(env.DB, String(body.username || ''));
    if (!u || !(await verifyPassword(String(body.password || ''), u.password_hash))) {
      return json({ success: false, message: '用户名或密码错误' }, 401);
    }
    if (u.banned) return json({ success: false, message: '账号已被封禁' }, 403);
    const sid = await createSession(env.DB, u.id);
    return json(
      { success: true, user: publicUser(u), session: sid },
      200,
      { 'Set-Cookie': setCookie('aibridge_session', sid, { maxAge: SESSION_TTL_SEC }) }
    );
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    const u = await sessionUser(env, req);
    const sid =
      req.headers.get('X-Session') ||
      (await readJson<{ session?: string }>(req)).session;
    // best-effort destroy from cookie path handled client-side too
    const cookieSid = req.headers.get('Cookie') || '';
    const m = cookieSid.match(/aibridge_session=([^;]+)/);
    const id = sid || (m ? decodeURIComponent(m[1]) : '');
    if (id) await destroySession(env.DB, id);
    void u;
    return json(
      { success: true },
      200,
      { 'Set-Cookie': clearCookie('aibridge_session') }
    );
  }

  if (method === 'GET' && path === '/api/me') {
    const u = await sessionUser(env, req);
    if (!u) return json({ success: false, message: '未登录' }, 401);
    const full = await getUserById(env.DB, u.id);
    return json({ success: true, user: full ? publicUser(full) : publicUser(u) });
  }

  if (method === 'POST' && path === '/api/auth/password') {
    const u = await sessionUser(env, req);
    requireUser(u);
    const body = await readJson<{ old_password?: string; new_password?: string }>(req);
    const full = await getUserById(env.DB, u.id);
    if (!full) return json({ success: false, message: '用户不存在' }, 404);
    if (!(await verifyPassword(String(body.old_password || ''), full.password_hash))) {
      return json({ success: false, message: '原密码错误' }, 400);
    }
    if (String(body.new_password || '').length < 8) {
      return json({ success: false, message: '新密码至少 8 位' }, 400);
    }
    await changePassword(env.DB, u.id, String(body.new_password));
    return json({ success: true, message: '密码已更新' });
  }

  if (method === 'POST' && path === '/api/apikey/rotate') {
    const u = await sessionUser(env, req);
    requireUser(u);
    const key = await rotateApiKey(env.DB, u.id);
    return json({ success: true, api_key: key });
  }

  // ── Projects (session) ────────────────────────────────
  if (method === 'GET' && path === '/api/projects') {
    const u = await sessionUser(env, req);
    requireUser(u);
    const projects = await listProjects(env.DB, u.id);
    return json({ success: true, projects });
  }

  if (method === 'POST' && path === '/api/projects') {
    const u = await sessionUser(env, req);
    requireUser(u);
    const body = await readJson<{ name?: string; description?: string }>(req);
    const full = await getUserById(env.DB, u.id);
    if (!full) return json({ success: false, message: '用户不存在' }, 404);
    const r = await createProject(env, full, String(body.name || ''), String(body.description || ''));
    if (!r.ok) return json({ success: false, message: r.error }, r.status);
    return json({ success: true, project: r.project });
  }

  const projectMatch = path.match(/^\/api\/projects\/(\d+)(.*)$/);
  if (projectMatch) {
    const projectId = Number(projectMatch[1]);
    const rest = projectMatch[2] || '';
    const u = await sessionUser(env, req);
    requireUser(u);
    const project = await getProject(env.DB, projectId);
    if (!project || project.user_id !== u.id) {
      // admin can view any? only for admin user management elsewhere
      if (u.role !== 'admin' || !project) {
        return json({ success: false, message: '项目不存在' }, 404);
      }
    }
    if (!project) return json({ success: false, message: '项目不存在' }, 404);
    if (project.user_id !== u.id && u.role !== 'admin') {
      return json({ success: false, message: '无权访问' }, 403);
    }

    if (method === 'GET' && rest === '') {
      return json({ success: true, project });
    }

    if (method === 'DELETE' && rest === '') {
      if (project.user_id !== u.id) return json({ success: false, message: '无权删除' }, 403);
      await deleteProject(env.DB, u.id, projectId);
      return json({ success: true });
    }

    if (method === 'GET' && rest === '/messages') {
      const since = url.searchParams.get('since') || undefined;
      const msgs = await listMessages(env.DB, projectId, { since });
      return json({
        success: true,
        messages: msgs.map(toMessage),
        unread_user: msgs.filter((m) => m.role === 'user' && !m.acked).length,
      });
    }

    if (method === 'POST' && rest === '/messages') {
      if (project.user_id !== u.id) return json({ success: false, message: '无权发送' }, 403);
      const body = await readJson<{ text?: string }>(req);
      const text = String(body.text || '').trim();
      if (!text) return json({ success: false, message: '消息不能为空' }, 400);
      if (text.length > 100_000) return json({ success: false, message: '消息过长' }, 400);
      const msg = await addMessage(env.DB, projectId, 'user', text, false);
      return json({ success: true, message: toMessage(msg) });
    }

    // lightweight long-poll style: client uses EventSource not available multi-isolate;
    // provide SSE that streams heartbeats + polls DB briefly
    if (method === 'GET' && rest === '/events') {
      if (project.user_id !== u.id && u.role !== 'admin') {
        return json({ success: false, message: '无权访问' }, 403);
      }
      let last = url.searchParams.get('since') || new Date(Date.now() - 1000).toISOString();
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const send = (obj: unknown) => {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
          };
          send({ type: 'hello', ts: Date.now(), project_id: projectId });
          let alive = true;
          const maxTicks = 45; // ~90s then client reconnects
          for (let i = 0; i < maxTicks && alive; i++) {
            try {
              const msgs = await listMessages(env.DB, projectId, { since: last, limit: 50 });
              for (const m of msgs) {
                send({ type: 'message', message: toMessage(m) });
                last = m.created_at;
              }
              if (i % 5 === 0) send({ type: 'ping', ts: Date.now() });
            } catch {
              break;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        },
        cancel() {
          /* client gone */
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  // ── Agent API (API Key) ───────────────────────────────
  // GET /api/agent/pending?project=slug|id
  if (method === 'GET' && path === '/api/agent/pending') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const pref = url.searchParams.get('project') || url.searchParams.get('p') || '';
    if (!pref) return json({ success: false, message: '缺少 project 参数' }, 400);
    const project = await resolveProjectForUser(env.DB, agent.id, pref);
    if (!project) return json({ success: false, message: '项目不存在' }, 404);
    const msgs = await pendingUserMessages(env.DB, project.id);
    return json({
      success: true,
      project: { id: project.id, name: project.name, slug: project.slug },
      messages: msgs.map(toMessage),
    });
  }

  // POST /api/agent/reply { project, text }
  if (method === 'POST' && path === '/api/agent/reply') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const body = await readJson<{ project?: string; text?: string; p?: string }>(req);
    const pref = String(body.project || body.p || '');
    const text = String(body.text || '').trim();
    if (!pref) return json({ success: false, message: '缺少 project' }, 400);
    if (!text) return json({ success: false, message: '回复不能为空' }, 400);
    const project = await resolveProjectForUser(env.DB, agent.id, pref);
    if (!project) return json({ success: false, message: '项目不存在' }, 404);
    const msg = await agentReply(env.DB, project.id, text);
    return json({ success: true, message: toMessage(msg) });
  }

  if (method === 'POST' && path === '/api/agent/ack') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const body = await readJson<{ project?: string; ids?: string[] }>(req);
    const project = await resolveProjectForUser(env.DB, agent.id, String(body.project || ''));
    if (!project) return json({ success: false, message: '项目不存在' }, 404);
    const n = await ackMessages(env.DB, project.id, body.ids);
    return json({ success: true, acked: n });
  }

  // Agent bootstrap: list projects for this API key
  if (method === 'GET' && path === '/api/agent/projects') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const projects = await listProjects(env.DB, agent.id);
    return json({
      success: true,
      user: { username: agent.username, plan: agent.plan },
      projects,
    });
  }

  // Agent ensure project exists (create if missing, respect plan limits)
  if (method === 'POST' && path === '/api/agent/projects') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const body = await readJson<{ name?: string; description?: string }>(req);
    const name = String(body.name || '').trim();
    if (!name) return json({ success: false, message: '缺少 name' }, 400);
    // if slug exists return it
    const existing = await listProjects(env.DB, agent.id);
    const hit = existing.find((p) => p.name === name || p.slug === name);
    if (hit) return json({ success: true, project: hit, created: false });
    const r = await createProject(env, agent, name, String(body.description || ''));
    if (!r.ok) return json({ success: false, message: r.error }, r.status);
    return json({ success: true, project: r.project, created: true });
  }

  // ── Admin ─────────────────────────────────────────────
  if (path.startsWith('/api/admin/')) {
    const u = await sessionUser(env, req);
    requireUser(u);
    if (u.role !== 'admin') return json({ success: false, message: '需要管理员权限' }, 403);

    if (method === 'GET' && path === '/api/admin/users') {
      const r = await env.DB.prepare(
        `SELECT id, username, role, plan, banned, api_key, created_at, updated_at FROM users ORDER BY id ASC`
      ).all();
      return json({ success: true, users: r.results || [] });
    }

    const banMatch = path.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
    if (method === 'POST' && banMatch) {
      const id = Number(banMatch[1]);
      const body = await readJson<{ banned?: boolean }>(req);
      const banned = body.banned === false ? 0 : 1;
      if (id === u.id) return json({ success: false, message: '不能封禁自己' }, 400);
      await env.DB.prepare(
        `UPDATE users SET banned = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
        .bind(banned, id)
        .run();
      return json({ success: true });
    }

    const pwMatch = path.match(/^\/api\/admin\/users\/(\d+)\/password$/);
    if (method === 'POST' && pwMatch) {
      const id = Number(pwMatch[1]);
      const body = await readJson<{ password?: string }>(req);
      const pw = String(body.password || '');
      if (pw.length < 8) return json({ success: false, message: '密码至少 8 位' }, 400);
      await changePassword(env.DB, id, pw);
      return json({ success: true });
    }

    const premMatch = path.match(/^\/api\/admin\/users\/(\d+)\/premium$/);
    if (method === 'POST' && premMatch) {
      const id = Number(premMatch[1]);
      const body = await readJson<{ premium?: boolean; plan?: string }>(req);
      const plan =
        body.plan === 'free' || body.premium === false
          ? 'free'
          : 'premium';
      await env.DB.prepare(
        `UPDATE users SET plan = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
        .bind(plan, id)
        .run();
      return json({ success: true, plan });
    }
  }

  // Health
  if (method === 'GET' && path === '/api/health') {
    return json({
      success: true,
      app: env.APP_NAME || 'AI Bridge',
      time: new Date().toISOString(),
    });
  }

  return json({ success: false, message: 'not found' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return corsPreflight();

    try {
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(req, env, url);
      }
    } catch (e) {
      if (e instanceof HttpError) {
        return json({ success: false, message: e.message }, e.status);
      }
      const msg = e instanceof Error ? e.message : String(e);
      return json({ success: false, message: msg }, 500);
    }

    // Static assets / SPA
    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }
    return json({ success: false, message: 'no assets' }, 404);
  },
};
