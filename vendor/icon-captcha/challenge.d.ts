/**
 * challenge.ts — 创建一次验证挑战
 *
 * 1. 随机选出 3 个目标图标 + 2 个干扰图标（共 5 个不重复 iconId）
 * 2. 为每个图标分配随机 slotId、随机位置
 * 3. 将 slotId→iconId 映射 + 答案顺序写入 token payload
 * 4. 签名后返回公开 challenge
 */
import type { PublicChallenge, CreateChallengeOptions } from './types.js';
export declare function createChallenge(options?: CreateChallengeOptions): Promise<PublicChallenge>;
//# sourceMappingURL=challenge.d.ts.map