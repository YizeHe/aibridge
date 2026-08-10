# AIBridge

多用户云端 AI 互通桥：像 Codex Mobile 一样，在手机/任意浏览器上调用自己电脑里的 AI Coding 工具。

**AIBridge** is a multi-user cloud bridge that lets you talk to AI agents running on your own machine — similar to Codex Mobile — from any browser or phone.

- **站点 / Site**：https://aibridge.tanstudio.me  
- **开源 / Open source**：https://github.com/YizeHe/aibridge  

---

## 中文

### 它能做什么

- **远程驱动本机 AI**：家里电脑开着，人在外面也能用手机发指令、修 Bug  
- **适配主流 AI Coding 工具**：无需安装庞大环境，给 AI 复制一小段提示词即可自行接入  
- 用户注册 / 登录 / 改密 / API Key 轮换  
- 项目制消息通道（网页用户 ↔ 本地 Agent）  
- **SKILLS 提示词一键复制**（含 API Key + 项目名）  
- 会员自助开通（支付宝 / 微信）：**5 元/月** 无限制项目，免费额度每月 1 个项目  
- 工单客服；root 客服台：`/kefu`  
- Go 本地 Agent（可读写工作目录、上传云端工作区文件）  
- 前端：中文界面、默认深色、明暗切换、液态玻璃卡片  

### 目录

```
aibridge/
  src/           Cloudflare Worker API
  public/        前端静态资源
  migrations/    D1 schema
  client/        Go agent
  skills/        给 AI 的 SKILLS.md
```

### 本地开发

```bash
npm install
npx.cmd wrangler d1 migrations apply aibridge-db --local
npx.cmd wrangler dev
```

可选 `.dev.vars`（**切勿提交到 Git**）：

```
JWT_SECRET=...
COMMERCIAL=1
TURNSTILE_SECRET=...
MERCHANT_PID=...
MERCHANT_KEY=...
PLATFORM_KEY=...
NOTIFY_URL=https://aibridge.tanstudio.me/api/pay/notify
```

### 部署

```bash
npx.cmd wrangler d1 migrations apply aibridge-db --remote
npx.cmd wrangler secret put JWT_SECRET
npx.cmd wrangler secret put TURNSTILE_SECRET
# 支付相关 secret 按需配置
npx.cmd wrangler deploy
```

`wrangler.jsonc` 中 `COMMERCIAL=1` 表示商业站策略生效。

### 用户怎么用

1. 打开 https://aibridge.tanstudio.me 注册并登录  
2. 创建一个项目  
3. 打开 **SKILLS**，点击「复制提示词给 AI」（单个项目直接复制；多个项目时先选择）  
4. 把提示词发给你的 AI Coding 工具；AI 会按说明下载/运行本地 Agent  
5. 在网页项目里发消息即可与本机 AI 互通  

### 本地 Agent 示例

```bash
# Windows 下载
# https://aibridge.tanstudio.me/downloads/aibridge-windows-amd64.exe

./aibridge -key ak_xxx -project my-project -workdir .
./aibridge -key ak_xxx -project my-project -workdir . -local-list
```

### License

MIT

---

## English

### What it does

- **Remote control of your local AI** — keep your PC on at home, send instructions from a phone or any browser (Codex Mobile–style workflow)  
- **Works with popular AI coding tools** — no heavyweight install; paste a short prompt and the AI sets itself up  
- Auth: register / login / password change / API key rotation  
- Per-project message channels (web user ↔ local agent)  
- **One-click SKILLS prompt copy** (includes API key + project name)  
- Membership (Alipay / WeChat): **¥5/month** unlimited projects; free tier = 1 project  
- Support tickets; root-only desk at `/kefu`  
- Lightweight Go agent (read local workdir, sync project files to cloud)  
- Chinese UI, dark default, light/dark toggle, liquid-glass cards  

### Layout

```
aibridge/
  src/           Cloudflare Worker API
  public/        SPA assets
  migrations/    D1 schema
  client/        Go agent
  skills/        SKILLS.md for AI tools
```

### Local development

```bash
npm install
npx.cmd wrangler d1 migrations apply aibridge-db --local
npx.cmd wrangler dev
```

Optional `.dev.vars` (**never commit**):

```
JWT_SECRET=...
COMMERCIAL=1
TURNSTILE_SECRET=...
MERCHANT_PID=...
MERCHANT_KEY=...
PLATFORM_KEY=...
NOTIFY_URL=https://aibridge.tanstudio.me/api/pay/notify
```

### Deploy

```bash
npx.cmd wrangler d1 migrations apply aibridge-db --remote
npx.cmd wrangler secret put JWT_SECRET
npx.cmd wrangler secret put TURNSTILE_SECRET
npx.cmd wrangler deploy
```

Set `COMMERCIAL=1` in `wrangler.jsonc` for commercial plan limits.

### End-user flow

1. Register at https://aibridge.tanstudio.me  
2. Create a project  
3. Open **SKILLS** → “Copy prompt for AI” (auto-picks if only one project; asks to choose if several)  
4. Paste the prompt into your AI coding tool; it follows SKILLS to run the local agent  
5. Chat from the web project UI  

### Local agent

```bash
# Windows binary
# https://aibridge.tanstudio.me/downloads/aibridge-windows-amd64.exe

./aibridge -key ak_xxx -project my-project -workdir .
```

### License

MIT
