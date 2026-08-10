/**
 * crypto.ts — HMAC-SHA256 sign / verify
 *
 * 兼容 Node.js (crypto) 与 浏览器 (Web Crypto / subtle)。
 * base64url 编解码内联实现，无额外依赖。
 */
// ── base64url 工具 ──
function base64url(buf) {
    // base64url 编码（不产生尾部 = 填充符；循环已正确处理不足3字节的组）
    let s = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const len = buf.length;
    for (let i = 0; i < len; i += 3) {
        const b0 = buf[i];
        const b1 = i + 1 < len ? buf[i + 1] : 0;
        const b2 = i + 2 < len ? buf[i + 2] : 0;
        s += chars[b0 >> 2];
        s += chars[((b0 & 3) << 4) | (b1 >> 4)];
        if (i + 1 < len)
            s += chars[((b1 & 15) << 2) | (b2 >> 6)];
        if (i + 2 < len)
            s += chars[b2 & 63];
    }
    return s;
}
function base64urlDecode(s) {
    // 补齐长度 + 还原为标准 base64
    let base64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (base64.length % 4)) % 4;
    base64 += '='.repeat(pad);
    // 用纯 JS 解码（避免 atob 限制）
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256).fill(255);
    for (let i = 0; i < chars.length; i++)
        lookup[chars.charCodeAt(i)] = i;
    let outLen = (base64.length * 3) / 4 - pad;
    const out = new Uint8Array(outLen);
    let pos = 0;
    for (let i = 0; i < base64.length; i += 4) {
        const a = lookup[base64.charCodeAt(i)];
        const b = lookup[base64.charCodeAt(i + 1)];
        const c = lookup[base64.charCodeAt(i + 2)];
        const d = lookup[base64.charCodeAt(i + 3)];
        out[pos++] = (a << 2) | (b >> 4);
        if (pos < outLen)
            out[pos++] = ((b & 15) << 4) | (c >> 2);
        if (pos < outLen)
            out[pos++] = ((c & 3) << 6) | d;
    }
    return out;
}
// ── HMAC key 导入 ──
async function importKey(secret) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    // Node 有 crypto.subtle; 浏览器有 window.crypto.subtle
    const subtle = globalThis.crypto?.subtle;
    return subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
// ── 公开 API ──
export async function signPayload(payload, secret) {
    const encoder = new TextEncoder();
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
    const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;
    const key = await importKey(secret);
    const sigBuf = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
    const sigB64 = base64url(new Uint8Array(sigBuf));
    return `${signingInput}.${sigB64}`;
}
export async function verifyToken(token, secret) {
    const parts = token.split('.');
    if (parts.length !== 3)
        return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const key = await importKey(secret);
    const sigBytes = base64urlDecode(sigB64);
    const encoder = new TextEncoder();
    const ok = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(signingInput));
    if (!ok)
        return null;
    // 解析 payload
    try {
        const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64));
        return JSON.parse(payloadJson);
    }
    catch {
        return null;
    }
}
/** 同步方式推导默认密钥 */
export function resolveSecret(explicit) {
    if (explicit && explicit.length > 0)
        return explicit;
    if (typeof process !== 'undefined' && process.env?.CAPTCHA_SECRET) {
        return process.env.CAPTCHA_SECRET;
    }
    // 开发 fallback
    return 'icon-captcha-dev-secret-do-not-use-in-production';
}
//# sourceMappingURL=crypto.js.map