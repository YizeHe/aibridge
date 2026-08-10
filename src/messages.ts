import type { MessageRow } from './types';
import { randomId } from './crypto';
import { touchProject } from './projects';

export function toMessage(m: MessageRow) {
  return {
    id: m.id,
    project_id: m.project_id,
    role: m.role,
    text: m.text,
    acked: Boolean(m.acked),
    ts: m.created_at,
  };
}

export async function listMessages(
  db: D1Database,
  projectId: number,
  opts: { since?: string; limit?: number } = {}
): Promise<MessageRow[]> {
  const limit = Math.min(Math.max(opts.limit || 200, 1), 500);
  if (opts.since) {
    const r = await db
      .prepare(
        `SELECT * FROM messages WHERE project_id = ? AND created_at > ?
         ORDER BY created_at ASC LIMIT ?`
      )
      .bind(projectId, opts.since, limit)
      .all<MessageRow>();
    return r.results || [];
  }
  const r = await db
    .prepare(
      `SELECT * FROM messages WHERE project_id = ?
       ORDER BY created_at ASC LIMIT ?`
    )
    .bind(projectId, limit)
    .all<MessageRow>();
  return r.results || [];
}

export async function pendingUserMessages(db: D1Database, projectId: number): Promise<MessageRow[]> {
  const r = await db
    .prepare(
      `SELECT * FROM messages WHERE project_id = ? AND role = 'user' AND acked = 0
       ORDER BY created_at ASC LIMIT 50`
    )
    .bind(projectId)
    .all<MessageRow>();
  return r.results || [];
}

export async function addMessage(
  db: D1Database,
  projectId: number,
  role: 'user' | 'agent',
  text: string,
  acked = false
): Promise<MessageRow> {
  const id = randomId();
  const created_at = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO messages (id, project_id, role, text, acked, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, role, text, acked ? 1 : 0, created_at)
    .run();
  await touchProject(db, projectId);
  return {
    id,
    project_id: projectId,
    role,
    text,
    acked: acked ? 1 : 0,
    created_at,
  };
}

export async function ackMessages(db: D1Database, projectId: number, ids?: string[]): Promise<number> {
  if (ids && ids.length) {
    let n = 0;
    for (const id of ids) {
      const r = await db
        .prepare(`UPDATE messages SET acked = 1 WHERE id = ? AND project_id = ? AND role = 'user'`)
        .bind(id, projectId)
        .run();
      n += r.meta.changes || 0;
    }
    return n;
  }
  const r = await db
    .prepare(`UPDATE messages SET acked = 1 WHERE project_id = ? AND role = 'user' AND acked = 0`)
    .bind(projectId)
    .run();
  return r.meta.changes || 0;
}

export async function agentReply(
  db: D1Database,
  projectId: number,
  text: string
): Promise<MessageRow> {
  await ackMessages(db, projectId);
  return addMessage(db, projectId, 'agent', text, true);
}
