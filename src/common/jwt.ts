import * as jose from 'jose';
import type { UserRole } from '../types';

export interface Claims {
  sub: number;
  username: string;
  role: UserRole;
}

export async function signSession(secret: string, claims: Claims, ttl = 86400 * 7) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const token = await new jose.SignJWT({
    username: claims.username,
    role: claims.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(claims.sub))
    .setExpirationTime(exp)
    .setIssuedAt()
    .sign(new TextEncoder().encode(secret));
  return { token, exp };
}

export async function verifySession(secret: string, token: string): Promise<Claims | null> {
  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(secret));
    const sub = Number(payload.sub);
    if (!sub) return null;
    return {
      sub,
      username: String(payload.username || ''),
      role: (payload.role as UserRole) || 'user',
    };
  } catch {
    return null;
  }
}
