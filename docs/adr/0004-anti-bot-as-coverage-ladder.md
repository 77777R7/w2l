# ADR 0004：反爬是覆盖阶梯，不是自研破墙引擎

- 状态：已接受
- 日期：2026-09-18
- 前置：[0001-direct-playwright.md](0001-direct-playwright.md)、PHASE1 §2.5、`research/anti_bot_redesign_2026-09-18.md`

## 背景

产品方向收窄为 Firecrawl 同类树根：URL → 动态页 → 干净 Markdown/JSON，服务开发者与 AI 创业者。用户判断「没有反爬能力就失去意义」。

2026-09-18 用 ego-browser 核过 arXiv 原文，并对照 Firecrawl / Crawl4AI 官方文档。结论与 8 月深研一致，且被更新论文加强：硬门打不穿、JS stealth 会增加可检测性、行为拟人连真人轨迹回放也没用。

## 决定

把「反爬」定义为 **coverage ladder + 身份自洽 + 失败分类 + 可插拔出口**，作为 Phase 1 一等能力。不把「绕过 Cloudflare / DataDome / Kasada Enterprise」写成卖点，也不在仓库内实现 circumvention 引擎。

```
L0  诚实身份     UA ≡ Client Hints ≡ locale ≡ timezone ≡ viewport ≡ screen
L1  HTTP         undici（默认）+ 可选 TLS impersonate 适配器（默认关、trace 标明）
L2  真浏览器     默认 headed Playwright；门分类后升级，不默认 stealth 插件
L3  粘性身份     用户 BYO sticky 住宅出口 + 同一 cookie jar；禁止透明换身份重试
L4  厂商解锁     Browserbase / Steel / Unlocker，用户密钥、预算封顶、能力白名单
停止            分类上报（bot_gate / captcha / login_wall）+ 用户登录态 / 人工接管
```

每一跳的原因、成本、是否改善结果都落库。挑战页不得记为 success。

## 论文把什么判死了

| 做法 | 证据 | 产品结论 |
| --- | --- | --- |
| JS stealth / 改 navigator | arXiv:2606.30119：stealth **增加**可检测性 | 禁止默认开启 |
| 伪造不一致指纹 | IMC 2025 FP-Inconsistent：逃过的 bot 字段互相矛盾 | 自相矛盾的身份 fail-closed |
| 鼠标 GAN / 回放真人轨迹 | arXiv:2607.26935：两个事件流特征 100% 召回 agent，含回放 | 不做人形轨迹 |
| TLS 伪装单独过 CF | curl-cffi FAQ；Cloudflare JA4 Signals 看跨请求分布 | impersonate 只做 L1 适配器 |
| 自研 CAPTCHA / CDP patch / 浏览器 fork | Halligan 60–70% 但 §1201；Camoufox 维护者 2026 自认不稳 | 永不进主仓 |
| Firecrawl 自托管含 fire-engine | 官方 self-host：advanced anti-bot **not included** | 对方无法把破墙开源；我们卖可见阶梯 |

## 自研 / 适配器 / 永不做

**自研：** 阶梯、门分类、身份捆、extract-tf → Markdown、成本与假成功率、robots/合规记录。

**适配器：** TLS impersonate、sticky proxy、云浏览器、unlocker。官方只承诺测过的组合。

**永不做：** captcha_solving、cdp_patching、fingerprint_spoofing、identity_rotation、Chromium/Firefox fork、移动 API 逆向。这些已在 `REFUSED_CAPABILITIES`。

## L3：换 IP ≠ 换身份

BYO proxy、inherited `storageState`、厂商 session resume 只换路（出口 / cookie jar），不换脸。UA、Client Hints、locale、timezone、viewport 与无代理时逐字节相同。把 timezone 改成代理出口的 geo 是指纹伪造，fail-closed。禁止按请求轮换身份。

## 对外可以说 / 不可以说

可以说：软门必过；动态页走真浏览器；硬门分类并升级到用户出口/登录态/厂商；自托管 L0–L2 完整，没有阉割版。

不可以说：我们解决反爬、96% 的网站、稳定过 Cloudflare Enterprise。

## 后果

- Phase 1 验收增加：身份捆自洽测试；提取后的 Markdown 是默认输出，不再把 HTML 当 markdown。
- L3/L4 继续走现有 `AccessConfig` / vendor policy，不新建破墙包。
- 细分垂直（SEO/电商）仍等树根 `scrape` 主路径可跑之后再选。
