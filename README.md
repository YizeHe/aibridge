# AI Bridge

多用户云端 AI 互通桥：注册账号、获取 API Key、按项目与本地 Agent 对话。

- **站点**：https://aibridge.tanstudio.me  
- **开源**：https://github.com/YizeHe/aibridge  

## 功能

- 用户注册 / 登录 / 改密 / API Key 轮换  
- 注册人机验证（图标顺序点击）  
- 项目制消息通道（浏览器用户 ↔ 本地 Agent）  
- 页面提供 **SKILLS 下载**，方便交给 AI 接入  
- 会员自助开通（支付宝 / 微信）：**5 元/月**、**50 元/年**  
- Go 本地 Agent 客户端  
- 前端：中文界面、浅色默认、明暗切换、液态玻璃项目卡片  

## 目录

```
aibridge/
  src/           Cloudflare Worker API
  public/        前端静态资源（含 /skills 下载）
  migrations/    D1 schema
  client/        Go agent
  skills/        给 AI 的 SKILLS.md
  vendor/        captcha 依赖拷贝
```

## 本地开发

```bash
npm install
npx.cmd wrangler d1 migrations apply aibridge-db --local
npx.cmd wrangler dev
```

可选 `.dev.vars`：

```
CAPTCHA_SECRET=...
JWT_SECRET=...
COMMERCIAL=1
MERCHANT_PID=...
MERCHANT_KEY=...
PLATFORM_KEY=...
NOTIFY_URL=https://aibridge.tanstudio.me/api/pay/notify
```

## 部署

```bash
npx.cmd wrangler d1 migrations apply aibridge-db --remote
npx.cmd wrangler secret put CAPTCHA_SECRET
npx.cmd wrangler secret put JWT_SECRET
npx.cmd wrangler secret put MERCHANT_PID
npx.cmd wrangler secret put MERCHANT_KEY
npx.cmd wrangler secret put PLATFORM_KEY
npx.cmd wrangler deploy
```

`wrangler.jsonc` 中 `COMMERCIAL=1` 表示正式商业站（会员与项目额度策略生效）。

## 用户怎么用

1. 打开 https://aibridge.tanstudio.me 注册  
2. 在「账号」复制 API Key，创建项目  
3. 下载 SKILLS.md，连同 Key 与项目名交给 AI  
4. AI 启动本地 Agent；你在网页项目里对话  

## License

MIT
