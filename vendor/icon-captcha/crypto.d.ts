/**
 * crypto.ts — HMAC-SHA256 sign / verify
 *
 * 兼容 Node.js (crypto) 与 浏览器 (Web Crypto / subtle)。
 * base64url 编解码内联实现，无额外依赖。
 */
import type { TokenPayload } from './types.js';
export declare function signPayload(payload: TokenPayload, secret: string): Promise<string>;
export declare function verifyToken(token: string, secret: string): Promise<TokenPayload | null>;
/** 同步方式推导默认密钥 */
export declare function resolveSecret(explicit?: string): string;
//# sourceMappingURL=crypto.d.ts.map