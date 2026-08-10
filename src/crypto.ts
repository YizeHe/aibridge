/** Password hashing (PBKDF2-SHA256) + random tokens for Workers */

const enc = new TextEncoder();

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomHex(bytes = 32): string {
  const u8 = crypto.getRandomValues(new Uint8Array(bytes));
  return bufToHex(u8);
}

export function randomId(): string {
  return crypto.randomUUID();
}

export function generateApiKey(): string {
  return 'ak_' + randomHex(24);
}

export async function hashPassword(password: string, saltHex?: string): Promise<string> {
  const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return `pbkdf2_sha256$100000$${bufToHex(salt)}$${bufToHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  // Accept pbkdf2_sha256$iter$salt$hash and legacy pbkdf2$iter$salt$hash
  if (parts.length !== 4) return false;
  if (parts[0] !== 'pbkdf2_sha256' && parts[0] !== 'pbkdf2') return false;
  const saltHex = parts[2];
  const expected = parts[3];
  if (!saltHex || !expected) return false;
  try {
    const salt = hexToBuf(saltHex);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const gotHash = bufToHex(bits);
    if (gotHash.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ gotHash.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const dig = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return bufToHex(dig);
}

export function secrets(env: { CAPTCHA_SECRET?: string; JWT_SECRET?: string }) {
  return {
    captcha: env.CAPTCHA_SECRET || 'aibridge-dev-captcha-secret-change-me',
    session: env.JWT_SECRET || 'aibridge-dev-session-secret-change-me',
  };
}
