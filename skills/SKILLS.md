# AI Bridge Skill — 给 AI 的接入说明

把本文件交给 AI，并提供：

1. **API Key**（用户在 https://aibridge.tanstudio.me 注册后于「账号」页复制）
2. **项目名称**（用户指定；未指定时可自定义，例如当前仓库名）

AI 应自动完成：下载本地 Agent、确保云端项目存在、配置轮询与回复推送。

站点也可直接下载本文件：

```
https://aibridge.tanstudio.me/skills/SKILLS.md
```

---

## 云端地址

- 正式站点：`https://aibridge.tanstudio.me`
- 健康检查：`GET /api/health`

Agent 默认 base：

```bash
./aibridge -base https://aibridge.tanstudio.me -key ak_xxx -project my-project
```


## 本地 Agent（Go 可执行文件）

### 直接下载（推荐）

| 平台 | 下载 |
|------|------|
| Windows amd64 | https://aibridge.tanstudio.me/downloads/aibridge-windows-amd64.exe |

源码构建：

```bash
git clone https://github.com/YizeHe/aibridge.git
cd aibridge/client
go build -o aibridge .
```

### 工作目录（本地文件）

客户端默认读取当前工作目录（`-workdir`，或环境变量 `AIBRIDGE_WORKDIR`）：

```bash
# 列出本地工作目录文件
./aibridge -key ak_xxx -project my-project -workdir . -local-list

# 读取本地文件
./aibridge -key ak_xxx -project my-project -workdir . -local-read README.md

# 上传本地文件到云端项目工作区
./aibridge -key ak_xxx -project my-project -workdir . -put-file src/main.go -as src/main.go

# 本地 HTTP（含 workdir API）
./aibridge -key ak_xxx -project my-project -workdir . -serve 127.0.0.1:5565
# GET http://127.0.0.1:5565/api/workdir/list
# GET http://127.0.0.1:5565/api/workdir/read?path=README.md
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

### 项目文件（工作区）

```http
GET /api/agent/files?project=my-project
Authorization: Bearer ak_xxx

GET /api/agent/file?project=my-project&path=src/main.go
Authorization: Bearer ak_xxx

PUT /api/agent/file
Authorization: Bearer ak_xxx
Content-Type: application/json

{"project":"my-project","path":"src/main.go","content":"...","encoding":"utf8"}

DELETE /api/agent/file?project=my-project&path=src/main.go
Authorization: Bearer ak_xxx
```

图片等二进制可用 `"encoding":"base64"`。修改文件后用户网页会自动同步；若用户正在编辑同一文件会提示冲突合并。

收到聊天中以 `[AIBridge 合并请求]` 开头的消息时：读取用户版本与 AI 版本两个文件，智能合并后写回目标路径。

## AI 工作流（必须遵守）

1. 读取用户提供的 API Key 与项目名。
2. 若本机无 `aibridge` 可执行文件：从 GitHub Releases 下载或 `go build`。
3. 调用 `-ensure`（默认开启）创建/绑定项目。
4. **边做边回**：有实质进度就立刻 `-reply` 推送，不要等全部完成。
5. 定时（如每 30–60 秒）`-once` 检查新用户消息；有消息则处理并回复。
6. 用户在 https://aibridge.tanstudio.me 打开对应项目即可看到对话。

## 账号规则（告知用户）

- 注册需人机验证；可在网站修改密码、轮换 API Key
- 会员：5 元/月、50 元/年（站点内自助开通）；有效期内项目不限
- 未开通会员时项目数量有限制；开通后不限

## 安全

- API Key 等同密码，勿提交到公开仓库
- 可在网站「账号」页一键轮换 Key
- 不要在日志中完整打印 API Key
