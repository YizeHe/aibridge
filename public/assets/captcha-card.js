/**
 * captcha-card.js — 卡片式 CAPTCHA 嵌入入口（ESM）
 *
 * 用法：
 *   <div id="captcha"></div>
 *   <script type="module">
 *     import { mountCaptchaCard } from './captcha-card.js';
 *     mountCaptchaCard({
 *       container: '#captcha',
 *       mode: 'compact',
 *       apiBase: 'https://your.api/captcha', // 生产推荐
 *       // secret: 'only-for-local-demo',
 *       inputName: 'captcha_token',
 *       onSuccess: (token) => console.log(token),
 *     });
 *   </script>
 *
 * 或 data 属性：
 *   <div data-icon-captcha data-mode="compact" data-api-base="/api/captcha"></div>
 *   <script type="module">
 *     import { autoMountCaptchaCards } from './captcha-card.js';
 *     autoMountCaptchaCards();
 *   </script>
 *
 * 依赖：需可访问 ../dist/card.js（及 challenge 链路模块）
 */

export {
  CaptchaCard,
  mountCaptchaCard,
  autoMountCaptchaCards,
} from '../dist/card.js';
