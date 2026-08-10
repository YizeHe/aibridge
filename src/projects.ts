import type { Env, ProjectRow, UserRow } from './types';
import { slugify } from './http';

export async function countProjects(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM projects WHERE user_id = ?')
    .bind(userId)
    .first<{ c: number }>();
  return Number(row?.c || 0);
}

export async function listProjects(db: D1Database, userId: number): Promise<ProjectRow[]> {
  const r = await db
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(userId)
    .all<ProjectRow>();
  return r.results || [];
}

export async function getProject(db: D1Database, id: number): Promise<ProjectRow | null> {
  return (await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()) as ProjectRow | null;
}

export async function getProjectBySlug(
  db: D1Database,
  userId: number,
  slug: string
): Promise<ProjectRow | null> {
  return (await db
    .prepare('SELECT * FROM projects WHERE user_id = ? AND slug = ?')
    .bind(userId, slug)
    .first()) as ProjectRow | null;
}

export async function createProject(
  env: Env,
  user: UserRow | { id: number; plan: string },
  name: string,
  description = ''
): Promise<{ ok: true; project: ProjectRow } | { ok: false; error: string; status: number }> {
  const n = name.trim();
  if (!n || n.length > 64) {
    return { ok: false, error: '项目名称 1-64 字符', status: 400 };
  }
  const count = await countProjects(env.DB, user.id);
  if (user.plan !== 'premium' && count >= 1) {
    return {
      ok: false,
      error: '免费账号仅可创建 1 个项目，请升级 Premium',
      status: 403,
    };
  }

  let base = slugify(n);
  let slug = base;
  let i = 0;
  while (await getProjectBySlug(env.DB, user.id, slug)) {
    i += 1;
    slug = `${base}-${i}`;
  }

  try {
    const r = await env.DB.prepare(
      `INSERT INTO projects (user_id, name, slug, description) VALUES (?, ?, ?, ?)`
    )
      .bind(user.id, n, slug, description.slice(0, 500))
      .run();
    const id = Number(r.meta.last_row_id);
    const project = await getProject(env.DB, id);
    if (!project) return { ok: false, error: '创建失败', status: 500 };
    return { ok: true, project };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), status: 500 };
  }
}

export async function deleteProject(db: D1Database, userId: number, projectId: number): Promise<boolean> {
  const r = await db
    .prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
    .bind(projectId, userId)
    .run();
  return (r.meta.changes || 0) > 0;
}

export async function touchProject(db: D1Database, projectId: number): Promise<void> {
  await db
    .prepare(`UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .bind(projectId)
    .run();
}

/** Resolve project for API key user by id or slug */
export async function resolveProjectForUser(
  db: D1Database,
  userId: number,
  projectRef: string
): Promise<ProjectRow | null> {
  const asNum = Number(projectRef);
  if (Number.isInteger(asNum) && asNum > 0) {
    const p = await getProject(db, asNum);
    if (p && p.user_id === userId) return p;
  }
  return getProjectBySlug(db, userId, projectRef);
}
