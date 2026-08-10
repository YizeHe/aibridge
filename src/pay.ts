/**
 * pay.ykmcn.com RSA payment helpers (commercial mode only).
 * Ported from edgetunnel worker RSA + create/notify flow.
 */
import type { Env, UserRow } from './types';

export const PLAN_PRICES = {
  monthly: 5.0,
  yearly: 50.0,
} as const;

export type PayPlanId = keyof typeof PLAN_PRICES;

export const PUBLIC_PLANS = [
  { id: 'monthly' as const, name: '月付', price: PLAN_PRICES.monthly, period: 'month' },
  { id: 'yearly' as const, name: '年付', price: PLAN_PRICES.yearly, period: 'year' },
];

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = String(pem || '')
    .replace(/-----BEGIN[\s\S]*?-----/g, '')
    .replace(/-----END[\s\S]*?-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importRSAPrivateKey(pem: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function importRSAPublicKey(pem: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    'spki',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

export function buildSignString(params: Record<string, unknown>): string {
  return Object.keys(params)
    .filter(
      (k) =>
        k !== 'sign' &&
        k !== 'sign_type' &&
        params[k] !== '' &&
        params[k] !== null &&
        params[k] !== undefined
    )
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export async function rsaSign(
  params: Record<string, unknown>,
  privateKeyPem: string
): Promise<string> {
  const signStr = buildSignString(params);
  const key = await importRSAPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signStr)
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function rsaVerify(
  params: Record<string, unknown>,
  sign: string,
  publicKeyPem: string
): Promise<boolean> {
  try {
    const signStr = buildSignString(params);
    const key = await importRSAPublicKey(publicKeyPem);
    const sig = Uint8Array.from(atob(sign), (c) => c.charCodeAt(0));
    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      sig,
      new TextEncoder().encode(signStr)
    );
  } catch {
    return false;
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ||
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

export function siteBase(env: Env, req: Request): string {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/$/, '');
  if (env.PUBLIC_BASE) return env.PUBLIC_BASE.replace(/\/$/, '');
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

/**
 * 异步回调必须指向本站。历史 secret 可能写成旧项目域名（如 vpnnode），
 * 会导致付款成功但本站永远收不到 notify → 会员仍显示未开通。
 */
export function notifyUrl(env: Env, req: Request): string {
  const base = siteBase(env, req);
  const preferred = `${base}/api/pay/notify`;
  const override = (env.NOTIFY_URL || '').trim();
  if (!override) return preferred;
  // 仅当 NOTIFY_URL 明显属于本站时才使用
  try {
    const u = new URL(override);
    const host = u.hostname.toLowerCase();
    const siteHost = new URL(base).hostname.toLowerCase();
    if (host === siteHost || host.includes('aibridge')) {
      return override.replace(/\/$/, '') || preferred;
    }
  } catch {
    /* fall through */
  }
  return preferred;
}

function orderNo(): string {
  return `AB${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/** Parse notify body: form-urlencoded, multipart, query, or JSON */
export async function parsePayParams(
  req: Request,
  url: URL
): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });

  if (req.method.toUpperCase() === 'GET') return params;

  const ct = (req.headers.get('Content-Type') || '').toLowerCase();
  try {
    if (ct.includes('json')) {
      const body = (await req.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(body || {})) {
        if (v != null) params[k] = String(v);
      }
      return params;
    }
    if (ct.includes('form') || ct.includes('urlencoded') || !ct) {
      const text = await req.text();
      if (text) {
        try {
          if (ct.includes('multipart')) {
            // already consumed as text; fallback URLSearchParams may fail — try formData via clone not available
          }
          const sp = new URLSearchParams(text);
          for (const [k, v] of sp.entries()) params[k] = v;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore body parse errors */
  }
  return params;
}

const PAY_HOST = 'https://pay.ykmcn.com';

/**
 * 页面跳转支付（官方文档：pay_submit.html）
 * POST/GET https://pay.ykmcn.com/api/pay/submit
 * 推荐浏览器 POST 表单；勿用服务端 /api/pay/create（易触发安全验证）。
 * 见 https://pay.ykmcn.com/doc/pay_submit.html 与 PAYLEARNS.md
 */
export async function createPayOrder(
  env: Env,
  req: Request,
  userId: number,
  plan: PayPlanId,
  payType: 'alipay' | 'wxpay'
): Promise<
  | {
      ok: true;
      payUrl: string;
      payMethod: 'form';
      payFields: Record<string, string>;
      order_no: string;
      trade_no?: string;
    }
  | { ok: false; error: string; status: number }
> {
  const pid = env.MERCHANT_PID;
  const merchantKey = env.MERCHANT_KEY;
  if (!pid || !merchantKey) {
    return { ok: false, error: '支付未配置', status: 503 };
  }

  const amount = PLAN_PRICES[plan];
  const out_trade_no = orderNo();
  const base = siteBase(env, req);
  const notify_url = notifyUrl(env, req);
  // 避免 return_url 带 #hash；回站后再进账号页
  const return_url = `${base}/?from=pay&order=${encodeURIComponent(out_trade_no)}`;
  const name = `AIBridge ${plan === 'monthly' ? '月付' : '年付'}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  await env.DB.prepare(
    `INSERT INTO orders (id, user_id, plan, amount, pay_type, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  )
    .bind(out_trade_no, userId, plan, amount, payType)
    .run();

  // 严格按官方「页面跳转支付」字段（不含 method / clientip / device）
  const payParams: Record<string, string> = {
    pid: String(pid),
    type: payType,
    out_trade_no,
    notify_url,
    return_url,
    name,
    money: amount.toFixed(2),
    timestamp,
    sign_type: 'RSA',
  };

  try {
    payParams.sign = await rsaSign(payParams, merchantKey);
    return {
      ok: true,
      payUrl: `${PAY_HOST}/api/pay/submit`,
      payMethod: 'form',
      payFields: payParams,
      order_no: out_trade_no,
    };
  } catch (e: unknown) {
    await env.DB.prepare(`UPDATE orders SET status = 'failed' WHERE id = ?`)
      .bind(out_trade_no)
      .run();
    return {
      ok: false,
      error: '支付签名失败: ' + (e instanceof Error ? e.message : String(e)),
      status: 502,
    };
  }
}

function extendPremiumUntil(existing: string | null | undefined, plan: string): string {
  const now = new Date();
  let base = now;
  if (existing) {
    const t = Date.parse(existing);
    if (!Number.isNaN(t) && t > now.getTime()) {
      base = new Date(t);
    }
  }
  const next = new Date(base);
  if (plan === 'yearly') {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next.toISOString();
}

export type OrderRow = {
  id: string;
  user_id: number;
  plan: string;
  status: string;
  amount?: number;
  trade_no?: string | null;
};

/** 将本地订单标记已支付并延长会员（幂等） */
export async function fulfillPaidOrder(
  env: Env,
  order: OrderRow,
  tradeNo?: string | null
): Promise<{ ok: true; premium_until: string | null } | { ok: false; error: string }> {
  if (order.status === 'paid') {
    const u = await env.DB.prepare(`SELECT premium_until FROM users WHERE id = ?`)
      .bind(order.user_id)
      .first<{ premium_until: string | null }>();
    return { ok: true, premium_until: u?.premium_until ?? null };
  }

  const user = (await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(order.user_id)
    .first()) as UserRow | null;
  if (!user) return { ok: false, error: '用户不存在' };

  const existing =
    user.premium_until && Date.parse(user.premium_until) > Date.now()
      ? user.premium_until
      : null;
  const premium_until = extendPremiumUntil(existing, order.plan);
  const paidAt = new Date().toISOString();
  const tn = tradeNo || order.trade_no || null;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET plan = 'premium', premium_until = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).bind(premium_until, user.id),
    env.DB.prepare(
      `UPDATE orders SET status = 'paid', paid_at = ?, trade_no = COALESCE(?, trade_no) WHERE id = ?`
    ).bind(paidAt, tn, order.id),
  ]);
  return { ok: true, premium_until };
}

/** 向支付平台查询订单状态 status=1 已支付 */
export async function queryPlatformOrder(
  env: Env,
  outTradeNo: string
): Promise<{ paid: boolean; trade_no?: string; raw?: unknown; error?: string }> {
  const pid = env.MERCHANT_PID;
  const merchantKey = env.MERCHANT_KEY;
  if (!pid || !merchantKey) return { paid: false, error: '支付未配置' };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params: Record<string, string> = {
    pid: String(pid),
    out_trade_no: outTradeNo,
    timestamp,
    sign_type: 'RSA',
  };
  try {
    params.sign = await rsaSign(params, merchantKey);
    const resp = await fetch(`${PAY_HOST}/api/pay/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const text = await resp.text();
    let data: {
      code?: number;
      msg?: string;
      status?: number | string;
      trade_no?: string;
      out_trade_no?: string;
    };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      return { paid: false, error: '查询返回非 JSON: ' + text.slice(0, 120) };
    }
    if (Number(data.code) !== 0) {
      return { paid: false, error: data.msg || '查询失败', raw: data };
    }
    // 文档：status 1 为已支付
    const paid = Number(data.status) === 1;
    return { paid, trade_no: data.trade_no, raw: data };
  } catch (e) {
    return { paid: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 回站补单：查平台后履约 */
export async function syncOrderPayment(
  env: Env,
  outTradeNo: string,
  userId?: number
): Promise<{ ok: boolean; message: string; premium_until?: string | null }> {
  const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(outTradeNo)
    .first<OrderRow>();
  if (!order) return { ok: false, message: '订单不存在' };
  if (userId != null && order.user_id !== userId) {
    return { ok: false, message: '无权操作该订单' };
  }
  if (order.status === 'paid') {
    const u = await env.DB.prepare(`SELECT premium_until FROM users WHERE id = ?`)
      .bind(order.user_id)
      .first<{ premium_until: string | null }>();
    return { ok: true, message: '订单已支付', premium_until: u?.premium_until ?? null };
  }

  const q = await queryPlatformOrder(env, outTradeNo);
  if (!q.paid) {
    return {
      ok: false,
      message: q.error || '平台显示未支付，若已扣款请稍后刷新或联系客服',
    };
  }
  const r = await fulfillPaidOrder(env, order, q.trade_no);
  if (!r.ok) return { ok: false, message: r.error };
  return { ok: true, message: '支付已确认，会员已开通', premium_until: r.premium_until };
}

/**
 * Handle platform notify (官方：GET 异步通知 + return 跳转也可能带参).
 * 返回纯文本 success / fail。
 */
export async function handlePayNotify(
  env: Env,
  req: Request,
  url: URL
): Promise<Response> {
  const params = await parsePayParams(req, url);
  const outTradeNo = params.out_trade_no;
  if (!outTradeNo) {
    return new Response('fail', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  // 有签名则验签；验签失败仍尝试主动 query 补单（防止密钥格式问题导致永不发货）
  const platformKey = env.PLATFORM_KEY;
  let signedOk = false;
  if (platformKey && params.sign) {
    const verifyParams: Record<string, string> = { ...params };
    delete verifyParams.sign;
    signedOk = await rsaVerify(verifyParams, params.sign, platformKey);
  }

  const tradeOk =
    !params.trade_status || params.trade_status === 'TRADE_SUCCESS' || params.trade_status === '1';

  if (signedOk && tradeOk) {
    const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
      .bind(outTradeNo)
      .first<OrderRow>();
    if (order) {
      await fulfillPaidOrder(env, order, params.trade_no || null);
    }
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  // 验签失败或无签名：用查询接口核对
  const synced = await syncOrderPayment(env, outTradeNo);
  if (synced.ok) {
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  // 非成功交易
  if (params.trade_status && params.trade_status !== 'TRADE_SUCCESS') {
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('fail', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
