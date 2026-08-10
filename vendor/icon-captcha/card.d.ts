/**
 * card.ts — 卡片式 CAPTCHA，方便第三方网站嵌入
 *
 * 两种数据模式：
 * 1) 本地：传入 secret（仅 demo / 同源自用，生产勿把密钥暴露到浏览器）
 * 2) 远程：传入 apiBase / fetchChallenge + verifyRemote（推荐嵌入）
 *
 * 嵌入方式：
 * - JS 挂载：mountCaptchaCard({ container, apiBase, ... })
 * - 表单：inputName 自动写入隐藏域
 * - iframe：public/embed.html + postMessage
 */
import { type PublicChallenge, type VerifyResult } from './index.js';
export interface CaptchaCardOptions {
    /** 挂载容器或选择器 */
    container: HTMLElement | string;
    /**
     * 本地 HMAC 密钥（仅演示；生产请用远程 API，勿把 secret 放前端）
     */
    secret?: string;
    /** 固定 challenge（一般不用于嵌入） */
    challenge?: PublicChallenge;
    /**
     * 远程 API 根路径，约定：
     *   GET  {apiBase}/challenge  → PublicChallenge JSON
     *   POST {apiBase}/verify     body: { token, slots } → VerifyResult JSON
     */
    apiBase?: string;
    /** 自定义拉取 challenge（优先于 apiBase / secret） */
    fetchChallenge?: () => Promise<PublicChallenge>;
    /** 自定义远端校验（优先于 apiBase / secret） */
    verifyRemote?: (token: string, slots: string[]) => Promise<VerifyResult>;
    /** 画布逻辑尺寸 */
    canvasWidth?: number;
    canvasHeight?: number;
    /** 卡片标题 */
    title?: string;
    /** 折叠条文案（compact 模式） */
    gateLabel?: string;
    /**
     * compact：先显示「点击进行人机验证」，点开再加载题目
     * full：直接展示完整卡片
     */
    mode?: 'compact' | 'full';
    /** 表单隐藏域 name，验证通过后写入 token */
    inputName?: string;
    /** 自动注入内置样式（默认 true；若页面已 link captcha.css 可设 false） */
    injectStyles?: boolean;
    /** 是否显示底部署名 */
    showBrand?: boolean;
    /** 主题色（按钮/徽章） */
    accent?: string;
    /** 语言：目前仅 zh */
    locale?: 'zh';
    /** 成功 */
    onSuccess?: (token: string) => void;
    /** 失败 */
    onFailure?: (reason: string) => void;
    /** 重置选择 */
    onReset?: () => void;
    /** 刷新题目 */
    onRefresh?: () => void;
    /** 状态变化：idle | loading | ready | verified | failed */
    onStatus?: (status: CaptchaCardStatus) => void;
    /**
     * iframe 嵌入时向 parent 发 postMessage（默认检测 window !== parent）
     */
    postMessageToParent?: boolean;
    /** postMessage 的 targetOrigin，默认 '*' */
    postMessageOrigin?: string;
}
export type CaptchaCardStatus = 'idle' | 'loading' | 'ready' | 'verified' | 'failed';
export declare class CaptchaCard {
    private container;
    private options;
    private challenge;
    private selectedSlots;
    private locked;
    private status;
    private token;
    private root;
    private gateEl;
    private checkEl;
    private gateTextEl;
    private bodyEl;
    private promptEl;
    private canvasEl;
    private feedbackEl;
    private submitBtn;
    private statusLabelEl;
    private statusDotEl;
    private hiddenInput;
    constructor(options: CaptchaCardOptions);
    /** 初始化外壳；compact 模式下等用户点击再拉题 */
    init(): Promise<this>;
    getToken(): string | null;
    isVerified(): boolean;
    getStatus(): CaptchaCardStatus;
    /** 清空选择（未通过时）；已通过则保持 token */
    resetSelection(): Promise<void>;
    /** 换一组 / 重新验证 */
    refresh(): Promise<void>;
    destroy(): void;
    private buildShell;
    private bindBodyRefsEmpty;
    private openFromGate;
    private loadChallenge;
    private obtainChallenge;
    private doVerify;
    private renderErrorBody;
    private makeHeader;
    private renderBody;
    private onIconClick;
    private updateBadges;
    private updateSubmit;
    private setFeedback;
    private submit;
    private setStatus;
    private setGateLoading;
    private setGateOk;
    private emitParent;
}
/** 快捷挂载（自动 init） */
export declare function mountCaptchaCard(options: CaptchaCardOptions): CaptchaCard;
/**
 * 扫描页面 data-icon-captcha 节点自动挂载。
 *
 * ```html
 * <div data-icon-captcha
 *      data-mode="compact"
 *      data-api-base="/api/captcha"
 *      data-input-name="captcha_token"></div>
 * ```
 */
export declare function autoMountCaptchaCards(defaults?: Partial<CaptchaCardOptions>): CaptchaCard[];
//# sourceMappingURL=card.d.ts.map