/**
 * layout.ts — 在画布上为 N 个图标随机生成不重叠的位置。
 *
 * 算法：拒绝采样。
 * 随机生成 (x%, y%) 坐标，计算与已放置图标中心点的欧氏距离，
 * 若低于阈值则重试。设置最大重试次数防止死循环。
 */
/**
 * 为 numItems 个图标在画布上生成不重叠的随机位置。
 *
 * @param numItems  图标数量
 * @param canvas    画布尺寸（仅用于计算最小距离阈值）
 * @param marginPct 边距百分比，图标中心距边界至少此值
 * @returns 位置数组，长度 === numItems
 */
export function randomLayout(numItems, canvas, marginPct = 12) {
    const minDist = Math.min(canvas.width, canvas.height) * 0.16; // 对角线比例
    const placed = [];
    const maxAttempts = 500;
    for (let i = 0; i < numItems; i++) {
        let attempts = 0;
        let pos = null;
        while (attempts < maxAttempts) {
            const x = marginPct + Math.random() * (100 - 2 * marginPct);
            const y = marginPct + Math.random() * (100 - 2 * marginPct);
            // 检查与已放置位置的距离
            let tooClose = false;
            for (const p of placed) {
                const dx = x - p.x;
                const dy = y - p.y;
                // 将百分比坐标转换为画布像素距离
                const distCanvas = Math.sqrt((dx * canvas.width / 100) ** 2 + (dy * canvas.height / 100) ** 2);
                if (distCanvas < minDist) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) {
                pos = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
                break;
            }
            attempts++;
        }
        // fallback：若始终放不下，用网格近似
        if (!pos) {
            const cols = Math.ceil(Math.sqrt(numItems));
            const row = Math.floor(i / cols);
            const col = i % cols;
            pos = {
                x: Math.round((marginPct + col * (100 - 2 * marginPct) / (cols - 1 || 1)) * 100) / 100,
                y: Math.round((marginPct + row * (100 - 2 * marginPct) / (Math.ceil(numItems / cols) - 1 || 1)) * 100) / 100,
            };
        }
        placed.push(pos);
    }
    return placed;
}
//# sourceMappingURL=layout.js.map