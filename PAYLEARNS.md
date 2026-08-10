# 支付接入踩坑笔记（pay.ykmcn.com / AIBridge）

本文记录 AIBridge 接入 **pay.ykmcn.com**（RSA 易支付风格）时踩过的坑，以及正确做法。  
**密钥、PID、私钥不得提交 Git**（见 `.gitignore` 的 `key/`、`.dev.vars`）。

---

## 1. 「本次支付需要安全验证，请使用跳转支付接口发起支付」

### 现象

调用 `POST https://pay.ykmcn.com/api/pay/create` 后，`code != 0`，`msg` 类似：

> 本次支付需要安全验证，请使用跳转支付接口发起支付

前端表现为：点支付宝/微信后 toast/弹窗失败，无法打开收银台。

### 原因

下单参数里用了：

```text
method=web
```

部分通道（尤其微信/支付宝）在商户后台开启了「安全验证 / 强制跳转」时，**禁止 web 接口**，必须用 **跳转支付**：

```text
method=jump
```

### 正确做法

```ts
// src/pay.ts createPayOrder
method: 'jump',  // 不要用 web
type: 'alipay' | 'wxpay',
// ...
```

成功时平台返回的 `pay_info`（或 `payurl` / `pay_url`）是 **可浏览器打开的收银台 URL**，前端：

```js
location.href = r.payUrl;
```

### 错误处理

若仍看到该文案，优先检查线上 Worker 是否已部署 `method: 'jump'`，而不是只改本地。

---

## 2. method 取值对照（易支付系常见）

| method | 含义 | AIBridge 场景 |
|--------|------|----------------|
| `jump` | 跳转收银台 URL | **默认采用** |
| `web` | 网页/接口类，部分通道禁用 | 会触发「安全验证」报错 |
| `jsapi` / `scan` 等 | 公众号 / 扫码等 | 本站未接 |

以商户后台与平台文档为准；本项目只接 **跳转收银台**。

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
| 2026-08 | 下单 `method` 从 `web` 改为 `jump`，消除「安全验证 / 跳转支付」报错 |
| 2026-08 | 兼容 `pay_info` / `payurl` / `pay_url` 字段 |
| 2026-08 | `return_url` 改为 `/#/account`；激活码 placeholder 文案调整 |

---

## 10. 快速自检命令（勿泄露输出中的密钥）

```bash
# 仅检查 secret 是否已配置（不会打印值）
npx.cmd wrangler secret list

# 部署含 pay.ts 的 Worker
npx.cmd wrangler deploy
```

联调时用真实小额订单走通：创建 → 跳转 → 支付 → notify → 账号页会员状态。
