# 双流程首次使用：文档监控与 Amazon.sg 商品

当前状态：**本机可运行；永久 HTTPS MCP 地址、WorkOS 登录和 Render 上的整条流程尚待验收。** 两个流程共用一个 MCP 服务和持久任务状态。Amazon 商品是 JSON 采集与批次查询，**不是**价格变化提醒。

## Howard 本机先用

在仓库根目录运行：

```bash
npm ci
npm run first-use:local
```

第二条命令会检查类型、安装 Chromium、建立仅限 Amazon.sg 的匿名 Singapore 238823／SGD 偏好、启动本机 HTTPS 接收器与统一 MCP 服务，并在可用时登记 `w2l-local`。它不会登录 Amazon，也不会把偏好文件提交到 Git。打开一个**新的** Codex 任务，确认 `w2l-local` 已连接；若自动登记未成功，执行：

```bash
codex mcp add w2l-local --url http://127.0.0.1:8791/mcp
```

本机服务绑定 `127.0.0.1`，需要保留这份仓库。运行 `npm run local:mcp:status` 和 `npm run local:receiver:status` 可检查状态；`npm run local:mcp:uninstall`、`npm run local:receiver:uninstall` 可停止后台服务。

## 一个对话完成文档监控

告诉 Codex：“用 W2L 预览 Firecrawl Introduction，给我看质量、证据和缺失原因。创建**暂停**的 Monitor，接到本机已配置的 HTTPS 接收器，再恢复运行。最后核对 Monitor 事件、投递记录和接收端 `eventId`。”

对应工具流程是 `preview_monitor({"preset":"firecrawl-introduction"})` → `create_monitor` → `create_delivery_destination` → `resume_monitor` → `get_monitor`／`get_monitor_run` → `list_deliveries`。本机接收地址是 `https://127.0.0.1:8788/webhook`，目标使用 `secretEnv: "W2L_WEBHOOK_SECRET_DEMO"`；只传环境变量**名称**，不要把密钥发给 MCP。`run_monitor` 会立即返回持久 `runId`；客户端断开后仍可重新查询。`pause_monitor` 停止后续调度；`get_delivery` 和 `retry_dead_letter` 用于诊断及显式重试失败投递。

## 一个对话取得商品 JSON 与批次结果

告诉 Codex：“用 W2L 的 `scrape_product` 采集 `https://www.amazon.sg/dp/B000VW9PIK`，显示主体 ASIN、标题、当前价格／币种、卖家、配送地、字段证据和缺失原因。”这个工具只需一个 URL，服务固定使用已复核的商品 Schema，不调用外部模型。实际结果中，页面抓取 `status: success` 与商品 JSON 的 `json.status: complete` 是两项不同检查；价格不在页面可见时返回 `null`，`json.issues` 说明无已验证来源。先确认选中主体 ASIN 与请求 ASIN 相同，以及配送地为 Singapore、可见报价币种为 SGD。

多个已知商品 URL 可让 Codex 调用 `batch_products({"urls":[...]})`。它立即返回 `taskId`；通过 `get_batch`／`wait_batch` 查进度，再用 `get_batch_items` 分页取结果。每项都有状态、失败原因和 usage 计时。首轮最多 1000 个**不同** ASIN；批次持久化，客户端断开不会取消，`cancel_batch` 才显式取消。不要把 1000 页可靠性门槛当作已通过；[预先锁定的验收标准](roadmap/dual-flow-mvp-gates.md)仍待最终托管路径实测。

## 永久远程地址就绪后

用户只需连接实际发布的 HTTPS URL 并完成浏览器登录，无需克隆仓库或启动 worker：

```bash
codex mcp add w2l --url https://ACTUAL-MCP-DOMAIN/mcp
```

`ACTUAL-MCP-DOMAIN` 必须替换为部署后实测的地址；目前没有可交付的实际域名。远程服务只允许公开文档来源 `docs.firecrawl.dev`／`modelcontextprotocol.io`、Amazon.sg `/dp/{ASIN}` 和已批准的 HTTPS 接收端。远程用户不可上传登录态、任意 Schema、模型提示或任意目标 URL。连接、一次任务完成、投递事件和断线／重启后的持续监控会分别验收。首发不承诺 Amazon 价格提醒、其他商城、验证码突破或多租户托管。
