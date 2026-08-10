/**
 * 短信平台（sms2）
 * - POST {SMS_API_BASE}/send.php
 * - 配置见项目 sms 密钥；模板默认 gsorg_login / SMS_511520290，变量 code
 */
import type { Env } from './types';

function smsApiBase(env: Env): string {
  let base = (env.SMS_API_BASE || 'https://iajlz.terribly.cn/api').trim().replace(/\/+$/, '');
  if (base && !/\/api$/i.test(base)) base = `${base}/api`;
  return base || 'https://iajlz.terribly.cn/api';
}

export function normalizePhone(phone: string): string | null {
  const p = String(phone || '').trim().replace(/\s|-/g, '');
  // 与 yunstorage isValidPhone 一致：1[3-9] 开头
  if (!/^1[3-9]\d{9}$/.test(p)) return null;
  return p;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 7) return '';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

export async function sendSmsCode(
  env: Env,
  phone: string,
  code: string
): Promise<{ ok: boolean; msg: string }> {
  if (!env.SMS_API_KEY || !env.SMS_API_SECRET) {
    return { ok: false, msg: '短信服务未配置' };
  }
  const base = smsApiBase(env);
  // sms2 示例：template_code + template_params.code
  // yunstorage 使用平台模板号 SMS_511520290（名称 gsorg_login）
  const payload: Record<string, unknown> = {
    api_key: env.SMS_API_KEY,
    api_secret: env.SMS_API_SECRET,
    phone,
    template_code: env.SMS_TEMPLATE_CODE || 'SMS_511520290',
    template_params: { code },
  };
  if (env.SMS_SIGN_NAME) payload.sign_name = env.SMS_SIGN_NAME;

  try {
    const url = `${base}/send.php`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data: {
      code?: number;
      msg?: string;
      message?: string;
      data?: { success_count?: number; fail_count?: number; biz_id?: string };
    };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      return {
        ok: false,
        msg: `短信接口返回非 JSON (HTTP ${res.status}): ${text.slice(0, 120)}`,
      };
    }
    // 平台：code===0 成功
    if (Number(data.code) === 0 && (data.data?.success_count ?? 1) > 0) {
      return { ok: true, msg: data.msg || data.message || '验证码已发送' };
    }
    return {
      ok: false,
      msg: data.msg || data.message || `短信发送失败 (code=${data.code})`,
    };
  } catch (e) {
    return { ok: false, msg: '短信接口异常: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

export function generateSmsCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
