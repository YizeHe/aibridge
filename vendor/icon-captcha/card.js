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
import { createChallenge, verifyChallenge, } from './index.js';
const STYLE_ID = 'icon-captcha-card-styles';
/** 卡片相关样式（与 captcha.css 可并存；inject 时写入） */
const CARD_CSS = `
.ic-card {
  --ic-accent: #3b82f6;
  --ic-accent-hover: #2563eb;
  --ic-ok: #16a34a;
  --ic-err: #dc2626;
  --ic-border: #e2e8f0;
  --ic-text: #0f172a;
  --ic-muted: #64748b;
  --ic-bg: #ffffff;
  --ic-soft: #f8fafc;
  box-sizing: border-box;
  width: 100%;
  max-width: 380px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Microsoft YaHei', sans-serif;
  color: var(--ic-text);
  user-select: none;
}
.ic-card *, .ic-card *::before, .ic-card *::after { box-sizing: border-box; }

.ic-card-shell {
  background: var(--ic-bg);
  border: 1px solid var(--ic-border);
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.08);
  overflow: hidden;
}

/* 折叠门闩（compact） */
.ic-card-gate {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  background: linear-gradient(180deg, #fff 0%, var(--ic-soft) 100%);
  transition: background 0.15s ease;
}
.ic-card-gate:hover { background: #f1f5f9; }
.ic-card-gate:focus-visible {
  outline: 2px solid var(--ic-accent);
  outline-offset: -2px;
}
.ic-card-check {
  width: 22px;
  height: 22px;
  border: 2px solid #94a3b8;
  border-radius: 4px;
  background: #fff;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.ic-card-check.is-loading {
  border-color: var(--ic-accent);
  border-top-color: transparent;
  border-radius: 50%;
  animation: ic-spin 0.7s linear infinite;
}
.ic-card-check.is-ok {
  border-color: var(--ic-ok);
  background: var(--ic-ok);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}
.ic-card-gate-text {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--ic-text);
}
.ic-card-gate-badge {
  font-size: 11px;
  color: var(--ic-muted);
  text-align: right;
  line-height: 1.3;
}
.ic-card-gate-badge strong {
  display: block;
  color: var(--ic-accent);
  font-size: 12px;
}

/* 展开主体 */
.ic-card-body { display: none; padding: 16px 16px 12px; }
.ic-card.is-open .ic-card-body { display: block; }
.ic-card.is-open .ic-card-gate { display: none; }
.ic-card.mode-full .ic-card-gate { display: none; }
.ic-card.mode-full .ic-card-body { display: block; }

.ic-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.ic-card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ic-text);
  margin: 0;
}
.ic-card-sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--ic-muted);
}
.ic-card-close {
  border: none;
  background: transparent;
  color: var(--ic-muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 6px;
}
.ic-card-close:hover { background: #f1f5f9; color: var(--ic-text); }
.ic-card.mode-full .ic-card-close { display: none; }

.ic-card-prompt {
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--ic-text);
  margin: 0 0 12px;
  line-height: 1.45;
  padding: 8px 10px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
}

.ic-card-canvas {
  position: relative;
  width: 100%;
  background: #fff;
  border: 1px dashed #cbd5e1;
  border-radius: 10px;
  overflow: hidden;
  min-height: 150px;
  margin-bottom: 10px;
}

.ic-card-item {
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: pointer;
  transition: transform 0.15s ease, filter 0.15s ease;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 10px;
}
.ic-card-item:hover {
  transform: translate(-50%, -50%) scale(1.16);
  filter: drop-shadow(0 2px 6px rgba(59, 130, 246, 0.35));
  z-index: 2;
  background: rgba(59, 130, 246, 0.06);
}
.ic-card-item:active { transform: translate(-50%, -50%) scale(0.95); }
.ic-card-item.is-picked { background: rgba(59, 130, 246, 0.1); }

.ic-card-glyph {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  color: #1e293b;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.ic-card-glyph svg {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ic-card-badge {
  position: absolute;
  top: -4px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--ic-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  pointer-events: none;
  z-index: 3;
}

.ic-card-feedback {
  text-align: center;
  min-height: 22px;
  line-height: 22px;
  font-size: 13px;
  margin-bottom: 8px;
  font-weight: 500;
}
.ic-card-feedback.is-ok { color: var(--ic-ok); }
.ic-card-feedback.is-err { color: var(--ic-err); }

.ic-card-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.ic-card-btn {
  padding: 7px 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #f9fafb;
  color: #374151;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  outline: none;
  font-family: inherit;
}
.ic-card-btn:hover { background: #f3f4f6; border-color: #9ca3af; }
.ic-card-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ic-card-btn-primary {
  background: var(--ic-accent);
  color: #fff;
  border-color: var(--ic-accent);
}
.ic-card-btn-primary:hover:not(:disabled) {
  background: var(--ic-accent-hover);
  border-color: var(--ic-accent-hover);
}

.ic-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 12px;
  font-size: 11px;
  color: var(--ic-muted);
}
.ic-card-footer a {
  color: var(--ic-accent);
  text-decoration: none;
}
.ic-card-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cbd5e1;
  display: inline-block;
  margin-right: 6px;
}
.ic-card-status-dot.is-ok { background: var(--ic-ok); }
.ic-card-status-dot.is-err { background: var(--ic-err); }
.ic-card-status-dot.is-load {
  background: var(--ic-accent);
  animation: ic-pulse 1s ease infinite;
}

@keyframes ic-spin { to { transform: rotate(360deg); } }
@keyframes ic-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (max-width: 480px) {
  .ic-card { max-width: 100%; }
  .ic-card-glyph { width: 1.65rem; height: 1.65rem; }
  .ic-card-item { width: 42px; height: 42px; }
}
`;
function resolveEl(container) {
    if (typeof container === 'string') {
        const el = document.querySelector(container);
        if (!el)
            throw new Error(`CaptchaCard: container "${container}" not found`);
        return el;
    }
    return container;
}
function injectStyles(accent) {
    if (typeof document === 'undefined')
        return;
    let style = document.getElementById(STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CARD_CSS;
        document.head.appendChild(style);
    }
    if (accent) {
        // per-instance accent via CSS variable on root is set separately
    }
}
export class CaptchaCard {
    container;
    options;
    challenge = null;
    selectedSlots = [];
    locked = false;
    status = 'idle';
    token = null;
    root = null;
    gateEl = null;
    checkEl = null;
    gateTextEl = null;
    bodyEl = null;
    promptEl = null;
    canvasEl = null;
    feedbackEl = null;
    submitBtn = null;
    statusLabelEl = null;
    statusDotEl = null;
    hiddenInput = null;
    constructor(options) {
        this.options = {
            mode: 'compact',
            injectStyles: true,
            showBrand: true,
            title: '人机验证',
            gateLabel: '点击进行人机验证',
            postMessageToParent: undefined,
            postMessageOrigin: '*',
            ...options,
        };
        this.container = resolveEl(options.container);
    }
    /** 初始化外壳；compact 模式下等用户点击再拉题 */
    async init() {
        if (this.options.injectStyles !== false)
            injectStyles(this.options.accent);
        this.buildShell();
        if (this.options.mode === 'full') {
            await this.loadChallenge();
        }
        else {
            this.setStatus('idle');
        }
        return this;
    }
    getToken() {
        return this.token;
    }
    isVerified() {
        return this.status === 'verified' && !!this.token;
    }
    getStatus() {
        return this.status;
    }
    /** 清空选择（未通过时）；已通过则保持 token */
    async resetSelection() {
        if (this.status === 'verified')
            return;
        this.selectedSlots = [];
        this.locked = false;
        this.updateBadges();
        this.updateSubmit();
        this.setFeedback('');
        this.options.onReset?.();
    }
    /** 换一组 / 重新验证 */
    async refresh() {
        this.token = null;
        this.locked = false;
        this.selectedSlots = [];
        if (this.hiddenInput)
            this.hiddenInput.value = '';
        if (this.options.mode === 'compact' && this.status === 'verified') {
            // 回到折叠态
            this.root?.classList.remove('is-open');
            this.setGateOk(false);
            this.setStatus('idle');
            this.challenge = null;
            if (this.bodyEl)
                this.bodyEl.innerHTML = '';
            this.bindBodyRefsEmpty();
            return;
        }
        await this.loadChallenge();
        this.options.onRefresh?.();
    }
    destroy() {
        this.container.innerHTML = '';
        this.root = null;
        this.challenge = null;
        this.token = null;
    }
    // ── internal ──────────────────────────────────────────
    buildShell() {
        this.container.innerHTML = '';
        const root = document.createElement('div');
        root.className = `ic-card mode-${this.options.mode === 'full' ? 'full' : 'compact'}`;
        if (this.options.accent) {
            root.style.setProperty('--ic-accent', this.options.accent);
            root.style.setProperty('--ic-accent-hover', this.options.accent);
        }
        this.root = root;
        const shell = document.createElement('div');
        shell.className = 'ic-card-shell';
        // gate
        const gate = document.createElement('div');
        gate.className = 'ic-card-gate';
        gate.tabIndex = 0;
        gate.setAttribute('role', 'button');
        gate.setAttribute('aria-label', this.options.gateLabel || '人机验证');
        gate.addEventListener('click', () => void this.openFromGate());
        gate.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void this.openFromGate();
            }
        });
        this.gateEl = gate;
        const check = document.createElement('div');
        check.className = 'ic-card-check';
        this.checkEl = check;
        gate.appendChild(check);
        const gateText = document.createElement('div');
        gateText.className = 'ic-card-gate-text';
        gateText.textContent = this.options.gateLabel || '点击进行人机验证';
        this.gateTextEl = gateText;
        gate.appendChild(gateText);
        const badge = document.createElement('div');
        badge.className = 'ic-card-gate-badge';
        badge.innerHTML = '<strong>Icon Captcha</strong>顺序点击验证';
        gate.appendChild(badge);
        shell.appendChild(gate);
        // body
        const body = document.createElement('div');
        body.className = 'ic-card-body';
        this.bodyEl = body;
        shell.appendChild(body);
        // footer
        if (this.options.showBrand !== false) {
            const footer = document.createElement('div');
            footer.className = 'ic-card-footer';
            const left = document.createElement('span');
            this.statusDotEl = document.createElement('span');
            this.statusDotEl.className = 'ic-card-status-dot';
            this.statusLabelEl = document.createElement('span');
            this.statusLabelEl.textContent = '等待验证';
            left.appendChild(this.statusDotEl);
            left.appendChild(this.statusLabelEl);
            footer.appendChild(left);
            const right = document.createElement('span');
            right.textContent = 'Icon Captcha';
            footer.appendChild(right);
            shell.appendChild(footer);
        }
        root.appendChild(shell);
        // hidden input for forms
        if (this.options.inputName) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = this.options.inputName;
            input.value = '';
            this.hiddenInput = input;
            root.appendChild(input);
        }
        this.container.appendChild(root);
    }
    bindBodyRefsEmpty() {
        this.promptEl = null;
        this.canvasEl = null;
        this.feedbackEl = null;
        this.submitBtn = null;
    }
    async openFromGate() {
        if (this.status === 'verified' || this.status === 'loading')
            return;
        this.root?.classList.add('is-open');
        await this.loadChallenge();
    }
    async loadChallenge() {
        this.setStatus('loading');
        this.setGateLoading(true);
        this.selectedSlots = [];
        this.locked = false;
        this.token = null;
        if (this.hiddenInput)
            this.hiddenInput.value = '';
        try {
            this.challenge = await this.obtainChallenge();
            this.renderBody();
            this.setStatus('ready');
            this.setGateLoading(false);
        }
        catch (err) {
            this.setGateLoading(false);
            this.setStatus('failed');
            this.renderErrorBody(err instanceof Error ? err.message : '加载失败');
            this.options.onFailure?.('bad_token');
        }
    }
    async obtainChallenge() {
        if (this.options.fetchChallenge) {
            return this.options.fetchChallenge();
        }
        if (this.options.challenge) {
            const c = this.options.challenge;
            this.options.challenge = undefined;
            return c;
        }
        if (this.options.apiBase) {
            const base = this.options.apiBase.replace(/\/$/, '');
            const res = await fetch(`${base}/challenge`, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                credentials: 'include',
            });
            if (!res.ok)
                throw new Error(`challenge HTTP ${res.status}`);
            return (await res.json());
        }
        // local demo mode
        return createChallenge({
            secret: this.options.secret,
            canvas: {
                width: this.options.canvasWidth,
                height: this.options.canvasHeight,
            },
        });
    }
    async doVerify(token, slots) {
        if (this.options.verifyRemote) {
            return this.options.verifyRemote(token, slots);
        }
        if (this.options.apiBase) {
            const base = this.options.apiBase.replace(/\/$/, '');
            const res = await fetch(`${base}/verify`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ token, slots }),
            });
            if (!res.ok)
                throw new Error(`verify HTTP ${res.status}`);
            return (await res.json());
        }
        return verifyChallenge(token, slots, this.options.secret);
    }
    renderErrorBody(msg) {
        if (!this.bodyEl)
            return;
        this.bodyEl.innerHTML = '';
        const header = this.makeHeader();
        this.bodyEl.appendChild(header);
        const fb = document.createElement('div');
        fb.className = 'ic-card-feedback is-err';
        fb.textContent = msg;
        this.bodyEl.appendChild(fb);
        const actions = document.createElement('div');
        actions.className = 'ic-card-actions';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'ic-card-btn ic-card-btn-primary';
        retry.textContent = '重试';
        retry.addEventListener('click', () => void this.loadChallenge());
        actions.appendChild(retry);
        this.bodyEl.appendChild(actions);
    }
    makeHeader() {
        const header = document.createElement('div');
        header.className = 'ic-card-header';
        const left = document.createElement('div');
        const title = document.createElement('h3');
        title.className = 'ic-card-title';
        title.textContent = this.options.title || '人机验证';
        left.appendChild(title);
        const sub = document.createElement('p');
        sub.className = 'ic-card-sub';
        sub.textContent = '请按提示依次点击 3 个图标';
        left.appendChild(sub);
        header.appendChild(left);
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'ic-card-close';
        close.setAttribute('aria-label', '收起');
        close.textContent = '×';
        close.addEventListener('click', () => {
            if (this.options.mode === 'compact' && this.status !== 'verified') {
                this.root?.classList.remove('is-open');
                this.setStatus('idle');
            }
        });
        header.appendChild(close);
        return header;
    }
    renderBody() {
        if (!this.bodyEl || !this.challenge)
            return;
        this.bodyEl.innerHTML = '';
        this.bodyEl.appendChild(this.makeHeader());
        const prompt = document.createElement('div');
        prompt.className = 'ic-card-prompt';
        prompt.textContent = this.challenge.prompt;
        this.promptEl = prompt;
        this.bodyEl.appendChild(prompt);
        const canvas = document.createElement('div');
        canvas.className = 'ic-card-canvas';
        canvas.style.aspectRatio = `${this.challenge.canvas.width} / ${this.challenge.canvas.height}`;
        this.canvasEl = canvas;
        for (const item of this.challenge.items) {
            const iconEl = document.createElement('div');
            iconEl.className = 'ic-card-item';
            iconEl.dataset.slotId = item.slotId;
            iconEl.style.left = `${item.x}%`;
            iconEl.style.top = `${item.y}%`;
            iconEl.innerHTML = `<span class="ic-card-glyph">${item.svg}</span>`;
            iconEl.addEventListener('click', () => this.onIconClick(item.slotId, iconEl));
            canvas.appendChild(iconEl);
        }
        this.bodyEl.appendChild(canvas);
        const feedback = document.createElement('div');
        feedback.className = 'ic-card-feedback';
        this.feedbackEl = feedback;
        this.bodyEl.appendChild(feedback);
        const actions = document.createElement('div');
        actions.className = 'ic-card-actions';
        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'ic-card-btn';
        refreshBtn.textContent = '换一组';
        refreshBtn.addEventListener('click', () => void this.refresh());
        actions.appendChild(refreshBtn);
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'ic-card-btn';
        resetBtn.textContent = '重置';
        resetBtn.addEventListener('click', () => void this.resetSelection());
        actions.appendChild(resetBtn);
        const submitBtn = document.createElement('button');
        submitBtn.type = 'button';
        submitBtn.className = 'ic-card-btn ic-card-btn-primary';
        submitBtn.textContent = '提交';
        submitBtn.disabled = true;
        submitBtn.addEventListener('click', () => void this.submit());
        this.submitBtn = submitBtn;
        actions.appendChild(submitBtn);
        this.bodyEl.appendChild(actions);
    }
    onIconClick(slotId, el) {
        if (this.locked || this.status === 'verified')
            return;
        if (!this.challenge)
            return;
        const idx = this.selectedSlots.indexOf(slotId);
        if (idx !== -1) {
            this.selectedSlots = this.selectedSlots.slice(0, idx);
            this.updateBadges();
            this.updateSubmit();
            return;
        }
        if (this.selectedSlots.length >= 3)
            return;
        this.selectedSlots.push(slotId);
        this.updateBadges();
        this.updateSubmit();
    }
    updateBadges() {
        if (!this.canvasEl)
            return;
        this.canvasEl.querySelectorAll('.ic-card-badge').forEach((b) => b.remove());
        this.canvasEl.querySelectorAll('.ic-card-item').forEach((el) => {
            el.classList.remove('is-picked');
        });
        for (let i = 0; i < this.selectedSlots.length; i++) {
            const slotId = this.selectedSlots[i];
            const el = this.canvasEl.querySelector(`[data-slot-id="${slotId}"]`);
            if (el) {
                el.classList.add('is-picked');
                const badge = document.createElement('span');
                badge.className = 'ic-card-badge';
                badge.textContent = String(i + 1);
                el.appendChild(badge);
            }
        }
    }
    updateSubmit() {
        if (this.submitBtn) {
            this.submitBtn.disabled = this.selectedSlots.length !== 3 || this.locked;
        }
        if (this.status !== 'verified')
            this.setFeedback('');
    }
    setFeedback(text, kind) {
        if (!this.feedbackEl)
            return;
        this.feedbackEl.textContent = text;
        this.feedbackEl.className = 'ic-card-feedback';
        if (kind === 'ok')
            this.feedbackEl.classList.add('is-ok');
        if (kind === 'err')
            this.feedbackEl.classList.add('is-err');
    }
    async submit() {
        if (this.locked || !this.challenge || this.selectedSlots.length !== 3)
            return;
        this.locked = true;
        if (this.submitBtn)
            this.submitBtn.disabled = true;
        this.setFeedback('校验中…');
        try {
            const result = await this.doVerify(this.challenge.token, this.selectedSlots);
            if (result.ok) {
                this.token = this.challenge.token;
                if (this.hiddenInput)
                    this.hiddenInput.value = this.token;
                this.setFeedback('验证通过', 'ok');
                this.setStatus('verified');
                this.setGateOk(true);
                this.options.onSuccess?.(this.token);
                this.emitParent('icon-captcha:success', { token: this.token });
                // compact：成功后可收起到门闩勾选态
                if (this.options.mode === 'compact') {
                    setTimeout(() => {
                        this.root?.classList.remove('is-open');
                        if (this.gateTextEl)
                            this.gateTextEl.textContent = '验证已通过';
                    }, 450);
                }
            }
            else {
                const messages = {
                    bad_token: '令牌无效，请换一组',
                    expired: '已过期，请换一组',
                    wrong: '顺序错误，请重试',
                    incomplete: '请选满 3 个图标',
                };
                this.setFeedback(messages[result.reason] || '验证失败', 'err');
                this.setStatus('failed');
                this.locked = false;
                if (this.submitBtn)
                    this.submitBtn.disabled = this.selectedSlots.length !== 3;
                this.options.onFailure?.(result.reason);
                this.emitParent('icon-captcha:failure', { reason: result.reason });
            }
        }
        catch {
            this.setFeedback('网络错误，请重试', 'err');
            this.setStatus('failed');
            this.locked = false;
            if (this.submitBtn)
                this.submitBtn.disabled = false;
            this.options.onFailure?.('bad_token');
        }
    }
    setStatus(status) {
        this.status = status;
        if (this.statusDotEl) {
            this.statusDotEl.className = 'ic-card-status-dot';
            if (status === 'verified')
                this.statusDotEl.classList.add('is-ok');
            else if (status === 'failed')
                this.statusDotEl.classList.add('is-err');
            else if (status === 'loading')
                this.statusDotEl.classList.add('is-load');
        }
        if (this.statusLabelEl) {
            const map = {
                idle: '等待验证',
                loading: '加载中',
                ready: '请按提示点击',
                verified: '已通过',
                failed: '未通过',
            };
            this.statusLabelEl.textContent = map[status];
        }
        this.options.onStatus?.(status);
    }
    setGateLoading(loading) {
        if (!this.checkEl)
            return;
        this.checkEl.classList.toggle('is-loading', loading);
        if (loading)
            this.checkEl.textContent = '';
    }
    setGateOk(ok) {
        if (!this.checkEl)
            return;
        this.checkEl.classList.remove('is-loading');
        this.checkEl.classList.toggle('is-ok', ok);
        this.checkEl.textContent = ok ? '✓' : '';
        if (ok && this.gateTextEl)
            this.gateTextEl.textContent = '验证已通过';
        else if (!ok && this.gateTextEl) {
            this.gateTextEl.textContent = this.options.gateLabel || '点击进行人机验证';
        }
    }
    emitParent(type, payload) {
        const enabled = this.options.postMessageToParent ??
            (typeof window !== 'undefined' && window.parent && window.parent !== window);
        if (!enabled || typeof window === 'undefined')
            return;
        try {
            window.parent.postMessage({ source: 'icon-captcha', type, ...payload }, this.options.postMessageOrigin || '*');
        }
        catch {
            /* ignore */
        }
    }
}
/** 快捷挂载（自动 init） */
export function mountCaptchaCard(options) {
    const card = new CaptchaCard(options);
    void card.init();
    return card;
}
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
export function autoMountCaptchaCards(defaults = {}) {
    const nodes = document.querySelectorAll('[data-icon-captcha]');
    const cards = [];
    nodes.forEach((el) => {
        if (el.dataset.icMounted === '1')
            return;
        el.dataset.icMounted = '1';
        const opt = {
            ...defaults,
            container: el,
            mode: el.dataset.mode || defaults.mode || 'compact',
            apiBase: el.dataset.apiBase || defaults.apiBase,
            secret: el.dataset.secret || defaults.secret,
            inputName: el.dataset.inputName || defaults.inputName,
            title: el.dataset.title || defaults.title,
            gateLabel: el.dataset.gateLabel || defaults.gateLabel,
            accent: el.dataset.accent || defaults.accent,
        };
        const card = new CaptchaCard(opt);
        void card.init();
        cards.push(card);
    });
    return cards;
}
//# sourceMappingURL=card.js.map