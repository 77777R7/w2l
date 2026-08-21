# 第三竞争力「内容提取精准度」深度研究归档

- 日期：2026-08-20
- 方法：deep-research 工作流 ×3（5 搜索角度 → 源抓取 → 可证伪声明提取 → 3 票对抗验证（≥2 票否决即杀）→ 综合）
- 总规模：255 个子代理，确认 42 条声明，否决 24 条
- 触发问题：Firecrawl 等竞品在提取精准度上有什么可借鉴/可优化，且不触发许可限制

## 一、结论速览

| # | 结论 | 置信度 |
|---|------|--------|
| 1 | Markdown 转换必须发生在主内容提取**之后**；HTML→MD 裸转换当提取器用，F1 仅 0.15–0.18 | 确认 |
| 2 | 规则类提取器里 trafilatura 精度最高（自有语料均值 F1 0.924；Zyte 语料 0.958 vs Readability 0.947），且 v2.2.0 起是 **Apache-2.0**（jusText BSD-2-Clause），无 copyleft 风险 | 确认 |
| 3 | Readability 提取略多但更噪（Zyte 上 precision 0.914 vs 0.938；严格精确匹配 0.166 vs 0.293）；WCXB 13 个提取器中排第 12（F1 0.674 dev / 0.736 test），785 ms/页 | 确认 |
| 4 | Readability 已知失效模式：开放 Shadow DOM 返回 null（#926）、多内容页选错文章块（#473）、isProbablyReaderable 自称不可靠 | 确认 |
| 5 | **没有任何中立方的端到端全管线对比**。所有找到的定量对比都是参赛者写的、且赢家都是作者自己。Firecrawl 的 scrape-evals 仓库已 404，流传的榜单数字没有活的主源 | 确认 |
| 6 | 全部公开 benchmark 都是新闻类 + JS 禁用快照。**JS 渲染页面的提取 F1 在文献里是零测量** → W2L 自建 30-fixture 基准本身就是差异化 | 确认 |
| 7 | 表转换：unified 栈（rehype-parse → rehype-remark → remark-gfm → remark-stringify，全 MIT）是唯一复现出 colspan+rowspan 几何都正确的 Node 转换器 | 复现（中） |
| 8 | Firecrawl 钉死的两个 GFM 插件都是死路：官方 turndown-plugin-gfm 自 2018 无发布且表格失败是**类别性**的（无 thead 首行 → 整表原样 HTML 输出；空表抛异常；单元格内 ul 破坏管道行；colspan 使后续列左移一位）；joplin 版 1.0.12 的 off-by-one 静默丢掉全部列对齐 6 年 | 确认 2-0 |
| 9 | @joplin/turndown-plugin-gfm 1.0.67 在预渲染 DOM 下**不是**二次复杂度（10240 单元格 ~422 ms）；二次复杂度只出现在传 HTML 字符串时落到自带 domino 的活 HTMLCollection 索引 | 否决 0-3 |
| 10 | LLM/神经提取：文章场景"规则类胜出"被否——对第三方 trafilatura 0.924，MinerU-HTML 0.928 反而领先；**稳健的说法是"规则类在文章上与神经持平，成本低 20–50 倍"**。所有美元数字都被否 | 结构稳健 |
| 11 | 许可雷区（逐字验证）：crawl4ai 声称 Apache-2.0 但完整 vendored GPL-3.0-or-later html2text、零 GPL 声明、且带强制署名条款；MinerU-HTML v1.1 是腾讯 Hunyuan 社区许可（欧盟/英国/韩国被排除，§5(c) 领地外输出"未授权"），HF 仓库无任何 SPDX 可见字段，默认模型硬编码静默拉取；ReaderLM-v2 免费权重 CC-BY-NC-4.0 | 确认 |
| 12 | 渲染期噪音：@ghostery/adblocker 2.18.2（MPL-2.0）暴露原始选择器与 remove/remove-attr/remove-class（可 DETACH 节点而非仅 display:none）；EasyList Cookie List 双许可矛盾未解（CC BY 3.0 vs GPLv3-OR-CC-BY-SA-3.0，同一 27880 条规则）；约 92% 的 Cookie List 价值在化妆品层（23013/25112 条）而非网络层 | 机制级复现（中） |
| 13 | "拦截请求禁用浏览器缓存"过时 5 年：Puppeteer v10.0.0（2021-06）删除该耦合。Playwright route() 的缓存/吞吐影响**无人测量** | 确认 |
| 14 | CMP 处理是 W2L 自己必须建的层：trafilatura 的 consent 词表极薄（仅 'cookie'/'consent'/'modal-content'/'permission'，区分大小写，复现确认 20 个真实 CMP 根 div 中 15 个幸存）；Readability 无 cookie/consent 词；@postlight/parser 39 个黑名单词也无 | 复现（中） |

## 二、推荐管线（10 步）

1. **许可闸门（CI）**：允许 MIT/Apache-2.0/BSD-2/BSD-3/ISC/MPL-2.0；禁止 crawl4ai、Python html2text、Firecrawl scraper、nodesig、GPL-3.0-only 过滤列表数据。阅读材料禁令写入 CONTRIBUTING.md（crawl4ai 的 markdown 路径不可移植——GPL 血统未披露，任何移植都有衍生作品争议）。
2. **抓取**：undici ^7.4（已有）。
3. **网络层噪音（仅浏览器 lane）**：@ghostery/adblocker/playwright 2.18.2（MPL-2.0）走 page.route；列表运行时下载、永不编译进产物/MIT SDK；选 EasyList 双许可的 CC BY-SA 3.0 分支，构建时校验 `! License:` 头。预期管理：Cookie List 25112 条规则中仅 ~2100（8.4%）是网络规则。
4. **单一 DOM 构建**：默认 jsdom（本轮全部复现都在 jsdom 上验证）；cheerio 只做廉价选择器，绝不当提取器/转换器看到的 DOM。**待测**：jsdom vs linkedom vs happy-dom（1 天）。
5. **化妆品/CMP 剪枝（提取前）**：用 Ghostery 的原始选择器 DETACH 而非 display:none（隐藏节点仍会喂给提取器）；自建 ~30 选择器 CMP 根列表 + 自写开放 Shadow DOM 遍历。浏览器 lane 优先在序列化前 evaluate @duckduckgo/autoconsent（MPL-2.0，331 条站点规则 + 14 个 CMP 厂商模块）。能力排名已修正：autoconsent 只处理开放 Shadow root 且拒绝 pierce/ 选择器；Consent-O-Matic 能穿透开放+封闭 root（许可证未定，阻塞未知项）。
6. **主内容提取（决定竞争力的一步，双轨）**：
   - 5a. v0 用 @mozilla/readability（Apache-2.0）包在 Extractor 接口后——只为解锁管线，不是答案（WCXB 第 12 名）。
   - 5b. 并行建 `packages/extract-tf`：trafilatura 的 precision/recall XPath 级联 TS 重实现。合法（Apache-2.0 确认 3-0）、且是独立作者里精度最高的规则提取器（文章子集 0.924，~97 ms/页）。
   - 5c. 页面类型路由（文章/列表/产品/论坛/集合）：headroom 在非文章页——已发表天花板 Product 0.670、Listing ~0.704-0.710、Collection 0.713 vs 文章 0.924，论坛页 27.4 分差距，约 47% 真实页面不是文章。
   - 5d. 提取器输出置信分 + `escalate` 标志，升级槽留空。LLM/神经模型不进默认路径（成本/延迟不对称 28–97 ms 单 CPU 核 vs 325–1570 ms A100，经得起所有否决）。
7. **后提取规范化（仍在 HTML 域）**：绝对化链接、srcset/data-src 解析、去跟踪参数、unwrap 单子包装、**表规范化**——colspan/rowspan 钳到真实行列数、防空表。必须在转换器之前做（复现过 112 字节 → 60,000,029 字节 3.3 s 的放大；`<table></table>` 在官方 GFM 插件里抛未捕获 TypeError）。
8. **Markdown 转换（提取之后）**：unified 栈（全 MIT）；turndown ^7.2.4 + @joplin/turndown-plugin-gfm 1.0.67 作第二基准臂（只用真实 DOM 节点）。硬禁 turndown-plugin-gfm@1.0.2 和 joplin-turndown-plugin-gfm@1.0.12。不规则表策略：默认 GFM + `<br>` 连接单元格块 + 管道转义；可选 HTML 直出（约 3-5 倍 token，arXiv 2305.13062 的"HTML 更优"是 GPT-3.5/4 时代且未复现）。
9. **输出组装**：front matter、tiktoken 计数、成本行、success/empty_legit/empty_suspicious 三分类。
10. **评估（第 1 周做，不是之后）**：fixtures 加 table 类目 14 形状 + CMP 类目 + 页面类型分层 + 大表墙钟 + colspan 放大（budget 助手已支持）；**阻塞前置**：GroundTruth 加精确 `expectedMarkdown` 或结构断言（mustContain 是子串检查，无法给列几何打分）。三个测量实验：DOM 烘焙赛、50 真实页 × {无拦截/网络拦截/网络+化妆品} × {冷/热缓存}、表格格式 × 目标模型。

## 三、已被否决的流行说法（勿再引用）

- puppeteer-extra-plugin-stealth 有效（全否）
- curl-impersonate 的 JA3/JA4 引用（捏造）；curl_cffi
- Crawlee 默认配置足够
- "Crawlee default 200 并发"类数字
- 规则类提取器在文章上胜过神经（否：持平，成本低 20-50 倍）
- "没有 JS 转换器能在单元格内保留块内容"（否：Joplin `<br>`、@guyplusplus 空格、html-to-md 内联 HTML 都行）
- "只有 DuckDuckGo autoconsent 能穿透 Shadow root"（否：反了——Consent-O-Matic 能穿开放+封闭，autoconsent 只能开放）
- "没有面向爬虫的 CMP 选择器列表"（否：autoconsent 331 条站点规则）
- "EasyList Cookie List 是 CC BY 3.0 仅署名"（否：双许可矛盾）
- "请求拦截禁用浏览器缓存"（过时 5 年）
- Crawl4AI 的 div 重包会毁结构（否：html2text 视 div 为透明）

## 四、许可地图（本产品可链接/不可链接）

**可（MIT/Apache/BSD/MPL）**：trafilatura 2.2.0+（Apache-2.0）、jusText（BSD-2）、Mozilla Readability（Apache-2.0）、rehype/remark 全家（MIT）、turndown（MIT）、@joplin/turndown-plugin-gfm（MIT）、resiliparse（Apache-2.0）、Docling/MarkItDown（MIT）、dom_smoothie（MIT）、rs-trafilatura（MIT OR Apache-2.0）、jsdom/linkedom/happy-dom、@ghostery/adblocker（MPL-2.0）、brave/adblock-rust（MPL-2.0）、@duckduckgo/autoconsent（MPL-2.0）、WebMainBench 数据集（Apache-2.0）、WCXB Zenodo 数据集（CC-BY-4.0）、zstanjj/HTML-Pruner-Phi-3.8B（Apache-2.0）。

**不可（GPL 血统/AGPL/NC）**：crawl4ai（vendored GPL html2text，零声明 + 强制署名）、Python html2text、Firecrawl scraper 根（AGPL-3.0）、nodesig（AGPL-3.0）、CycleTLS（GPL-3.0）、MinerU-HTML v1.1（腾讯 Hunyuan 社区许可）、ReaderLM-v2 免费权重（CC-BY-NC-4.0）、uAssets/IDCAC/ISDCAC 数据（GPL-3.0-only）。

**可基准对比、不可链接**：自托管 Firecrawl、Crawl4AI、Firecrawl Cloud（发布对比 benchmark 前查其 ToS）。

## 五、仍未解决（阻塞项/待测）

1. 中立方四路全管线对比不存在——**出版第一个中立对比本身就是差异化**
2. JS 渲染页提取 F1 无任何已发表测量——只能自己测
3. 化妆品剪枝的实际精度收益无测量——只能自己测（实验 10b）
4. Playwright route() 的缓存/吞吐代价无人测过
5. EasyList 双许可矛盾需法务 + 构建时头校验（CC BY 3.0 vs CC BY-SA 3.0 一字之差）
6. Consent-O-Matic 许可证未定（唯一能穿封闭 shadow root 的）
7. 所有表/提取器复现只在 jsdom 上——linkedom/happy-dom 待测
8. rs-trafilatura 的 0.966 ScrapingHub F1 是 WCXB 作者自报（且 dev 集调过参），无第三方复现，无 WASM 构建
9. HTML vs Markdown 复杂表在现役模型上的真实差距（2305.13062 未复现）
10. colspan 放大与 domino 二次复杂度需在自己的 harness 上复现后再引用
