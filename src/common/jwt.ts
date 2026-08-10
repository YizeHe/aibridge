/**
 * Legacy JWT session helpers (unused).
 * Runtime sessions use D1 `sessions` table via src/auth.ts.
 * Kept as type-only stubs so the tree typechecks without the `jose` package.
 */

export type UserRole = 'user' | 'admin';

export interface Claims {
  sub: number;
  username: string;
  role: UserRole;
}

export async function signSession(
  _secret: string,
  _claims: Claims,
  _ttl = 86400 * 7
): Promise<{ token: string; exp: number }> {
  throw new Error('JWT sessions are not used; see auth.ts createSession');
}

export async function verifySession(_secret: string, _token: string): Promise<Claims | null> {
  return null;
}
