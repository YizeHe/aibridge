# 支付接入踩坑笔记（pay.ykmcn.com / AIBridge）

本文记录 AIBridge 接入 **pay.ykmcn.com**（RSA 易支付风格）时踩过的坑，以及正确做法。  
**密钥、PID、私钥不得提交 Git**（见 `.gitignore` 的 `key/`、`.dev.vars`）。

---

## 1. 「本次支付需要安全验证，请使用跳转支付接口发起支付」

### 现象

服务端调用 `POST https://pay.ykmcn.com/api/pay/create`（无论 `method=web` 还是 `method=jump`）都可能返回：

> 本次支付需要安全验证，请使用跳转支付接口发起支付

前端表现为：无法打开收银台，只看到失败提示。

### 原因（关键纠正）

这里的 **「跳转支付接口」≠ 在 create 接口里把 method 改成 jump**。

| 接口 | 用途 | AIBridge |
|------|------|----------|
| `POST /api/pay/create` | **服务端 API 下单**（mapi 风格，常触发设备/安全校验） | **不要用于浏览器收银台** |
| **`GET/POST /api/pay/submit`** | **页面跳转支付**：用户浏览器打开带签名的 URL/表单，进入收银台 | **正确做法** |

商户后台对部分通道开启「强制跳转 / 安全验证」后，**禁止 API create**，只允许用户浏览器访问 **submit**。

### 正确做法（当前实现 · 官方文档）

文档：https://pay.ykmcn.com/doc/pay_submit.html  

```text
请求地址：https://pay.ykmcn.com/api/pay/submit
请求方式：POST 或 GET（推荐 POST）
```

必填字段：`pid, type, out_trade_no, notify_url, return_url, name, money, timestamp, sign, sign_type`  
**不要传** create 接口的 `method` / `clientip` / `device`（submit 文档无此字段，多传可能导致验签失败）。

```ts
// 1. 本地建订单 orders
// 2. 按 submit 文档组参 + RSA(SHA256WithRSA) 签名
// 3. 返回前端：
//    payUrl = https://pay.ykmcn.com/api/pay/submit
//    payMethod = 'form'
//    payFields = { ...signed params }
// 4. 前端动态 form POST 到 payUrl（不要服务端代请求）
```

### 错误做法

```ts
// ❌ 服务端 fetch create
method: 'web' | 'jump'
await fetch('https://pay.ykmcn.com/api/pay/create', ...)
// 平台明确要求用户走「页面跳转支付」接口 submit
```

### return_url 注意

- 不要用 `https://site/#/account`（平台追加 query 与 hash 冲突）  
- 用 `https://site/?from=pay&order=xxx`，前端识别后进 `#/account`  

### 官方文档索引

- 总览：https://pay.ykmcn.com/doc/  
- 页面跳转支付：https://pay.ykmcn.com/doc/pay_submit.html  
- 统一下单（API，本站不用）：https://pay.ykmcn.com/doc/pay_create.html  
- 签名规则：https://pay.ykmcn.com/doc/sign_note.html  


---

## 2. 接口对照

| 路径 | 谁发起 | 说明 |
|------|--------|------|
| `/api/pay/submit` | **用户浏览器** | 跳转收银台（本站采用） |
| `/api/pay/create` | 服务器 | API 下单；本通道易被安全策略拦截 |
| `/api/pay/notify` | 支付平台 → 本站 | 异步发货回调 |

---

## 3. RSA 签名坑

### 签名串

- 除 `sign`、`sign_type` 外，所有 **非空** 参数参与签名  
- **键名字典序** 排序后 `k=v` 用 `&` 拼接  
- 算法：`RSASSA-PKCS1-v1_5` + **SHA-256**  
- 签名结果 **Base64**

### 密钥形态

| 环境变量 | 用途 | 形态 |
|----------|------|------|
| `MERCHANT_KEY` | 商户私钥，下单签名 | PKCS#8 PEM 或可剥头尾的 Base64 |
| `PLATFORM_KEY` | 平台公钥，回调验签 | SPKI PEM / Base64 |

常见错误：

1. **用错公钥/私钥**（回调验签失败，永远不发货）  
2. PEM 头尾未剥干净 / 多了换行导致 importKey 失败  
3. 签名时带了 `sign` 字段本身  
4. `money` 格式不一致（应用 `toFixed(2)`，如 `5.00`）  

实现见 `src/pay.ts` 的 `buildSignString` / `rsaSign` / `rsaVerify`。

---

## 4. 异步回调 notify（发货唯一依据）

### 要求

- 公网 **HTTPS**  
- 推荐固定：`NOTIFY_URL=https://aibridge.tanstudio.me/api/pay/notify`  
- 处理成功必须纯文本返回 **`success`**（平台约定；返回 `fail` 会重试）  
- **幂等**：`orders.status === 'paid'` 时直接 success，勿重复加会员  

### 坑

| 问题 | 后果 | 处理 |
|------|------|------|
| notify 仍指向旧域名（如别的项目） | 付了钱不升级 | `wrangler secret put NOTIFY_URL` 或 env 改为本站 |
| 只信 `return_url` 回站 | 用户关页/回调慢导致漏单 | 回站仅展示；发货只看 notify 或主动查单 |
| 验签失败仍写库 | 被伪造回调 | 先验 `PLATFORM_KEY`，失败返回 fail |
| `trade_status` 未判断 | 非成功通知也发货 | 仅 `TRADE_SUCCESS` 时升级 |

### return_url

- 仅用户体验回落，可跳 `#/account` 看会员状态  
- **不要**只靠 return_url 给会员  

---

## 5. 金额、订单与套餐

| 项 | 约定 |
|----|------|
| 月付 | `plan=monthly`，`money=5.00` |
| 年付 | `plan=yearly`，`money=50.00` |
| 商户订单号 | 本地生成 `out_trade_no`，写入 `orders` 表后再请求平台 |
| 平台单号 | `trade_no`，回调时写入；幂等键优先用 `out_trade_no` |

会员延长：从 `max(now, premium_until)` 起加 1 月或 1 年（`extendPremiumUntil`）。

---

## 6. Secrets / 配置清单（线上）

```bash
npx.cmd wrangler secret put MERCHANT_PID
npx.cmd wrangler secret put MERCHANT_KEY
npx.cmd wrangler secret put PLATFORM_KEY
npx.cmd wrangler secret put NOTIFY_URL   # 可选，默认可拼 SITE_URL
```

`wrangler.jsonc` 公开变量可有：

- `SITE_URL=https://aibridge.tanstudio.me`  
- `COMMERCIAL=1`  

**切勿**把私钥写进 `wrangler.jsonc` 的 `vars` 或推送到 GitHub。

本地：`key/dev.vars`、`key/*.pem` 仅本机，已在 `.gitignore`。

---

## 7. 前端联调检查

1. 会员页点「支付宝 / 微信支付」→ `/api/pay/create` 返回 `success` + `payUrl`  
2. 浏览器跳转到收银台（HTTPS）  
3. 支付成功后平台 POST notify → 会员 `plan/premium_until` 更新  
4. 用户回到站点刷新账号页可见会员  

失败时看 Worker 日志与 `orders.status`（`pending` / `failed` / `paid`）。

---

## 8. 与 GSORG Bank 文档的区别

仓库 `key/商户接入文档.md` 描述的是 **另一套** GSORG Bank 收银台，**不是** pay.ykmcn.com。  
AIBridge 当前实现以 **pay.ykmcn.com + RSA + method=jump** 为准，勿混用 Bank 的 `ID/amount` 查询串模式。

---

## 9. 变更记录

| 日期 | 项 |
|------|-----|
| 2026-08 | 初判把 `method` 从 `web` 改为 `jump`（仍走 create）——**不够**，平台仍报跳转支付 |
| 2026-08 | **改为浏览器打开 `/api/pay/submit` 签名 URL**，不再服务端 create |
| 2026-08 | `return_url` 用 `/?from=pay&order=`，避免 hash 冲突 |
| 2026-08 | 激活码 placeholder：新用户福利：RemoteAiGENT |

---

## 10. 快速自检命令（勿泄露输出中的密钥）

```bash
# 仅检查 secret 是否已配置（不会打印值）
npx.cmd wrangler secret list

# 部署含 pay.ts 的 Worker
npx.cmd wrangler deploy
```

联调时用真实小额订单走通：创建 → 跳转 → 支付 → notify → 账号页会员状态。
