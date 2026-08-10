/** 核心类型定义 */
export interface IconDef {
    id: string;
    label: string;
    svg: string;
}
export interface CanvasSize {
    width: number;
    height: number;
}
export interface ChallengeItem {
    slotId: string;
    svg: string;
    x: number;
    y: number;
}
export interface PublicChallenge {
    token: string;
    prompt: string;
    promptLabels: string[];
    canvas: CanvasSize;
    items: ChallengeItem[];
    expiresAt: number;
}
/** 签名 payload */
export interface TokenPayload {
    v: 1;
    nonce: string;
    exp: number;
    map: Record<string, string>;
    answer: string[];
}
export type VerifyResult = {
    ok: true;
} | {
    ok: false;
    reason: 'bad_token' | 'expired' | 'wrong' | 'incomplete';
};
export interface CreateChallengeOptions {
    secret?: string;
    canvas?: Partial<CanvasSize>;
    expiryMs?: number;
    iconIds?: string[];
}
//# sourceMappingURL=types.d.ts.map