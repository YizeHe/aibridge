/**
 * layout.ts — 在画布上为 N 个图标随机生成不重叠的位置。
 *
 * 算法：拒绝采样。
 * 随机生成 (x%, y%) 坐标，计算与已放置图标中心点的欧氏距离，
 * 若低于阈值则重试。设置最大重试次数防止死循环。
 */
import type { CanvasSize } from './types.js';
export interface Position {
    x: number;
    y: number;
}
/**
 * 为 numItems 个图标在画布上生成不重叠的随机位置。
 *
 * @param numItems  图标数量
 * @param canvas    画布尺寸（仅用于计算最小距离阈值）
 * @param marginPct 边距百分比，图标中心距边界至少此值
 * @returns 位置数组，长度 === numItems
 */
export declare function randomLayout(numItems: number, canvas: CanvasSize, marginPct?: number): Position[];
//# sourceMappingURL=layout.d.ts.map