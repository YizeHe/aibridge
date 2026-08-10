/**
 * browser.ts — 浏览器侧挂载 UI 的工厂函数
 *
 * 在页面上创建一个图标点击 CAPTCHA widget。
 */
import { type PublicChallenge } from './index.js';
export interface CaptchaWidgetOptions {
    /** 挂载到的容器元素或选择器 */
    container: HTMLElement | string;
    /** 服务器端验证 secret（demo 用；生产应从服务端获取 challenge） */
    secret?: string;
    /** 若提供则直接用此 challenge，不再本地生成 */
    challenge?: PublicChallenge;
    /** 自定义画布逻辑尺寸 */
    canvasWidth?: number;
    canvasHeight?: number;
    /** 验证成功回调 */
    onSuccess?: (token: string) => void;
    /** 验证失败回调 */
    onFailure?: (reason: string) => void;
    /** 重置回调 */
    onReset?: () => void;
}
export declare class CaptchaWidget {
    private container;
    private options;
    private challenge;
    private selectedSlots;
    private rootEl;
    private promptEl;
    private canvasEl;
    private feedbackEl;
    private submitBtn;
    private resetBtn;
    private refreshBtn;
    private locked;
    constructor(options: CaptchaWidgetOptions);
    /** 启动 widget：加载 challenge 并渲染 */
    init(): Promise<void>;
    private render;
    private onIconClick;
    private updateBadges;
    private updateSubmit;
    reset(): Promise<void>;
    refresh(): Promise<void>;
    submit(): Promise<void>;
    /** 销毁 widget */
    destroy(): void;
}
/** 快捷挂载 */
export declare function mountCaptcha(options: CaptchaWidgetOptions): CaptchaWidget;
export { CaptchaCard, mountCaptchaCard, autoMountCaptchaCards, } from './card.js';
export type { CaptchaCardOptions, CaptchaCardStatus } from './card.js';
//# sourceMappingURL=browser.d.ts.map