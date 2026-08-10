import type { Env, ProjectRow, UserRow, MessageRow } from './types';

export async function getUserByUsername(env: Env, username: string) {
  return env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRow>();
}

export async function getUserById(env: Env, id: number) {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function getUserByApiKey(env: Env, apiKey: string) {
  return env.DB.prepare('SELECT * FROM users WHERE api_key = ?').bind(apiKey).first<UserRow>();
}

export async function countProjects(env: Env, userId: number) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) as c FROM projects WHERE user_id = ?'
  )
    .bind(userId)
    .first<{ c: number }>();
  return Number(row?.c || 0);
}

export async function listProjects(env: Env, userId: number) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM projects WHERE user_id = ? ORDER BY id DESC'
  )
    .bind(userId)
    .all<ProjectRow>();
  return results || [];
}

export async function getProject(env: Env, id: number) {
  return env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>();
}

export async function getProjectForUser(env: Env, id: number, userId: number) {
  return env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<ProjectRow>();
}

export async function listMessages(env: Env, projectId: number, afterId = 0, limit = 200) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM messages WHERE project_id = ? AND id > ? ORDER BY id ASC LIMIT ?`
  )
    .bind(projectId, afterId, limit)
    .all<MessageRow>();
  return results || [];
}

export async function pendingUserMessages(env: Env, projectId: number) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM messages WHERE project_id = ? AND role = 'user' AND acked = 0 ORDER BY id ASC`
  )
    .bind(projectId)
    .all<MessageRow>();
  return results || [];
}

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    status: u.status,
    api_key: u.api_key,
    created_at: u.created_at,
  };
}
