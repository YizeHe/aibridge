/**
 * verify.ts — 校验用户提交的点击顺序
 */
import { verifyToken, resolveSecret } from './crypto.js';
export async function verifyChallenge(token, clickedSlotIds, secret) {
    const key = resolveSecret(secret);
    // 1. 解签
    const payload = await verifyToken(token, key);
    if (!payload) {
        return { ok: false, reason: 'bad_token' };
    }
    // 2. 过期检查
    if (payload.exp < Date.now()) {
        return { ok: false, reason: 'expired' };
    }
    // 3. 点击数检查
    if (clickedSlotIds.length !== payload.answer.length) {
        return { ok: false, reason: 'incomplete' };
    }
    // 4. 顺序比对
    for (let i = 0; i < payload.answer.length; i++) {
        if (clickedSlotIds[i] !== payload.answer[i]) {
            return { ok: false, reason: 'wrong' };
        }
    }
    return { ok: true };
}
//# sourceMappingURL=verify.js.map