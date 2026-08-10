/**
 * captcha-widget.js — 可嵌入的前端 widget
 *
 * 用法：
 *   <div id="captcha-container"></div>
 *   <script type="module">
 *     import { mountCaptcha } from './captcha-widget.js';
 *     mountCaptcha({
 *       container: '#captcha-container',
 *       secret: 'my-secret',
 *       onSuccess: (token) => console.log('passed', token),
 *     });
 *   </script>
 *
 * 依赖：dist/index.js 和 dist/browser.js （需先 npm run build）
 */

export { CaptchaWidget, mountCaptcha } from '../dist/browser.js';
