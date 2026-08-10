/** Project workspace files — list / read / write / delete with versioning */

import type { Env } from './types';
import { touchProject } from './projects';

export type FileMeta = {
  path: string;
  size: number;
  content_type: string;
  encoding: string;
  version: number;
  updated_at: string;
};

export type FileRow = FileMeta & {
  id: number;
  project_id: number;
  content: string;
};

const MAX_PATH = 512;
const MAX_TEXT_BYTES = 1_500_000; // ~1.5MB text
const MAX_B64_CHARS = 2_000_000;

export function normalizePath(raw: string): string | null {
  let p = String(raw || '').replace(/\\/g, '/').trim();
  if (!p) return null;
  p = p.replace(/^\/+/, '');
  if (p.includes('..') || p.includes('\0')) return null;
  if (p.length > MAX_PATH) return null;
  if (!/^[a-zA-Z0-9_\-./\u4e00-\u9fff]+$/.test(p)) return null;
  return p;
}

export function guessContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    json: 'application/json',
    js: 'text/javascript',
    mjs: 'text/javascript',
    cjs: 'text/javascript',
    ts: 'text/typescript',
    tsx: 'text/tsx',
    jsx: 'text/jsx',
    css: 'text/css',
    html: 'text/html',
    htm: 'text/html',
    go: 'text/x-go',
    rs: 'text/x-rust',
    py: 'text/x-python',
    java: 'text/x-java',
    c: 'text/x-c',
    h: 'text/x-c',
    cpp: 'text/x-c++',
    hpp: 'text/x-c++',
    cs: 'text/x-csharp',
    php: 'text/x-php',
    rb: 'text/x-ruby',
    sh: 'text/x-shellscript',
    bash: 'text/x-shellscript',
    yml: 'text/yaml',
    yaml: 'text/yaml',
    toml: 'text/toml',
    ini: 'text/plain',
    env: 'text/plain',
    sql: 'text/x-sql',
    xml: 'application/xml',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    wasm: 'application/wasm',
  };
  return map[ext] || 'text/plain';
}

export function isImageType(ct: string): boolean {
  return ct.startsWith('image/');
}

export function isTextyType(ct: string, path: string): boolean {
  if (ct.startsWith('text/')) return true;
  if (
    ct.includes('json') ||
    ct.includes('xml') ||
    ct.includes('javascript') ||
    ct.includes('typescript') ||
    ct.includes('yaml') ||
    ct.includes('toml') ||
    ct.includes('svg')
  )
    return true;
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return [
    'md',
    'json',
    'js',
    'ts',
    'tsx',
    'jsx',
    'css',
    'html',
    'go',
    'py',
    'rs',
    'yml',
    'yaml',
    'toml',
    'sql',
    'sh',
    'env',
    'txt',
    'c',
    'h',
    'cpp',
    'java',
    'php',
    'rb',
    'vue',
    'svelte',
  ].includes(ext);
}

function toMeta(row: FileRow): FileMeta {
  return {
    path: row.path,
    size: row.size,
    content_type: row.content_type,
    encoding: row.encoding,
    version: row.version,
    updated_at: row.updated_at,
  };
}

export async function listFiles(db: D1Database, projectId: number): Promise<FileMeta[]> {
  const r = await db
    .prepare(
      `SELECT path, size, content_type, encoding, version, updated_at
       FROM project_files WHERE project_id = ? ORDER BY path ASC`
    )
    .bind(projectId)
    .all<FileMeta>();
  return r.results || [];
}

export async function listFileChanges(
  db: D1Database,
  projectId: number,
  sinceIso: string
): Promise<FileMeta[]> {
  const r = await db
    .prepare(
      `SELECT path, size, content_type, encoding, version, updated_at
       FROM project_files
       WHERE project_id = ? AND updated_at > ?
       ORDER BY updated_at ASC`
    )
    .bind(projectId, sinceIso)
    .all<FileMeta>();
  return r.results || [];
}

export async function getFile(
  db: D1Database,
  projectId: number,
  path: string
): Promise<FileRow | null> {
  return (await db
    .prepare(`SELECT * FROM project_files WHERE project_id = ? AND path = ?`)
    .bind(projectId, path)
    .first()) as FileRow | null;
}

export async function upsertFile(
  env: Env,
  projectId: number,
  rawPath: string,
  content: string,
  opts: {
    encoding?: string;
    content_type?: string;
    base_version?: number | null;
  } = {}
): Promise<
  | { ok: true; file: FileRow }
  | { ok: false; error: string; status: number; current?: FileRow }
> {
  const path = normalizePath(rawPath);
  if (!path) return { ok: false, error: '非法路径', status: 400 };

  let encoding = (opts.encoding || 'utf8').toLowerCase();
  if (encoding !== 'utf8' && encoding !== 'base64') encoding = 'utf8';
  const content_type = opts.content_type || guessContentType(path);
  const body = String(content ?? '');

  if (encoding === 'utf8' && body.length > MAX_TEXT_BYTES) {
    return { ok: false, error: '文件过大', status: 413 };
  }
  if (encoding === 'base64' && body.length > MAX_B64_CHARS) {
    return { ok: false, error: '文件过大', status: 413 };
  }

  const size =
    encoding === 'base64'
      ? Math.floor((body.replace(/=+$/, '').length * 3) / 4)
      : new TextEncoder().encode(body).length;

  const existing = await getFile(env.DB, projectId, path);
  if (existing && opts.base_version != null && opts.base_version !== existing.version) {
    return {
      ok: false,
      error: '版本冲突：远端文件已更新',
      status: 409,
      current: existing,
    };
  }

  const now = new Date().toISOString();
  if (existing) {
    const nextVer = existing.version + 1;
    await env.DB.prepare(
      `UPDATE project_files
       SET content = ?, encoding = ?, content_type = ?, size = ?, version = ?, updated_at = ?
       WHERE project_id = ? AND path = ?`
    )
      .bind(body, encoding, content_type, size, nextVer, now, projectId, path)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO project_files (project_id, path, content, encoding, content_type, size, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(projectId, path, body, encoding, content_type, size, now)
      .run();
  }
  await touchProject(env.DB, projectId);
  const row = await getFile(env.DB, projectId, path);
  if (!row) return { ok: false, error: '写入失败', status: 500 };
  return { ok: true, file: row };
}

export async function deleteFile(
  env: Env,
  projectId: number,
  rawPath: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const path = normalizePath(rawPath);
  if (!path) return { ok: false, error: '非法路径', status: 400 };
  const r = await env.DB.prepare(
    `DELETE FROM project_files WHERE project_id = ? AND path = ?`
  )
    .bind(projectId, path)
    .run();
  if (!(r.meta.changes || 0)) return { ok: false, error: '文件不存在', status: 404 };
  await touchProject(env.DB, projectId);
  return { ok: true };
}

export function publicFile(row: FileRow, withContent = true) {
  return {
    path: row.path,
    size: row.size,
    content_type: row.content_type,
    encoding: row.encoding,
    version: row.version,
    updated_at: row.updated_at,
    ...(withContent ? { content: row.content } : {}),
  };
}

export { toMeta };
