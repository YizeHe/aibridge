/**
 * browser.ts — 浏览器侧挂载 UI 的工厂函数
 *
 * 在页面上创建一个图标点击 CAPTCHA widget。
 */
import { createChallenge, verifyChallenge } from './index.js';
export class CaptchaWidget {
    container;
    options;
    challenge = null;
    selectedSlots = [];
    rootEl = null;
    promptEl = null;
    canvasEl = null;
    feedbackEl = null;
    submitBtn = null;
    resetBtn = null;
    refreshBtn = null;
    locked = false;
    constructor(options) {
        this.options = options;
        if (typeof options.container === 'string') {
            const el = document.querySelector(options.container);
            if (!el)
                throw new Error(`CaptchaWidget: container "${options.container}" not found`);
            this.container = el;
        }
        else {
            this.container = options.container;
        }
    }
    /** 启动 widget：加载 challenge 并渲染 */
    async init() {
        if (this.options.challenge) {
            this.challenge = this.options.challenge;
        }
        else {
            this.challenge = await createChallenge({
                secret: this.options.secret,
                canvas: {
                    width: this.options.canvasWidth,
                    height: this.options.canvasHeight,
                },
            });
        }
        this.selectedSlots = [];
        this.locked = false;
        this.render();
    }
    render() {
        if (!this.challenge)
            return;
        this.container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'icon-captcha-widget';
        this.rootEl = root;
        // 提示
        const prompt = document.createElement('div');
        prompt.className = 'icon-captcha-prompt';
        prompt.textContent = this.challenge.prompt;
        this.promptEl = prompt;
        root.appendChild(prompt);
        // 画布
        const canvas = document.createElement('div');
        canvas.className = 'icon-captcha-canvas';
        canvas.style.position = 'relative';
        canvas.style.aspectRatio = `${this.challenge.canvas.width} / ${this.challenge.canvas.height}`;
        this.canvasEl = canvas;
        for (const item of this.challenge.items) {
            const iconEl = document.createElement('div');
            iconEl.className = 'icon-captcha-item';
            iconEl.dataset.slotId = item.slotId;
            iconEl.style.left = `${item.x}%`;
            iconEl.style.top = `${item.y}%`;
            iconEl.innerHTML = `<span class="icon-captcha-glyph">${item.svg}</span>`;
            iconEl.addEventListener('click', () => this.onIconClick(item.slotId, iconEl));
            canvas.appendChild(iconEl);
        }
        root.appendChild(canvas);
        // 反馈区
        const feedback = document.createElement('div');
        feedback.className = 'icon-captcha-feedback';
        this.feedbackEl = feedback;
        root.appendChild(feedback);
        // 按钮栏
        const actions = document.createElement('div');
        actions.className = 'icon-captcha-actions';
        this.refreshBtn = document.createElement('button');
        this.refreshBtn.type = 'button';
        this.refreshBtn.className = 'icon-captcha-btn icon-captcha-btn-refresh';
        this.refreshBtn.textContent = '换一组';
        this.refreshBtn.addEventListener('click', () => this.refresh());
        actions.appendChild(this.refreshBtn);
        this.resetBtn = document.createElement('button');
        this.resetBtn.type = 'button';
        this.resetBtn.className = 'icon-captcha-btn icon-captcha-btn-reset';
        this.resetBtn.textContent = '重置';
        this.resetBtn.addEventListener('click', () => this.reset());
        actions.appendChild(this.resetBtn);
        this.submitBtn = document.createElement('button');
        this.submitBtn.type = 'button';
        this.submitBtn.className = 'icon-captcha-btn icon-captcha-btn-submit';
        this.submitBtn.textContent = '提交';
        this.submitBtn.disabled = true;
        this.submitBtn.addEventListener('click', () => this.submit());
        actions.appendChild(this.submitBtn);
        root.appendChild(actions);
        this.container.appendChild(root);
    }
    onIconClick(slotId, el) {
        if (this.locked)
            return;
        if (!this.challenge)
            return;
        const idx = this.selectedSlots.indexOf(slotId);
        if (idx !== -1) {
            // 已选中，取消选中及之后的所有
            this.selectedSlots = this.selectedSlots.slice(0, idx);
            this.updateBadges();
            this.updateSubmit();
            return;
        }
        if (this.selectedSlots.length >= 3)
            return;
        // 选中
        this.selectedSlots.push(slotId);
        const badge = document.createElement('span');
        badge.className = 'icon-captcha-badge';
        badge.textContent = String(this.selectedSlots.length);
        el.appendChild(badge);
        this.updateSubmit();
    }
    updateBadges() {
        if (!this.canvasEl)
            return;
        // 清除所有 badge
        const badges = this.canvasEl.querySelectorAll('.icon-captcha-badge');
        badges.forEach((b) => b.remove());
        // 重新添加选中序号的 badge
        for (let i = 0; i < this.selectedSlots.length; i++) {
            const slotId = this.selectedSlots[i];
            const el = this.canvasEl.querySelector(`[data-slot-id="${slotId}"]`);
            if (el) {
                const badge = document.createElement('span');
                badge.className = 'icon-captcha-badge';
                badge.textContent = String(i + 1);
                el.appendChild(badge);
            }
        }
    }
    updateSubmit() {
        if (this.submitBtn) {
            this.submitBtn.disabled = this.selectedSlots.length !== 3;
        }
        // 清除 feedback
        if (this.feedbackEl) {
            this.feedbackEl.textContent = '';
            this.feedbackEl.className = 'icon-captcha-feedback';
        }
    }
    async reset() {
        // reset always works — just clear selections
        this.selectedSlots = [];
        this.updateBadges();
        this.updateSubmit();
        this.options.onReset?.();
    }
    async refresh() {
        // refresh always works — force unlock and create new challenge
        this.locked = false;
        this.options.challenge = undefined;
        await this.init();
    }
    async submit() {
        if (this.locked || !this.challenge || this.selectedSlots.length !== 3)
            return;
        this.locked = true;
        if (this.submitBtn)
            this.submitBtn.disabled = true;
        const result = await verifyChallenge(this.challenge.token, this.selectedSlots, this.options.secret);
        if (this.feedbackEl) {
            if (result.ok) {
                this.feedbackEl.textContent = '✓ 验证通过';
                this.feedbackEl.className = 'icon-captcha-feedback icon-captcha-success';
                this.options.onSuccess?.(this.challenge.token);
            }
            else {
                const messages = {
                    bad_token: '✗ 令牌无效',
                    expired: '✗ 验证已过期，请刷新',
                    wrong: '✗ 点击顺序错误，请重试',
                    incomplete: '✗ 请选满 3 个图标',
                };
                this.feedbackEl.textContent = messages[result.reason] || '✗ 验证失败';
                this.feedbackEl.className = 'icon-captcha-feedback icon-captcha-error';
                this.options.onFailure?.(result.reason);
            }
        }
        // 失败时解锁
        if (!result.ok) {
            this.locked = false;
            if (this.submitBtn)
                this.submitBtn.disabled = false;
        }
    }
    /** 销毁 widget */
    destroy() {
        this.container.innerHTML = '';
    }
}
/** 快捷挂载 */
export function mountCaptcha(options) {
    const widget = new CaptchaWidget(options);
    widget.init();
    return widget;
}
// 卡片式嵌入（推荐给第三方站点）
export { CaptchaCard, mountCaptchaCard, autoMountCaptchaCards, } from './card.js';
//# sourceMappingURL=browser.js.map