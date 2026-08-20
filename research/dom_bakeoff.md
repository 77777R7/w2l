# DOM 烘焙赛：jsdom vs linkedom vs happy-dom

- 日期：2026-08-20
- 状态：计划完成，结果见文末
- 前置：C.1–C.3（表结构断言 + golden-converter）已就绪
- 目的：extract-tf（trafilatura XPath 级联的 TS 重实现）动工前，确定 parse 层唯一 DOM 实现。**正确性与 extract-tf 兼容性是硬门槛；性能（冷/热、内存）第二优先级。**

## 一、待测维度 → 测法映射

| # | 维度 | 测法 |
|---|------|------|
| 1 | Fixture 结构正确性 | G1/G2 + CJK 检查 |
| 2 | 表格结构保持 | G3 + 网格遍历正确性 |
| 3 | 畸形 HTML 行为 | G2 + W2 计时 |
| 4 | 查询/修改/序列化 | G4 选择器电池 + G5 往返保真 + W5/W6/W9 |
| 5 | XPath 级联兼容 | G6 原生 evaluate 探测 + 微级联（extract-tf 访问模式）W10 |
| 6 | 冷/热 p50/p95 | cold 模式（3 次）+ perf 模式逐 workload 计时 |
| 7 | 峰值内存 | stress 模式 maxRSS |
| 8 | 大表/恶意 colspan 资源上限 | W4/W8/W11 + 钳制正确性 |

## 二、硬门槛（一票否决，全部基于真实 fixture HTML）

- **G1 结构正确性**（static-article）：正文事实字符串出现在 `documentElement.textContent`；`article` 恰 1 个；article 内 `<p>` 恰 11 个；h1 文本精确匹配。
- **G2 畸形 HTML**（static-malformed，未闭合标签）：不抛异常；事实字符串存在；恢复出的 `<p>` ≥ 3；`ul li` ≥ 2。
- **G3 表格结构**（static-table）：`table` 恰 1 个；`rows.length === 4`；行 0 有 3 个 cell；cell [1][0] 文本 `Meridian`；cell [3][2] 文本 `1873-04-05`。span 属性保真：colspan 夹具的 th 读回 `3`，amplification 夹具的 td 读回 `10000`。
- **G5 序列化往返保真**（static-table）：parse → serialize → parse 后，行数仍 4、cell [1][0] 仍 `Meridian`、事实字符串仍在。
- **CJK**（static-cjk）：正文 CJK 事实字符串在 textContent 中（编码路径）。

## 三、能力探测（数据项，不否决）

- **G4 选择器电池**（static-article 全文档）：`article`、`article h1`、`article > p`、`h2 + p`、`p:nth-of-type(2)`、`a[href^="/"]`、`aside ul li a`、`article :not(p)`、`li:first-child`、`h1:has(+ p)`。前九个按最小命中数判定；`:has()` 单独记录（jsdom/nwsapi 预期不支持——extract-tf 级联若依赖 `:has` 则需手动过滤替代，这是决策数据）。
- **G6 XPath**：`document.evaluate` 存在性探测；存在则跑 `//p` 计数。三库预期均无原生 XPath——若成立，级联将以 CSS + 手动过滤实现（与 C.3 微级联同构），本项只记录，不否决。

## 四、性能与资源 workload

| id | 操作 | 迭代 | 说明 |
|----|------|------|------|
| W1 | parse 小文档（static-article，~2KB） | 300 | 热路径 |
| W2 | parse 畸形文档 | 300 | |
| W3 | parse 长文档（static-long，~15KB） | 100 | |
| W4 | parse 大表（table-large，~16KB） | 30 | |
| W5 | 查询：长文档上 5 个选择器（`p`、`article > p`、`a[href]`、`p:nth-of-type(2n)`、`h1, h2`） | 各 300 | 单文档重复查询（生产形态：parse 一次、查询多次） |
| W6 | 序列化全文档（长文档） | 100 | |
| W7 | 网格遍历（大表 rows/cells 全走） | 200 | 正确性 = 单元格总数 1010 |
| W8 | span 钳制+展开（colspan=10000 行，cap=2×cell 数） | 200 | 正确性 = 宽度 ≤ 4 |
| W9 | detach 4 节点（cookie/nav/aside/footer）+ 验证 | 500 | CMP 剪枝形态 |
| W10 | 微级联（article → p → 文本过滤 → 链接收集） | 300 | extract-tf 访问模式代理 |
| W11 | parse 3MB 合成文档（stress 模式） | 3 | 资源上限 |

- 每个 workload 先 warmup 5 次再计时；计时用 `performance.now()`，逐次记录数组 → 驱动进程算 p50/p95。
- **冷启动**：独立子进程 ×3 次，`t0` 取 runner 首行（tsx 编译/启动成本排除），测 adapter 动态 import 耗时 + 首次 parse 小文档 + 首次 parse 长文档，取 3 次中位数。
- **内存**：stress 子进程跑 W4/W8/W11 后 `global.gc()` 再读 `process.resourceUsage().maxRSS`（进程峰值，含库自身缓存）。
- Node 以 `--expose-gc` 启动。

## 五、可比较性规则

- 同一台机器、同一 Node 版本、驱动进程**顺序**执行所有子进程（无 CPU 竞争）。
- 全部 workload 用同一批 fixture HTML（从 `@w2l/fixtures` 直接取 `respond()` 的 body，不经网络）。
- 每个库记录精确版本号；库的 API 差异（happy-dom 用 `Window` + `document.write`，linkedom 用 `parseHTML`，jsdom 用 `new JSDOM`）是模型固有差异，在 adapter 层隔离。
- 序列化统一走 `documentElement.outerHTML`，缺失则回退 `document.toString()`（记录回退情况）。

## 六、预期不可比项

1. **冷启动模型**：jsdom 是窗口模型（构造即建 Window），另两者是 parse 式 API——只比端到端冷时间，不比"加载后首次解析"的内部拆分。
2. **脚本执行/虚拟控制台**：三库能力不等价，本赛不测（fixture 的 inline script 一律不执行）。
3. **序列化字节一致性**：各库序列化器格式有差异（引号/属性顺序/doctype 处理），只做往返保真检查，不做字节相等。
4. **内存构成**：maxRSS 含各库自身缓存策略差异（如 jsdom 的 window 对象池），按"同 workload 峰值"横向比，不拆成因。

## 七、环境与版本约束（重要发现）

- **jsdom@30 要求 Node ≥22.22**（undici ^8.9.0 要求 ≥22.19）；W2L 的 engines 是 `>=20.11`，本机 Node 20.19.5。烘焙赛用 **jsdom@29.1.0**（engines `^20.19 || ^22.13 || >=24`，undici ^7.25.0）——若 W2L 选 jsdom，Node 20 环境必须锁 `jsdom@^29`，不能装 latest。
- linkedom 0.18.13（依赖 htmlparser2/css-select，轻量）；happy-dom 20.11.6（无 DOM 解析器依赖，自带引擎）。

## 八、结果

测量：Node 20.19.5，macOS，逐 workload 独立子进程（顺序执行无 CPU 竞争），每库精确版本：jsdom 29.1.0（30.0.1 需 Node ≥22.22，见 §七）、linkedom 0.18.13、happy-dom 20.11.6。

### 门禁（硬门槛，全部通过）

| 门禁 | jsdom | linkedom | happy-dom |
|---|---|---|---|
| G1 结构（13 `<p>`、h1、双事实） | ✅ | ✅ | ✅ |
| G2 畸形（修复后的夹具） | ✅ | ✅ | ✅ |
| G3 表格（4 行 3 列、Meridian、1873-04-05） | ✅ | ✅ | ✅ |
| G3b span 属性保真（3 / 10000） | ✅ | ✅ | ✅ |
| G5 序列化往返 | ✅ | ✅ | ✅ |
| CJK | ✅ | ✅ | ✅ |

### 能力探测

- 9 选择器电池（含 `>`、`+`、`nth-of-type`、`:not`、属性选择器）：三库全过。
- `:has()`：三库全支持（各返回 1 个匹配）——jsdom 29 经 @asamuzakjp/dom-selector；extract-tf 可依赖 `:has`（复杂嵌套仍建议自带测试）。
- **原生 XPath（`document.evaluate`）：三库全无**。extract-tf 的"XPath 级联"必须以 CSS 选择器 + 手动过滤实现——这是设计输入，不是否决项。

### 热性能（p50/p95，ms；n=样本数）

| workload | jsdom | linkedom | happy-dom |
|---|---|---|---|
| W1 parse 小文档（2KB，n=300） | 3.64 / 6.33 | **0.16 / 0.60** | 0.72 / 2.13 |
| W2 parse 畸形（n=300） | 2.68 / 4.84 | **0.12 / 0.29** | 0.58 / 1.74 |
| W3 parse 长文档（15KB，n=100） | 6.97 / 10.83 | **0.29 / 1.42** | 1.12 / 3.37 |
| W4 parse 大表（16KB，n=30） | 12.34 / 18.18 | **1.10 / 6.16** | 6.18 / 9.76 |
| W5 查询（5 选择器，n=300） | 0.00–0.04 | 0.01–0.23 | 0.00 |
| W6 序列化长文档（n=100） | 7.37 / 10.44 | **0.34 / 1.44** | 1.14 / 3.12 |
| W7 网格遍历 1010 单元格（n=200） | 13.69 / 17.37 | **1.08 / 5.34** | 7.81 / 15.31 |
| W8 span 钳制（n=200） | 3.54 / 6.01 | **0.16 / 0.54** | 0.74 / 2.16 |
| W9 detach 4 节点（n=500） | 4.17 / 6.40 | **0.17 / 0.44** | 0.76 / 2.07 |
| W10 微级联（n=300） | 4.21 / 6.46 | **0.20 / 0.57** | 0.81 / 2.23 |

linkedom 热路径全面领先：parse 约 12–23× 快于 jsdom、约 4–6× 快于 happy-dom；序列化 21× 快于 jsdom。

### 冷启动（3 次中位数，ms）

| | jsdom | linkedom | happy-dom |
|---|---|---|---|
| import | 275.3 | **57.9** | 142.1 |
| 首次 parse 小文档 | 40.0 | **2.2** | 6.4 |
| 首次 parse 长文档 | 12.6 | **1.3** | 2.0 |

### 内存（stress：大表 + colspan=10000 钳制 + 3MB 合成文档，maxRSS）

| | jsdom | linkedom | happy-dom |
|---|---|---|---|
| 峰值 | 332 MB | **138 MB** | 418 MB |

注意：happy-dom 常被宣传"轻量"，但在 3MB 文档压力下它最重（418 MB）；linkedom 138 MB 最低。正确性值三库一致（cellTotal=1010、ampCap=4、bigP=40000）。

## 九、推荐与决策

**推荐 linkedom（ISC，许可白名单内）作为 W2L parse 层唯一 DOM 实现。**

决策理由：

1. **正确性是硬门槛，三库全过**——本赛全部门禁基于真实 fixture HTML（含畸形、表格、span 保真、往返、CJK），三库无差异。正确性不构成排除理由。
2. **性能是第二优先级，linkedom 全面显著领先**：热 parse 12–23× 快于 jsdom；冷启动 import 57.9ms vs 275.3ms（W2L 的短生命周期 worker 形态对冷启动敏感）；峰值内存 138MB vs 332/418MB。
3. **extract-tf 兼容**：`:has()` 三库都支持；原生 XPath 三库都没有——extract-tf 的级联以 CSS+手动过滤实现是既定设计（C.3 的 micro-cascade 已验证该形态）。linkedom 的 `parseHTML` → `document` 模型与 jsdom 的窗口模型都够用，adapter 层已隔离。
4. **唯一重要约束**：若未来 W2L 需要严格 WHATWG 畸形恢复（浏览器一致性），jsdom 29 是最保守选择；linkedom 的 htmlparser2 恢复与浏览器在极端畸形上可能有差异（本赛夹具范围内无差异）。extract-tf 上线前用一个"真实世界畸形 HTML"回归套件（从线上抓取样本）对 linkedom 复测一次即可对冲此风险。
5. jsdom 保留为**回归对照**（正确性分歧时的仲裁者），不进热路径。

## 十、原始数据

逐样本 JSONL：`tmp/dom-bakeoff/out/results.jsonl`（48 行：gates/cap/perf/stress/cold × 3 库）。分析脚本 `tmp/dom-bakeoff/analyze.ts`。测量台 `tmp/dom-bakeoff/{harness,worker,run,analyze}.ts` 随研究保留（tmp/ 不入库，见 .gitignore）。

## 十一、不可比项与局限

1. **jsdom 版本不对称**：本机 Node 20 无法运行 jsdom@30（latest），比较的是 jsdom@29.1.0 对最新 linkedom/happy-dom。jsdom 30 的性能未测。
2. **happy-dom 解析偏差**：初始 malformed 夹具（`<title>` 未闭合）下，happy-dom 恢复出 3 个 `<p>` 而 jsdom/linkedom 按 RCDATA 规范吞掉文档——happy-dom 的畸形恢复与 WHATWG 有可观察偏差。夹具已改为闭合 title 的真实形态，但该偏差提示 happy-dom 在极端畸形输入上有额外风险。
3. **W5 查询类**在三库均亚毫秒，区分度低（趋势与整体一致，linkedom 仍最优）。
4. **内存构成**未拆分（各库缓存策略差异）；maxRSS 为进程峰值。
5. **脚本执行/虚拟控制台/网络**不在本赛范围（三库能力不等价，fixture 的 inline script 一律不执行）。
