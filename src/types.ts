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
};

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: 'user' | 'admin';
  plan: 'free' | 'premium';
  banned: number;
  api_key: string;
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

export type SessionUser = {
  id: number;
  username: string;
  role: 'user' | 'admin';
  plan: 'free' | 'premium';
  banned: boolean;
  api_key: string;
};
