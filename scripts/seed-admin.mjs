/**
 * Seed / reset admin root with password ROOT12345678
 * Hash format matches src/crypto.ts: pbkdf2_sha256$100000$salt$hash
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ITER = 100_000;
const password = process.env.ADMIN_PASSWORD || 'ROOT12345678';

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(pw) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pw),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2_sha256$${ITER}$${toHex(salt)}$${toHex(bits)}`;
}

const password_hash = await hashPassword(password);
const api_key = 'ak_' + toHex(webcrypto.getRandomValues(new Uint8Array(24)));

const sql = `
INSERT INTO users (username, password_hash, role, plan, banned, api_key)
SELECT 'root', '${password_hash}', 'admin', 'premium', 0, '${api_key}'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'root' COLLATE NOCASE);

UPDATE users
SET password_hash = '${password_hash}',
    role = 'admin',
    plan = 'premium',
    banned = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE username = 'root' COLLATE NOCASE;

SELECT id, username, role, plan, banned, substr(api_key, 1, 12) AS api_key_prefix
FROM users WHERE username = 'root' COLLATE NOCASE;
`;

const sqlPath = join(root, 'scripts', '_seed_admin.sql');
writeFileSync(sqlPath, sql, 'utf8');

const remote = process.env.REMOTE === '1' ? ['--remote'] : ['--local'];
const r = spawnSync(
  'npx.cmd',
  ['wrangler', 'd1', 'execute', 'aibridge-db', ...remote, '--file', sqlPath],
  { stdio: 'inherit', shell: true, cwd: root }
);
console.log('admin user: root');
console.log('admin password:', password);
process.exit(r.status ?? 0);
