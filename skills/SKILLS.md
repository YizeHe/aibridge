# AI Bridge Skill — 给 AI 的接入说明

把本文件交给 AI，并提供：

1. **API Key**（用户在 https://aibridge.tanstudio.me 注册后于「账号」页复制）
2. **项目名称**（用户指定；未指定时可自定义，例如当前仓库名）

AI 应自动完成：下载本地 Agent、确保云端项目存在、配置轮询与回复推送。

---

## 云端地址

- 主域名：`https://aibridge.tanstudio.me`（Cloudflare Workers 路由已绑定；若 DNS 未指向 Cloudflare 可先用下方备用）
- 备用（已上线可用）：`https://aibridge.tangent2533.workers.dev`
- 健康检查：`GET /api/health`

Agent 默认 base 为 `https://aibridge.tanstudio.me`；若域名暂时不可用，启动时加：

```bash
./aibridge -base https://aibridge.tangent2533.workers.dev -key ak_xxx -project my-project
```


## 本地 Agent（Go 可执行文件）

发布页（GitHub Releases）：

```
https://github.com/YizeHe/aibridge/releases/latest
```

按操作系统下载对应二进制（示例名）：

| 平台 | 文件 |
|------|------|
| Windows amd64 | `aibridge-windows-amd64.exe` |
| Linux amd64 | `aibridge-linux-amd64` |
| macOS arm64 | `aibridge-darwin-arm64` |
| macOS amd64 | `aibridge-darwin-amd64` |

也可从源码构建：

```bash
git clone https://github.com/YizeHe/aibridge.git
cd aibridge/client
go build -o aibridge .
```

## 一键配置（AI 执行）

将下面变量替换为真实值：

```bash
# Windows PowerShell 示例
$env:AIBRIDGE_KEY = "ak_xxx"
$env:AIBRIDGE_PROJECT = "my-project"
$env:AIBRIDGE_BASE = "https://aibridge.tanstudio.me"

# 后台轮询（打印 pending 用户消息）
./aibridge -key $env:AIBRIDGE_KEY -project $env:AIBRIDGE_PROJECT

# 可选：兼容本地 5565 协议（供已有 bridge-reply 脚本）
./aibridge -key $env:AIBRIDGE_KEY -project $env:AIBRIDGE_PROJECT -serve 127.0.0.1:5565
```

```bash
# Linux / macOS
export AIBRIDGE_KEY=ak_xxx
export AIBRIDGE_PROJECT=my-project
./aibridge -key "$AIBRIDGE_KEY" -project "$AIBRIDGE_PROJECT"
```

### 发送回复

```bash
./aibridge -key ak_xxx -project my-project -reply "完整回复正文"

# 长回复用文件
./aibridge -key ak_xxx -project my-project -reply-file /path/to/reply.md
```

### 只拉一次 pending

```bash
./aibridge -key ak_xxx -project my-project -once -json
```

## HTTP API（Agent 侧，Bearer API Key）

### 确保项目存在

```http
POST /api/agent/projects
Authorization: Bearer ak_xxx
Content-Type: application/json

{"name":"my-project"}
```

### 拉取未读用户消息

```http
GET /api/agent/pending?project=my-project
Authorization: Bearer ak_xxx
```

响应：

```json
{
  "success": true,
  "project": { "id": 1, "name": "my-project", "slug": "my-project" },
  "messages": [
    { "id": "...", "role": "user", "text": "...", "ts": "...", "acked": false }
  ]
}
```

### 推送 Agent 回复（会自动 ack 当前 pending）

```http
POST /api/agent/reply
Authorization: Bearer ak_xxx
Content-Type: application/json

{"project":"my-project","text":"markdown 回复..."}
```

## AI 工作流（必须遵守）

1. 读取用户提供的 API Key 与项目名。
2. 若本机无 `aibridge` 可执行文件：从 GitHub Releases 下载或 `go build`。
3. 调用 `-ensure`（默认开启）创建/绑定项目。
4. **边做边回**：有实质进度就立刻 `-reply` 推送，不要等全部完成。
5. 定时（如每 30–60 秒）`-once` 检查新用户消息；有消息则处理并回复。
6. 用户在 https://aibridge.tanstudio.me 打开对应项目即可看到对话。

## 账号规则（告知用户）

- 免费账号：最多 **1** 个项目
- Premium：项目数量不限（由管理员开通）
- 注册需人机验证；可在网站修改密码、轮换 API Key

## 安全

- API Key 等同密码，勿提交到公开仓库
- 可在网站「账号」页一键轮换 Key
- 不要在日志中完整打印 API Key
