# AI Bridge

多用户云端 AI 互通桥：注册账号、获取 API Key、按项目与本地 Agent 对话。

- 站点：https://aibridge.tanstudio.me
- 开源：https://github.com/YizeHe/aibridge

## 功能

- 用户注册 / 登录 / 改密 / API Key 轮换
- 注册人机验证（图标顺序点击，基于 `@yunstorage/icon-captcha`）
- 项目制消息通道（用户浏览器 ↔ 本地 Agent）
- 免费 1 项目；Premium 不限
- 管理员：封禁、改密、开通 Premium（默认 `root` / `ROOT12345678`）
- Go 本地 Agent，可分发二进制；兼容可选本地 `5565` HTTP 协议
- 前端 Tailwind，现代深色 UI

## 目录

```
aibridge/
  src/           Cloudflare Worker API
  public/        前端静态资源
  migrations/    D1 schema
  client/        Go agent
  skills/        给 AI 的 SKILLS.md
  vendor/        captcha 依赖拷贝
```

## 本地开发

```bash
npm install
npx wrangler d1 migrations apply aibridge-db --local
npx wrangler dev
```

可选 `.dev.vars`：

```
CAPTCHA_SECRET=dev-captcha-secret
JWT_SECRET=dev-session-secret
```

## 部署 Cloudflare

```bash
# 创建 D1（首次）
npx wrangler d1 create aibridge-db
# 将输出的 database_id 写入 wrangler.toml

npm install
npx wrangler d1 migrations apply aibridge-db --remote
npx wrangler secret put CAPTCHA_SECRET
npx wrangler secret put JWT_SECRET
npx wrangler deploy

# 在 Cloudflare Dashboard 为 Worker 绑定自定义域 aibridge.tanstudio.me
```

## 构建 Agent 发布包

```bash
cd client
GOOS=windows GOARCH=amd64 go build -o ../dist/aibridge-windows-amd64.exe .
GOOS=linux   GOARCH=amd64 go build -o ../dist/aibridge-linux-amd64 .
GOOS=darwin  GOARCH=arm64 go build -o ../dist/aibridge-darwin-arm64 .
GOOS=darwin  GOARCH=amd64 go build -o ../dist/aibridge-darwin-amd64 .
```

上传到 GitHub Releases，供 SKILLS.md 指引下载。

## 用户怎么用

1. 打开 https://aibridge.tanstudio.me 注册
2. 复制 API Key，创建项目
3. 把 `skills/SKILLS.md` + API Key + 项目名交给 AI
4. AI 下载 Agent 并轮询；用户在网页里对话

## License

MIT
