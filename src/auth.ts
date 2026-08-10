import type { Env, SessionUser, UserRow } from './types';
import { generateApiKey, hashPassword, randomId, verifyPassword } from './crypto';
import { getCookie } from './http';

const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

export function publicUser(u: UserRow | SessionUser) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    plan: u.plan,
    banned: 'banned' in u ? Boolean((u as UserRow).banned) : (u as SessionUser).banned,
    api_key: u.api_key,
    created_at: 'created_at' in u ? (u as UserRow).created_at : undefined,
  };
}

export async function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return (await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()) as UserRow | null;
}

export async function getUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return (await db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .bind(username)
    .first()) as UserRow | null;
}

export async function getUserByApiKey(db: D1Database, apiKey: string): Promise<UserRow | null> {
  return (await db.prepare('SELECT * FROM users WHERE api_key = ?').bind(apiKey).first()) as UserRow | null;
}

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const id = randomId();
  const expires = new Date(Date.now() + SESSION_TTL_SEC * 1000).toISOString();
  await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(id, userId, expires).run();
  return id;
}

export async function destroySession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

export async function sessionUser(env: Env, req: Request): Promise<SessionUser | null> {
  const sessionId =
    getCookie(req, 'aibridge_session') ||
    req.headers.get('X-Session') ||
    (req.headers.get('Authorization')?.startsWith('Session ')
      ? req.headers.get('Authorization')!.slice(8).trim()
      : null);
  if (!sessionId) return null;
  const row = (await env.DB.prepare(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  )
    .bind(sessionId)
    .first()) as UserRow | null;
  if (!row) return null;
  if (row.banned) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    plan: row.plan,
    banned: false,
    api_key: row.api_key,
  };
}

export async function apiKeyUser(env: Env, req: Request): Promise<UserRow | null> {
  const auth = req.headers.get('Authorization') || '';
  let key = '';
  if (auth.startsWith('Bearer ')) key = auth.slice(7).trim();
  else if (auth.startsWith('ApiKey ')) key = auth.slice(7).trim();
  else key = req.headers.get('X-Api-Key') || '';
  if (!key) return null;
  const u = await getUserByApiKey(env.DB, key);
  if (!u || u.banned) return null;
  return u;
}

export async function registerUser(
  db: D1Database,
  username: string,
  password: string
): Promise<{ ok: true; user: UserRow } | { ok: false; error: string }> {
  const name = username.trim();
  if (!/^[a-zA-Z0-9_\u4e00-\u9fff]{2,32}$/.test(name)) {
    return { ok: false, error: '用户名需 2-32 位，字母数字下划线或中文' };
  }
  if (password.length < 8) {
    return { ok: false, error: '密码至少 8 位' };
  }
  const exists = await getUserByUsername(db, name);
  if (exists) return { ok: false, error: '用户名已存在' };

  const password_hash = await hashPassword(password);
  const api_key = generateApiKey();
  const role = name.toLowerCase() === 'root' ? 'admin' : 'user';
  const plan = name.toLowerCase() === 'root' ? 'premium' : 'free';

  try {
    const r = await db
      .prepare(
        `INSERT INTO users (username, password_hash, role, plan, api_key)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(name, password_hash, role, plan, api_key)
      .run();
    const id = Number(r.meta.last_row_id);
    const user = await getUserById(db, id);
    if (!user) return { ok: false, error: '创建失败' };
    return { ok: true, user };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) return { ok: false, error: '用户名已存在' };
    return { ok: false, error: msg };
  }
}

export async function ensureAdminSeed(db: D1Database): Promise<void> {
  const root = await getUserByUsername(db, 'root');
  if (root) return;
  const password_hash = await hashPassword('ROOT12345678');
  const api_key = generateApiKey();
  await db
    .prepare(
      `INSERT INTO users (username, password_hash, role, plan, api_key)
       VALUES ('root', ?, 'admin', 'premium', ?)`
    )
    .bind(password_hash, api_key)
    .run();
}

export async function changePassword(
  db: D1Database,
  userId: number,
  newPassword: string
): Promise<void> {
  const password_hash = await hashPassword(newPassword);
  await db
    .prepare(
      `UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    )
    .bind(password_hash, userId)
    .run();
}

export async function rotateApiKey(db: D1Database, userId: number): Promise<string> {
  const api_key = generateApiKey();
  await db
    .prepare(
      `UPDATE users SET api_key = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    )
    .bind(api_key, userId)
    .run();
  return api_key;
}

export { verifyPassword, SESSION_TTL_SEC };
