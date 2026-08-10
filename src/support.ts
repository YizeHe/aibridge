import type { Env, UserRow } from './types';

export type SupportThread = {
  id: number;
  user_id: number;
  subject: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
};

export type SupportMessage = {
  id: number;
  thread_id: number;
  sender: 'user' | 'staff';
  user_id: number | null;
  text: string;
  created_at: string;
};

export function isRootUser(u: { username?: string; role?: string } | null | undefined): boolean {
  return !!u && String(u.username || '').toLowerCase() === 'root';
}

export async function getOrCreateUserThread(
  db: D1Database,
  userId: number,
  subject = '客服咨询'
): Promise<SupportThread> {
  const existing = await db
    .prepare(`SELECT * FROM support_threads WHERE user_id = ?`)
    .bind(userId)
    .first<SupportThread>();
  if (existing) return existing;
  const r = await db
    .prepare(`INSERT INTO support_threads (user_id, subject) VALUES (?, ?)`)
    .bind(userId, subject)
    .run();
  const id = Number(r.meta.last_row_id);
  const row = await db.prepare(`SELECT * FROM support_threads WHERE id = ?`).bind(id).first<SupportThread>();
  if (!row) throw new Error('创建工单失败');
  return row;
}

export async function listMessages(
  db: D1Database,
  threadId: number,
  sinceId = 0
): Promise<SupportMessage[]> {
  const r = await db
    .prepare(
      `SELECT * FROM support_messages WHERE thread_id = ? AND id > ? ORDER BY id ASC LIMIT 500`
    )
    .bind(threadId, sinceId)
    .all<SupportMessage>();
  return r.results || [];
}

export async function addMessage(
  db: D1Database,
  threadId: number,
  sender: 'user' | 'staff',
  userId: number | null,
  text: string
): Promise<SupportMessage> {
  const t = text.trim();
  if (!t) throw new Error('消息不能为空');
  if (t.length > 20_000) throw new Error('消息过长');
  const r = await db
    .prepare(
      `INSERT INTO support_messages (thread_id, sender, user_id, text) VALUES (?, ?, ?, ?)`
    )
    .bind(threadId, sender, userId, t)
    .run();
  const id = Number(r.meta.last_row_id);
  await db
    .prepare(
      `UPDATE support_threads SET
         last_message_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         status = 'open'
       WHERE id = ?`
    )
    .bind(threadId)
    .run();
  const row = await db
    .prepare(`SELECT * FROM support_messages WHERE id = ?`)
    .bind(id)
    .first<SupportMessage>();
  if (!row) throw new Error('发送失败');
  return row;
}

export async function listThreadsForStaff(db: D1Database): Promise<
  Array<
    SupportThread & {
      username: string;
      last_preview: string | null;
      message_count: number;
    }
  >
> {
  const r = await db
    .prepare(
      `SELECT t.*, u.username AS username,
        (SELECT text FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_preview,
        (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id = t.id) AS message_count
       FROM support_threads t
       JOIN users u ON u.id = t.user_id
       ORDER BY t.last_message_at DESC
       LIMIT 200`
    )
    .all<
      SupportThread & {
        username: string;
        last_preview: string | null;
        message_count: number;
      }
    >();
  return r.results || [];
}

export async function getThread(db: D1Database, id: number): Promise<SupportThread | null> {
  return (await db.prepare(`SELECT * FROM support_threads WHERE id = ?`).bind(id).first()) as SupportThread | null;
}

export function publicMessage(m: SupportMessage) {
  return {
    id: m.id,
    thread_id: m.thread_id,
    sender: m.sender,
    text: m.text,
    created_at: m.created_at,
  };
}
