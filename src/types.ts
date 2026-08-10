export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  PROJECT_ROOM?: DurableObjectNamespace;
  APP_NAME?: string;
  SITE_NAME?: string;
  SITE_URL?: string;
  CAPTCHA_SECRET?: string;
  JWT_SECRET?: string;
  /** Optional override for public base URL */
  PUBLIC_BASE?: string;
  /** Set to "1" to enable commercial mode (plan limits + payment) */
  COMMERCIAL?: string;
  MERCHANT_PID?: string;
  MERCHANT_KEY?: string;
  PLATFORM_KEY?: string;
  NOTIFY_URL?: string;
};

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: 'user' | 'admin';
  plan: 'free' | 'premium';
  banned: number;
  api_key: string;
  premium_until?: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectRow = {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  project_id: number;
  role: 'user' | 'agent';
  text: string;
  acked: number;
  created_at: string;
};

export type OrderRow = {
  id: string;
  user_id: number;
  plan: 'monthly' | 'yearly' | string;
  amount: number;
  pay_type: string | null;
  status: 'pending' | 'paid' | 'failed' | string;
  trade_no: string | null;
  created_at: string;
  paid_at: string | null;
};

export type SessionUser = {
  id: number;
  username: string;
  role: 'user' | 'admin';
  plan: 'free' | 'premium';
  banned: boolean;
  api_key: string;
  premium_until?: string | null;
};

/** Commercial features (plan limits, payment) only when COMMERCIAL === "1" */
export function isCommercial(env: { COMMERCIAL?: string }): boolean {
  return String(env.COMMERCIAL || '') === '1';
}

/**
 * Premium is active when plan=premium and
 * (premium_until is null OR premium_until > now).
 * null premium_until means lifetime / no expiry (e.g. legacy grants).
 */
export function isPremiumActive(
  user: { plan?: string; premium_until?: string | null } | null | undefined
): boolean {
  if (!user || user.plan !== 'premium') return false;
  if (user.premium_until == null || user.premium_until === '') return true;
  const until = Date.parse(user.premium_until);
  if (Number.isNaN(until)) return false;
  return until > Date.now();
}
