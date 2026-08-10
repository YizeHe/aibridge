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

export function notifyUrl(env: Env, req: Request): string {
  if (env.NOTIFY_URL) return env.NOTIFY_URL;
  return `${siteBase(env, req)}/api/pay/notify`;
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

export async function createPayOrder(
  env: Env,
  req: Request,
  userId: number,
  plan: PayPlanId,
  payType: 'alipay' | 'wxpay'
): Promise<
  | { ok: true; payUrl: string; order_no: string; trade_no?: string }
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
  // 支付完成回站：账号页（会员状态可见）；发货仍以 notify 回调为准
  const return_url = `${base}/#/account`;
  const name = `AIBridge ${plan === 'monthly' ? '月付' : '年付'}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  await env.DB.prepare(
    `INSERT INTO orders (id, user_id, plan, amount, pay_type, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  )
    .bind(out_trade_no, userId, plan, amount, payType)
    .run();

  // method 必须用 jump（跳转支付）。web 在部分通道会返回：
  // 「本次支付需要安全验证，请使用跳转支付接口发起支付」
  const payParams: Record<string, string> = {
    pid: String(pid),
    method: 'jump',
    type: payType,
    out_trade_no,
    notify_url,
    return_url,
    name,
    money: amount.toFixed(2),
    clientip: clientIp(req),
    timestamp,
    sign_type: 'RSA',
  };

  try {
    payParams.sign = await rsaSign(payParams, merchantKey);
    const resp = await fetch('https://pay.ykmcn.com/api/pay/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payParams).toString(),
    });
    const rawText = await resp.text();
    let payData: {
      code?: number;
      pay_info?: string;
      payurl?: string;
      pay_url?: string;
      trade_no?: string;
      msg?: string;
      message?: string;
    } = {};
    try {
      payData = JSON.parse(rawText) as typeof payData;
    } catch {
      await env.DB.prepare(`UPDATE orders SET status = 'failed' WHERE id = ?`)
        .bind(out_trade_no)
        .run();
      return {
        ok: false,
        error: '支付平台返回非 JSON：' + rawText.slice(0, 200),
        status: 502,
      };
    }
    const payUrl = String(payData.pay_info || payData.payurl || payData.pay_url || '').trim();
    if (Number(payData.code) === 0 && payUrl) {
      if (payData.trade_no) {
        await env.DB.prepare(`UPDATE orders SET trade_no = ? WHERE id = ?`)
          .bind(String(payData.trade_no), out_trade_no)
          .run();
      }
      return {
        ok: true,
        payUrl,
        order_no: out_trade_no,
        trade_no: payData.trade_no,
      };
    }
    await env.DB.prepare(`UPDATE orders SET status = 'failed' WHERE id = ?`)
      .bind(out_trade_no)
      .run();
    const platformMsg = payData.msg || payData.message || '创建支付失败';
    // 友好化常见错误
    let error = platformMsg;
    if (/安全验证|跳转支付/.test(platformMsg)) {
      error =
        '支付通道要求跳转收银台。请稍后重试；若持续失败请联系客服（工单）。技术说明：下单 method 须为 jump。';
    }
    return {
      ok: false,
      error,
      status: 502,
    };
  } catch (e: unknown) {
    await env.DB.prepare(`UPDATE orders SET status = 'failed' WHERE id = ?`)
      .bind(out_trade_no)
      .run();
    return {
      ok: false,
      error: '支付接口异常: ' + (e instanceof Error ? e.message : String(e)),
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

/**
 * Handle platform notify. Returns plain "success" or "fail".
 */
export async function handlePayNotify(
  env: Env,
  req: Request,
  url: URL
): Promise<Response> {
  const platformKey = env.PLATFORM_KEY;
  if (!platformKey) {
    return new Response('fail', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  const params = await parsePayParams(req, url);
  const sign = params.sign;
  if (!sign) {
    return new Response('fail', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  const verifyParams: Record<string, string> = { ...params };
  delete verifyParams.sign;

  const valid = await rsaVerify(verifyParams, sign, platformKey);
  if (!valid) {
    return new Response('fail', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  if (params.trade_status !== 'TRADE_SUCCESS') {
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  const outTradeNo = params.out_trade_no;
  if (!outTradeNo) {
    return new Response('fail', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(outTradeNo)
    .first<{
      id: string;
      user_id: number;
      plan: string;
      status: string;
    }>();

  if (!order) {
    return new Response('fail', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  if (order.status === 'paid') {
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  const user = (await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(order.user_id)
    .first()) as UserRow | null;

  if (user) {
    // extend premium_until from max(now, existing premium_until)
    const existing =
      user.premium_until && Date.parse(user.premium_until) > Date.now()
        ? user.premium_until
        : null;
    const premium_until = extendPremiumUntil(existing, order.plan);
    const tradeNo = params.trade_no || params.transaction_id || null;
    const paidAt = new Date().toISOString();

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET plan = 'premium', premium_until = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      ).bind(premium_until, user.id),
      env.DB.prepare(
        `UPDATE orders SET status = 'paid', paid_at = ?, trade_no = COALESCE(?, trade_no) WHERE id = ?`
      ).bind(paidAt, tradeNo, order.id),
    ]);
  } else {
    await env.DB.prepare(
      `UPDATE orders SET status = 'paid', paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       trade_no = COALESCE(?, trade_no) WHERE id = ?`
    )
      .bind(params.trade_no || null, order.id)
      .run();
  }

  return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
