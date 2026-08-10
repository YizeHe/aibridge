/**
 * challenge.ts — 创建一次验证挑战
 *
 * 1. 随机选出 3 个目标图标 + 2 个干扰图标（共 5 个不重复 iconId）
 * 2. 为每个图标分配随机 slotId、随机位置
 * 3. 将 slotId→iconId 映射 + 答案顺序写入 token payload
 * 4. 签名后返回公开 challenge
 */
import { ICONS } from './icons.js';
import { randomLayout } from './layout.js';
import { signPayload, resolveSecret } from './crypto.js';
function randomId() {
    return Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36))).join('');
}
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function pickRandom(arr, n) {
    return shuffle(arr).slice(0, n);
}
export async function createChallenge(options = {}) {
    const secret = resolveSecret(options.secret);
    const canvas = {
        width: options.canvas?.width ?? 360,
        height: options.canvas?.height ?? 200,
    };
    const expiryMs = options.expiryMs ?? 5 * 60 * 1000; // 5 分钟
    // ── 选择图标 ──
    let pool;
    if (options.iconIds && options.iconIds.length >= 5) {
        const idSet = new Set(options.iconIds);
        pool = ICONS.filter((ic) => idSet.has(ic.id));
        if (pool.length < 5) {
            // 补充随机图标
            const remain = ICONS.filter((ic) => !idSet.has(ic.id));
            pool = [...pool, ...pickRandom(remain, 5 - pool.length)];
        }
        pool = pickRandom(pool, 5);
    }
    else {
        pool = pickRandom(ICONS, 5);
    }
    // 前 3 个为目标（有顺序），后 2 个为干扰
    const targets = pool.slice(0, 3);
    const distractors = pool.slice(3, 5);
    // ── 生成 slot → 位置 → 映射 ──
    const slots = shuffle([...targets, ...distractors]);
    const positions = randomLayout(slots.length, canvas);
    const items = slots.map((icon, i) => {
        const slotId = randomId();
        return { slotId, icon, pos: positions[i] };
    });
    // slotId -> iconId 映射
    const map = {};
    for (const item of items) {
        map[item.slotId] = item.icon.id;
    }
    // 答案：目标图标的 slotId 顺序
    const answer = targets.map((t) => {
        const found = items.find((it) => it.icon.id === t.id);
        // 理论上一定找到
        return found.slotId;
    });
    // ── 构建 payload ──
    const now = Date.now();
    const payload = {
        v: 1,
        nonce: randomId() + randomId(),
        exp: now + expiryMs,
        map,
        answer,
    };
    const token = await signPayload(payload, secret);
    // ── 公开 challenge（不含 label） ──
    const promptLabels = targets.map((t) => t.label);
    const prompt = `请依次点击：${promptLabels.join('、')}`;
    return {
        token,
        prompt,
        promptLabels,
        canvas,
        items: items.map((item) => ({
            slotId: item.slotId,
            svg: item.icon.svg,
            x: item.pos.x,
            y: item.pos.y,
        })),
        expiresAt: now + expiryMs,
    };
}
//# sourceMappingURL=challenge.js.map