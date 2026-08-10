/**
 * AI Bridge — Cloudflare Worker
 * Domain: aibridge.tanstudio.me
 */
import type { Env, ProjectRow, UserRow } from './types';
import { isCommercial, isPremiumActive } from './types';
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
  canUseProject,
  freeTierPrimaryProjectId,
  FREE_TIER_PROJECT_MSG,
} from './projects';
import {
  createPayOrder,
  handlePayNotify,
  PUBLIC_PLANS,
  type PayPlanId,
} from './pay';
import {
  deleteFile,
  getFile,
  listFileChanges,
  listFiles,
  publicFile,
  upsertFile,
} from './files';
import {
  addMessage as addSupportMessage,
  getOrCreateUserThread,
  getThread as getSupportThread,
  isRootUser,
  listMessages as listSupportMessages,
  listThreadsForStaff,
  publicMessage as publicSupportMessage,
} from './support';

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

let seeded = false;
async function seedOnce(env: Env) {
  if (seeded) return;
  // 确保 root 管理员存在（正式站 / 自建均可登录后台）
  try {
    const pw = env.ADMIN_PASSWORD || 'ROOT12345678';
    await ensureAdminSeed(env.DB, pw);
    seeded = true;
  } catch {
    // 表可能尚未 migrate
  }
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  await seedOnce(env);
  const path = url.pathname;
  const method = req.method.toUpperCase();
  const commercial = isCommercial(env);

  // ── Public config (Turnstile site key etc.) ───────────
  if (method === 'GET' && path === '/api/config') {
    return json({
      success: true,
      commercial,
      turnstile_site_key: env.TURNSTILE_SITEKEY || '',
      site_url: env.SITE_URL || '',
    });
  }

  // ── Plans (public) ────────────────────────────────────
  if (method === 'GET' && path === '/api/plans') {
    return json({
      success: true,
      commercial,
      plans: commercial ? PUBLIC_PLANS : [],
      turnstile_site_key: env.TURNSTILE_SITEKEY || '',
    });
  }

  // ── Payment (commercial only) ─────────────────────────
  if (path === '/api/pay/create' || path === '/api/pay/notify') {
    if (!commercial) {
      return json({ success: false, message: 'not found' }, 404);
    }
  }

  if (method === 'POST' && path === '/api/pay/create') {
    const u = await sessionUser(env, req);
    requireUser(u);
    const body = await readJson<{ plan?: string; payType?: string }>(req);
    const plan = String(body.plan || '') as PayPlanId;
    const payType = String(body.payType || '');
    if (plan !== 'monthly' && plan !== 'yearly') {
      return json({ success: false, message: '无效套餐' }, 400);
    }
    if (payType !== 'alipay' && payType !== 'wxpay') {
      return json({ success: false, message: '无效支付方式' }, 400);
    }
    const r = await createPayOrder(env, req, u.id, plan, payType);
    if (!r.ok) return json({ success: false, message: r.error }, r.status);
    return json({
      success: true,
      payUrl: r.payUrl,
      payMethod: r.payMethod,
      payFields: r.payFields,
      order_no: r.order_no,
    });
  }

  if ((method === 'POST' || method === 'GET') && path === '/api/pay/notify') {
    return handlePayNotify(env, req, url);
  }

  // ── Auth ──────────────────────────────────────────────
  if (method === 'POST' && path === '/api/auth/register') {
    const body = await readJson<{
      username?: string;
      password?: string;
      turnstile_token?: string;
      captcha_token?: string;
    }>(req);

    const turnstileToken = String(body.turnstile_token || body.captcha_token || '');
    if (!turnstileToken) {
      return json({ success: false, message: '请完成人机验证' }, 400);
    }
    const secret = env.TURNSTILE_SECRET || '';
    if (secret) {
      try {
        const ip =
          req.headers.get('CF-Connecting-IP') ||
          req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
          '';
        const form = new URLSearchParams();
        form.set('secret', secret);
        form.set('response', turnstileToken);
        if (ip) form.set('remoteip', ip);
        const vr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        const vd = (await vr.json()) as { success?: boolean; 'error-codes'?: string[] };
        if (!vd.success) {
          return json(
            {
              success: false,
              message: '人机验证失败，请重试',
              codes: vd['error-codes'] || [],
            },
            400
          );
        }
      } catch {
        return json({ success: false, message: '人机验证服务不可用' }, 503);
      }
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

  // ── Redeem activation code ────────────────────────────
  if (method === 'POST' && path === '/api/redeem') {
    const u = await sessionUser(env, req);
    requireUser(u);
    const body = await readJson<{ code?: string }>(req);
    const code = String(body.code || '').trim();
    if (!code) return json({ success: false, message: '请输入激活码' }, 400);

    const row = await env.DB.prepare(
      `SELECT code, days, max_uses, used_count, enabled FROM redeem_codes WHERE code = ? COLLATE NOCASE`
    )
      .bind(code)
      .first<{
        code: string;
        days: number;
        max_uses: number;
        used_count: number;
        enabled: number;
      }>();
    if (!row || !row.enabled) return json({ success: false, message: '激活码无效' }, 400);
    if (row.max_uses > 0 && row.used_count >= row.max_uses) {
      return json({ success: false, message: '激活码已用完' }, 400);
    }

    const used = await env.DB.prepare(
      `SELECT id FROM redeem_uses WHERE code = ? AND user_id = ?`
    )
      .bind(row.code, u.id)
      .first();
    if (used) return json({ success: false, message: '该激活码本账号已使用过' }, 400);

    const full = await getUserById(env.DB, u.id);
    if (!full) return json({ success: false, message: '用户不存在' }, 404);

    const now = Date.now();
    let base = now;
    if (full.plan === 'premium' && full.premium_until) {
      const t = Date.parse(full.premium_until);
      if (!Number.isNaN(t) && t > now) base = t;
    }
    const until = new Date(base + Math.max(1, Number(row.days) || 2) * 86400000).toISOString();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO redeem_uses (code, user_id) VALUES (?, ?)`
      ).bind(row.code, u.id),
      env.DB.prepare(
        `UPDATE redeem_codes SET used_count = used_count + 1 WHERE code = ?`
      ).bind(row.code),
      env.DB.prepare(
        `UPDATE users SET plan = 'premium', premium_until = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      ).bind(until, u.id),
    ]);

    const updated = await getUserById(env.DB, u.id);
    return json({
      success: true,
      message: `激活成功，会员已延长 ${row.days} 天`,
      user: updated ? publicUser(updated) : publicUser(u),
      premium_until: until,
    });
  }

  // ── Projects (session) ────────────────────────────────
  if (method === 'GET' && path === '/api/projects') {
    const u = await sessionUser(env, req);
    requireUser(u);
    const full = await getUserById(env.DB, u.id);
    const projects = await listProjects(env.DB, u.id);
    const premium = isPremiumActive(full || u);
    const primaryId =
      commercial && !premium ? await freeTierPrimaryProjectId(env.DB, u.id) : null;
    const enriched = projects.map((p) => ({
      ...p,
      usable: !commercial || premium || p.id === primaryId,
      locked: commercial && !premium && p.id !== primaryId,
    }));
    return json({
      success: true,
      projects: enriched,
      free_tier_limit: commercial && !premium,
      free_tier_message: commercial && !premium ? FREE_TIER_PROJECT_MSG : null,
    });
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
      // commercial-only: role=admin may view others; OSS has no admin surface
      if (!commercial || u.role !== 'admin' || !project) {
        return json({ success: false, message: '项目不存在' }, 404);
      }
    }
    if (!project) return json({ success: false, message: '项目不存在' }, 404);
    if (project.user_id !== u.id && !(commercial && u.role === 'admin')) {
      return json({ success: false, message: '无权访问' }, 403);
    }

    // Free tier after membership expiry: only the primary (earliest) project is usable
    const fullOwner = await getUserById(env.DB, u.id);
    const ownerForLimit = fullOwner || u;
    const isOwner = project.user_id === u.id;
    if (isOwner && !(await canUseProject(env, ownerForLimit, project))) {
      // allow GET metadata + DELETE so user can clean up; block active use
      const allowMeta = method === 'GET' && rest === '';
      const allowDelete = method === 'DELETE' && rest === '';
      if (!allowMeta && !allowDelete) {
        return json({ success: false, message: FREE_TIER_PROJECT_MSG, locked: true }, 403);
      }
    }

    if (method === 'GET' && rest === '') {
      const usable = await canUseProject(env, ownerForLimit, project);
      return json({
        success: true,
        project: { ...project, usable, locked: !usable },
      });
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

    // ── Project files (workspace) ───────────────────────
    if (method === 'GET' && rest === '/files') {
      const files = await listFiles(env.DB, projectId);
      return json({ success: true, files });
    }

    if (method === 'GET' && rest === '/files/changes') {
      const since = url.searchParams.get('since') || new Date(0).toISOString();
      const files = await listFileChanges(env.DB, projectId, since);
      return json({ success: true, files, server_time: new Date().toISOString() });
    }

    if (method === 'GET' && rest === '/files/content') {
      const p = url.searchParams.get('path') || '';
      const row = await getFile(env.DB, projectId, p);
      if (!row) {
        // try normalized via upsert path rules
        const { normalizePath } = await import('./files');
        const np = normalizePath(p);
        const row2 = np ? await getFile(env.DB, projectId, np) : null;
        if (!row2) return json({ success: false, message: '文件不存在' }, 404);
        return json({ success: true, file: publicFile(row2, true) });
      }
      return json({ success: true, file: publicFile(row, true) });
    }

    if (method === 'PUT' && rest === '/files') {
      if (project.user_id !== u.id) return json({ success: false, message: '无权写入' }, 403);
      const body = await readJson<{
        path?: string;
        content?: string;
        encoding?: string;
        content_type?: string;
        base_version?: number;
      }>(req);
      const r = await upsertFile(env, projectId, String(body.path || ''), String(body.content ?? ''), {
        encoding: body.encoding,
        content_type: body.content_type,
        base_version: body.base_version ?? null,
      });
      if (!r.ok) {
        return json(
          {
            success: false,
            message: r.error,
            file: r.current ? publicFile(r.current, true) : undefined,
          },
          r.status
        );
      }
      return json({ success: true, file: publicFile(r.file, true) });
    }

    if (method === 'DELETE' && rest === '/files') {
      if (project.user_id !== u.id) return json({ success: false, message: '无权删除' }, 403);
      const p = url.searchParams.get('path') || '';
      const r = await deleteFile(env, projectId, p);
      if (!r.ok) return json({ success: false, message: r.error }, r.status);
      return json({ success: true });
    }

    if (method === 'GET' && rest === '/events') {
      if (project.user_id !== u.id && !(commercial && u.role === 'admin')) {
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
          const maxTicks = 45;
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
  async function requireAgentProject(
    agent: UserRow,
    pref: string
  ): Promise<{ project: ProjectRow } | Response> {
    if (!pref) return json({ success: false, message: '缺少 project 参数' }, 400);
    const project = await resolveProjectForUser(env.DB, agent.id, pref);
    if (!project) return json({ success: false, message: '项目不存在' }, 404);
    if (!(await canUseProject(env, agent, project))) {
      return json({ success: false, message: FREE_TIER_PROJECT_MSG, locked: true }, 403);
    }
    return { project };
  }

  if (method === 'GET' && path === '/api/agent/pending') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const pref = url.searchParams.get('project') || url.searchParams.get('p') || '';
    const resolved = await requireAgentProject(agent, pref);
    if (resolved instanceof Response) return resolved;
    const { project } = resolved;
    const msgs = await pendingUserMessages(env.DB, project.id);
    return json({
      success: true,
      project: { id: project.id, name: project.name, slug: project.slug },
      messages: msgs.map(toMessage),
    });
  }

  if (method === 'POST' && path === '/api/agent/reply') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const body = await readJson<{ project?: string; text?: string; p?: string }>(req);
    const pref = String(body.project || body.p || '');
    const text = String(body.text || '').trim();
    if (!text) return json({ success: false, message: '回复不能为空' }, 400);
    const resolved = await requireAgentProject(agent, pref);
    if (resolved instanceof Response) return resolved;
    const { project } = resolved;
    const msg = await agentReply(env.DB, project.id, text);
    return json({ success: true, message: toMessage(msg) });
  }

  if (method === 'POST' && path === '/api/agent/ack') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const body = await readJson<{ project?: string; ids?: string[] }>(req);
    const resolved = await requireAgentProject(agent, String(body.project || ''));
    if (resolved instanceof Response) return resolved;
    const { project } = resolved;
    const n = await ackMessages(env.DB, project.id, body.ids);
    return json({ success: true, acked: n });
  }

  // Agent files
  if (method === 'GET' && path === '/api/agent/files') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const pref = url.searchParams.get('project') || url.searchParams.get('p') || '';
    const resolved = await requireAgentProject(agent, pref);
    if (resolved instanceof Response) return resolved;
    const { project } = resolved;
    const since = url.searchParams.get('since');
    if (since) {
      const files = await listFileChanges(env.DB, project.id, since);
      return json({
        success: true,
        project: { id: project.id, name: project.name, slug: project.slug },
        files,
        server_time: new Date().toISOString(),
      });
    }
    const files = await listFiles(env.DB, project.id);
    return json({
      success: true,
      project: { id: project.id, name: project.name, slug: project.slug },
      files,
    });
  }

  if (method === 'GET' && path === '/api/agent/file') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const pref = url.searchParams.get('project') || url.searchParams.get('p') || '';
    const fpath = url.searchParams.get('path') || '';
    const resolved = await requireAgentProject(agent, pref);
    if (resolved instanceof Response) return resolved;
    const { project } = resolved;
    const row = await getFile(env.DB, project.id, fpath);
    if (!row) return json({ success: false, message: '文件不存在' }, 404);
    return json({ success: true, file: publicFile(row, true) });
  }

  if (method === 'PUT' && path === '/api/agent/file') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const body = await readJson<{
      project?: string;
      p?: string;
      path?: string;
      content?: string;
      encoding?: string;
      content_type?: string;
      base_version?: number;
    }>(req);
    const pref = String(body.project || body.p || '');
    const resolved = await requireAgentProject(agent, pref);
    if (resolved instanceof Response) return resolved;
    const { project } = resolved;
    const r = await upsertFile(env, project.id, String(body.path || ''), String(body.content ?? ''), {
      encoding: body.encoding,
      content_type: body.content_type,
      base_version: body.base_version ?? null,
    });
    if (!r.ok) {
      return json(
        {
          success: false,
          message: r.error,
          file: r.current ? publicFile(r.current, true) : undefined,
        },
        r.status
      );
    }
    return json({ success: true, file: publicFile(r.file, true) });
  }

  if (method === 'DELETE' && path === '/api/agent/file') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const pref = url.searchParams.get('project') || url.searchParams.get('p') || '';
    const fpath = url.searchParams.get('path') || '';
    const resolved = await requireAgentProject(agent, pref);
    if (resolved instanceof Response) return resolved;
    const { project } = resolved;
    const r = await deleteFile(env, project.id, fpath);
    if (!r.ok) return json({ success: false, message: r.error }, r.status);
    return json({ success: true });
  }

  if (method === 'GET' && path === '/api/agent/projects') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const projects = await listProjects(env.DB, agent.id);
    const premium = isPremiumActive(agent);
    const primaryId =
      isCommercial(env) && !premium ? await freeTierPrimaryProjectId(env.DB, agent.id) : null;
    return json({
      success: true,
      user: { username: agent.username, plan: agent.plan, is_premium: premium },
      projects: projects.map((p) => ({
        ...p,
        usable: !isCommercial(env) || premium || p.id === primaryId,
        locked: isCommercial(env) && !premium && p.id !== primaryId,
      })),
    });
  }

  if (method === 'POST' && path === '/api/agent/projects') {
    const agent = await apiKeyUser(env, req);
    if (!agent) return json({ success: false, message: '无效 API Key' }, 401);
    const body = await readJson<{ name?: string; description?: string }>(req);
    const name = String(body.name || '').trim();
    if (!name) return json({ success: false, message: '缺少 name' }, 400);
    const existing = await listProjects(env.DB, agent.id);
    const hit = existing.find((p) => p.name === name || p.slug === name);
    if (hit) return json({ success: true, project: hit, created: false });
    const r = await createProject(env, agent, name, String(body.description || ''));
    if (!r.ok) return json({ success: false, message: r.error }, r.status);
    return json({ success: true, project: r.project, created: true });
  }

  // ── Admin (any deployment, role=admin only) ───────────
  if (path.startsWith('/api/admin/')) {
    const u = await sessionUser(env, req);
    requireUser(u);
    if (u.role !== 'admin') return json({ success: false, message: '需要管理员权限' }, 403);

    if (method === 'GET' && path === '/api/admin/users') {
      const r = await env.DB.prepare(
        `SELECT id, username, role, plan, banned, api_key, premium_until, created_at, updated_at FROM users ORDER BY id ASC`
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
      const body = await readJson<{ premium?: boolean; plan?: string; premium_until?: string | null }>(req);
      const plan =
        body.plan === 'free' || body.premium === false
          ? 'free'
          : 'premium';
      const premium_until =
        plan === 'free'
          ? null
          : body.premium_until !== undefined
            ? body.premium_until
            : null;
      await env.DB.prepare(
        `UPDATE users SET plan = ?, premium_until = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      )
        .bind(plan, premium_until, id)
        .run();
      return json({ success: true, plan, premium_until });
    }

    return json({ success: false, message: 'not found' }, 404);
  }

  // ── Support tickets (工单) ────────────────────────────
  if (method === 'GET' && path === '/api/support/thread') {
    const u = await sessionUser(env, req);
    requireUser(u);
    const thread = await getOrCreateUserThread(env.DB, u.id);
    const messages = await listSupportMessages(env.DB, thread.id, 0);
    return json({
      success: true,
      thread,
      messages: messages.map(publicSupportMessage),
    });
  }

  if (method === 'GET' && path === '/api/support/messages') {
    const u = await sessionUser(env, req);
    requireUser(u);
    const thread = await getOrCreateUserThread(env.DB, u.id);
    const since = Number(url.searchParams.get('since') || 0) || 0;
    const messages = await listSupportMessages(env.DB, thread.id, since);
    return json({ success: true, messages: messages.map(publicSupportMessage) });
  }

  if (method === 'POST' && path === '/api/support/messages') {
    const u = await sessionUser(env, req);
    requireUser(u);
    const body = await readJson<{ text?: string }>(req);
    const thread = await getOrCreateUserThread(env.DB, u.id);
    try {
      const msg = await addSupportMessage(env.DB, thread.id, 'user', u.id, String(body.text || ''));
      return json({ success: true, message: publicSupportMessage(msg) });
    } catch (e) {
      return json({ success: false, message: e instanceof Error ? e.message : String(e) }, 400);
    }
  }

  // ── Kefu desk (root only) ─────────────────────────────
  if (path.startsWith('/api/kefu/')) {
    const u = await sessionUser(env, req);
    requireUser(u);
    if (!isRootUser(u)) {
      return json({ success: false, message: '仅 root 账号可访问客服台' }, 403);
    }

    if (method === 'GET' && path === '/api/kefu/threads') {
      const threads = await listThreadsForStaff(env.DB);
      return json({ success: true, threads });
    }

    const thrMatch = path.match(/^\/api\/kefu\/threads\/(\d+)(.*)$/);
    if (thrMatch) {
      const threadId = Number(thrMatch[1]);
      const rest = thrMatch[2] || '';
      const thread = await getSupportThread(env.DB, threadId);
      if (!thread) return json({ success: false, message: '工单不存在' }, 404);

      if (method === 'GET' && rest === '') {
        const messages = await listSupportMessages(env.DB, threadId, 0);
        const owner = await getUserById(env.DB, thread.user_id);
        return json({
          success: true,
          thread,
          username: owner?.username || '',
          messages: messages.map(publicSupportMessage),
        });
      }

      if (method === 'GET' && rest === '/messages') {
        const since = Number(url.searchParams.get('since') || 0) || 0;
        const messages = await listSupportMessages(env.DB, threadId, since);
        return json({ success: true, messages: messages.map(publicSupportMessage) });
      }

      if (method === 'POST' && rest === '/reply') {
        const body = await readJson<{ text?: string }>(req);
        try {
          const msg = await addSupportMessage(
            env.DB,
            threadId,
            'staff',
            u.id,
            String(body.text || '')
          );
          return json({ success: true, message: publicSupportMessage(msg) });
        } catch (e) {
          return json({ success: false, message: e instanceof Error ? e.message : String(e) }, 400);
        }
      }
    }

    return json({ success: false, message: 'not found' }, 404);
  }

  // Health
  if (method === 'GET' && path === '/api/health') {
    return json({
      success: true,
      app: env.APP_NAME || 'AI Bridge',
      commercial,
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

    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }
    return json({ success: false, message: 'no assets' }, 404);
  },
};
