#!/usr/bin/env python3
"""Generate the execution-first rewrite of the crawler opportunity report."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Flowable,
    NextPageTemplate,
    PageBreak,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

from generate_report import (
    AMBER,
    BLUE,
    CYAN,
    GREEN,
    INK,
    LIGHT,
    LINE,
    MARGIN_BOTTOM,
    MARGIN_TOP,
    MARGIN_X,
    MUTED,
    NAVY,
    PAGE_H,
    PAGE_W,
    PURPLE,
    RED,
    WHITE,
    P,
    ReportDocTemplate,
    Source,
    build_styles,
    bullet,
    callout,
    load_sources,
    register_fonts,
    source_ref,
    styled_table,
)


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output" / "pdf" / "AI爬虫与增长自动化SaaS创业机会_执行导向重写版.pdf"


class V2DocTemplate(ReportDocTemplate):
    """Keep the original pagination/TOC machinery with the revised running title."""

    def _body_page(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN_X, PAGE_H - 12 * mm, PAGE_W - MARGIN_X, PAGE_H - 12 * mm)
        canvas.setFont("CJK", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_X, PAGE_H - 9.5 * mm, "AI 爬虫与增长自动化 SaaS · 执行导向重写版")
        canvas.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 9.5 * mm, "2026-08-17")
        canvas.line(MARGIN_X, 11 * mm, PAGE_W - MARGIN_X, 11 * mm)
        canvas.drawString(MARGIN_X, 7 * mm, "40 个来源 · 创业者视角 · 风险作为产品输入")
        canvas.drawRightString(PAGE_W - MARGIN_X, 7 * mm, str(doc.page))
        canvas.restoreState()


class EngineDiagram(Flowable):
    def __init__(self):
        super().__init__()
        self.width = 174 * mm
        self.height = 54 * mm

    def draw(self):
        c = self.canv
        boxes = [
            ("目标源", "Reddit / X\nGitHub / 目录站", BLUE),
            ("可靠运行时", "Session / Proxy\nRetry / Resume", RED),
            ("证据与状态", "Markdown / JSONL\n截图 / Source ID", PURPLE),
            ("增长行动", "Pain Report\nSEO / Submission", GREEN),
        ]
        x = 0
        box_w = 37 * mm
        gap = 8 * mm
        for i, (title, body, color) in enumerate(boxes):
            c.setFillColor(colors.Color(color.red, color.green, color.blue, alpha=0.10))
            c.setStrokeColor(color)
            c.roundRect(x, 10 * mm, box_w, 32 * mm, 3 * mm, stroke=1, fill=1)
            c.setFillColor(color)
            c.setFont("CJK-Bold", 9)
            c.drawCentredString(x + box_w / 2, 32 * mm, title)
            c.setFillColor(INK)
            c.setFont("CJK", 7.3)
            for j, line in enumerate(body.split("\n")):
                c.drawCentredString(x + box_w / 2, (24 - 6 * j) * mm, line)
            if i < len(boxes) - 1:
                ax = x + box_w + 1.5 * mm
                c.setStrokeColor(MUTED)
                c.line(ax, 26 * mm, ax + 5 * mm, 26 * mm)
                c.line(ax + 5 * mm, 26 * mm, ax + 3 * mm, 27.5 * mm)
                c.line(ax + 5 * mm, 26 * mm, ax + 3 * mm, 24.5 * mm)
            x += box_w + gap


def metric_cards(styles):
    items = [
        ("总判断", "强 GO", GREEN),
        ("开源楔子", "Pain Miner", BLUE),
        ("自用验证", "Backlink Ops", CYAN),
        ("长期壁垒", "可靠执行", RED),
    ]
    cells = []
    for title, value, color in items:
        cells.append(P(f'<font color="{color.hexval()}"><b>{title}</b></font><br/><font size="11"><b>{value}</b></font>', styles, "BodySmall"))
    table = Table([cells], colWidths=[42.5 * mm] * 4)
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
    ]))
    return table


def build_story(sources: list[Source], source_map: dict[str, Source], styles):
    story = []
    refs = lambda *ids: source_ref(list(ids), source_map)

    # Cover
    story += [
        P("FOUNDER-FIRST DEEP VALIDATION · REWRITE", styles, "CoverKicker"),
        P("AI 爬虫与增长自动化 SaaS<br/>创业机会深度验证", styles, "CoverTitle"),
        P("以你的原始构想为前提：开源优先、垂直爬虫切入、解决反爬与上下文爆炸，再把数据转成 SEO 和增长行动", styles, "CoverSub"),
        P("执行导向重写版 · 为 Howard 制作<br/>研究日期：2026 年 8 月 17 日<br/>证据集：40 个 Firecrawl、GitHub Issues、Reddit、X、竞品与平台页面", styles, "CoverMeta"),
        NextPageTemplate("body"),
        PageBreak(),
    ]

    story += [P("目录", styles, "H1")]
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(fontName="CJK-Bold", name="TOC1V2", fontSize=9.5, leading=15, textColor=INK, leftIndent=0, firstLineIndent=0, spaceBefore=2 * mm),
        ParagraphStyle(fontName="CJK", name="TOC2V2", fontSize=8, leading=12, textColor=MUTED, leftIndent=5 * mm, firstLineIndent=0),
    ]
    story += [toc, Spacer(1, 5 * mm), callout("这份报告不再讨论“是否允许这个 idea 存在”，而是回答：怎样把它做成一个有竞争力、能开源增长、最终能收费的产品。平台波动、反爬和 CAPTCHA 被视为产品约束与工程输入，而不是否决票。", styles, CYAN), PageBreak()]

    # Executive summary
    story += [P("0. 执行摘要", styles, "H1"), metric_cards(styles), Spacer(1, 4 * mm)]
    story += [
        callout("最终判断：强 GO。你的方向不是“复制一个缩小版 Firecrawl”，而是做一个面向独立开发者的开源增长数据引擎：既能从难抓的平台持续取得可恢复、可追溯的数据，也能把原始数据压缩成 Markdown 证据、痛点结论和下一步增长动作。", styles, GREEN),
        P("Firecrawl 已经验证了网页数据进入 AI 工作流的巨大需求。其官网在本次研究时展示约 168.4K GitHub stars、1.25M 开发者、150K+ 公司和 5B+ 请求；官方披露它从 Mendable 内部反复遇到的网页摄取问题出发，三个月达到 8K+ stars，随后通过模板、集成、社区、DevRel 和托管服务放大增长。" + refs("S01", "S03", "S04", "S05"), styles),
        P("用户证据同样支持你的切入点：Amazon 用户抱怨连续请求 30–50 次就被封、抓 300 个商品要约 3 小时；X 开源工具用户持续遇到 403、限流、账号锁定和登录问题；Reddit 用户遇到 429 与分页边界；Firecrawl 自托管用户则遇到 hosted 能出 Markdown、self-host 却返回空内容。" + refs("S07", "S08", "S09", "S10", "S12", "S14", "S16", "S17"), styles),
        P("这不是“别做”的证据，恰恰是用户采用开源工具的原因：Browser Use 在成功路径上很好用，但缺少跨任务持久状态、失败分类、代理/会话策略、断点续跑、站点配方和人工接管。你要卖的不是一次点击，而是<b>任务完成率</b>。", styles),
        P("推荐双楔子：公开发布 <b>Pain Miner</b>（Reddit/X/GitHub Issues → 去重证据 → Markdown 痛点报告），同时用 <b>Backlink Ops</b> 作为创始人自用的压力测试（知识库预填 → 目录站配方 → 重试/恢复 → 截图证据 → 必要时人工接管）。两者共享同一套可靠执行引擎。", styles),
    ]
    story += [P("新版报告接受的四个前提", styles, "H2")]
    for item in [
        "前期开源优先：用 GitHub 分发、透明 benchmark、可复制 recipes 和 self-hosting 建立信任与流量。",
        "前期可以进入难站点：反爬、登录、CAPTCHA、账号与代理不是范围外问题，而是成功率工程的一部分。",
        "垂直工作流优先于通用 API：先把“痛点研究”或“外链提交”做到可完成，再扩成平台。",
        "付费卖托管可靠性与持续工作流：云浏览器、调度、代理、团队、历史、可视化、托管 recipes 和执行 credits。",
    ]:
        story.append(bullet(item, styles))
    story += [PageBreak()]

    # Evidence/method
    story += [P("1. 研究口径：风险不再充当否决票", styles, "H1")]
    story += [
        P("本版复用上一轮通过 Chrome 收集的 40 个页面：Firecrawl 官方材料、GitHub 仓库与 Issues、Reddit/X 讨论、Amazon 抓取经验、竞品定价和平台规范。分析逻辑从“合规优先筛选赛道”改为“创业者如何把真实阻力变成产品能力”。社区样本用于识别重复失败模式，不被当作市场发生率。", styles),
        P("研究合同", styles, "H2"),
    ]
    contract = [
        ["我们要验证什么", "完成标准"],
        ["痛点是否真实", "同一故障在多个独立来源重复出现，并能映射到具体产品能力"],
        ["是否有开源增长路径", "存在可演示输入/输出、可复现 benchmark、可贡献 recipes"],
        ["是否能收费", "免费本地执行与付费托管可靠性之间有清晰价值分层"],
        ["是否有竞争力", "不是单纯“能爬”，而是更高任务完成率、更少模型上下文、更快失败恢复"],
        ["哪些因素只是风险", "平台变化、成本和账号问题进入架构与运营清单，不直接推翻方向"],
    ]
    story += [styled_table(contract, [58 * mm, 116 * mm], styles)]
    story += [P("证据边界", styles, "H2")]
    for item in [
        "GitHub Issues 和社区帖子天然偏负面，但正适合发现维护成本、失败点和未满足需求。",
        "本次没有新增 Chrome 抓取：当前 Chrome 通道不可用；因此严格复用已保存的 40 个 Chrome 来源和证据台账，没有切换浏览通道补数。",
        "报告不会提供 CAPTCHA 破解、账号规避或对抗性绕过操作手册；产品层面仍把 CAPTCHA 检测、人工接管、状态恢复和供应商适配列为一等能力。",
        "最终 PMF 仍需通过真实安装、成功率、留存和付费实验确认；本文给的是进入建设的结论。",
    ]:
        story.append(bullet(item, styles))
    story += [PageBreak()]

    # Pain map
    story += [P("2. 痛点验证：用户买的不是爬虫，是“别再失败”", styles, "H1")]
    pain = [
        ["用户痛点", "证据表现", "应做成的能力", "商业价值"],
        ["上下文爆炸", "全量页面/帖子塞进 Browser Agent，token 与上下文迅速失控", "本地索引、分块、去重、证据 ID、按需回取、Markdown 摘要", "模型成本下降；报告可复核"],
        ["反爬与 CAPTCHA", "请求逐渐被拦、Cloudflare 403、连续任务后触发 CAPTCHA", "多运行通道、失败检测、供应商接口、人工接管、站点级成功率", "直接决定任务完成率"],
        ["登录与账号状态", "Amazon 登录流程缺失；X 账号锁定/封禁；IP 变化引发风险", "持久 profile、session vault、身份隔离、状态健康检查", "减少重复登录与任务中断"],
        ["限流与长任务", "Reddit 429；Amazon 300 商品需数小时；X 容易限流", "队列、预算、节流、checkpoint、断点续跑、增量抓取", "让任务从 demo 变成生产"],
        ["Markdown 不可靠", "self-host 返回空 Markdown，托管版却正常；部分内容静默缺失", "HTML fallback、覆盖率评分、字段校验、原文锚点", "降低 AI 错判"],
        ["自动化半途而废", "目录提交在 CAPTCHA、邮箱验证、未知字段处停止", "状态机、知识库预填、失败分类、截图、人工接管后继续", "直接替代重复人工时间"],
    ]
    story += [styled_table(pain, [33 * mm, 49 * mm, 57 * mm, 35 * mm], styles)]
    story += [P("2.1 Amazon：你的判断成立，规模化抓取首先卡在持续性", styles, "H2")]
    story += [
        P("一位用户描述约 300 个商品需要 3 小时，并在 30–50 次请求后被阻断；另一讨论显示低频抓取也会从偶发 CAPTCHA 发展到请求几乎全部命中 CAPTCHA。用户随后不得不处理浏览器、指纹、代理、验证码和会话预热。" + refs("S16", "S17"), styles),
        P("因此 Amazon 类型任务的 benchmark 不应只测单页解析，而要测：300 页任务的覆盖率、每百页人工介入次数、恢复后是否重复写入、每条数据成本和数据新鲜度。", styles, "Quote"),
    ]
    story += [P("2.2 X / Reddit：公开需求旺盛，失败也高度重复", styles, "H2")]
    story += [
        P("Twikit 与相关项目 Issue 反复出现 403、rate limit、登录失败、账号锁定和快速封禁；Reddit 的 PRAW 生态则有 429、分页与并发限制。用户甚至讨论账号轮换，说明“持续获得数据”本身就是未解决工作。" + refs("S10", "S11", "S12", "S13", "S14", "S15", "S19", "S21", "S22"), styles),
        P("产品启示不是回避这些源，而是把连接器做成可替换 adapter：官方 API、用户导入、浏览器会话和第三方数据都可进入同一证据 schema；运行时记录每条路径的成本、成功率与失败原因。", styles, "Quote"),
    ]
    story += [P("2.3 Firecrawl 自身的 Issue 证明：开源版可靠性就是付费缝隙", styles, "H2")]
    story += [
        P("用户要求 self-host proxy support，也有人反馈 hosted 可以返回 Markdown、self-host 却为空；另有用户询问如何登录 Amazon 后再抓取。它们共同揭示同一个付费结构：代码免费不等于任务成功，托管运行时、代理、浏览器和站点维护才是长期价值。" + refs("S06", "S07", "S08", "S09"), styles),
        callout("这正好支持你的商业化：开源获得安装和贡献，云端卖“成功运行”。免费与付费不是按功能随意切，而是按运维责任切。", styles, GREEN),
    ]
    story += [PageBreak()]

    # Product thesis
    story += [P("3. 产品战略：一个引擎，两个垂直配方", styles, "H1")]
    story += [
        EngineDiagram(),
        P("建议工作名：<b>GrowthCrawler</b>（名称待验证）。它不是一个网页转 Markdown endpoint，而是一个“可恢复的增长任务运行时”。输入目标站点和目标，运行时选择路径、保存状态、输出证据，再触发研究或增长行动。", styles),
        P("3.1 配方 A：Pain Miner — 公开开源楔子", styles, "H2"),
    ]
    for item in [
        "输入：关键词、竞品、repo、subreddit、X query、时间范围。",
        "获取：连接器负责 pagination、增量同步、限速、登录状态和失败恢复。",
        "压缩：本地先去重、聚类和抽样，模型只读取与结论有关的 evidence chunks。",
        "输出：pain-report.md、evidence.jsonl、opportunity.csv、seo-briefs.md；每个结论都带来源链接。",
        "开源传播：热门 repo / 细分行业的公开痛点报告天然可分享、可搜索、可复现。",
    ]:
        story.append(bullet(item, styles))
    story += [P("3.2 配方 B：Backlink Ops — 创始人自用压力测试", styles, "H2")]
    for item in [
        "输入：产品知识库、品牌资料、目标目录列表、提交优先级。",
        "执行：自动导航、资料预填、字段映射、表单状态识别、截图与提交记录。",
        "恢复：站点异常、登录、验证码、邮箱验证或人工判断进入明确的 handoff 状态；处理后从 checkpoint 继续。",
        "输出：成功、待人工、失败、需复查四种状态；每个站点保留截图、时间、表单字段和下一步。",
        "价值：你自己每周使用，强迫引擎面对最难的真实 browser workflow；这些能力反过来提升 Pain Miner 的可靠性。",
    ]:
        story.append(bullet(item, styles))
    story += [P("3.3 为什么不是两个分散产品", styles, "H2")]
    shared = [
        ["共享资产", "Pain Miner 如何使用", "Backlink Ops 如何使用"],
        ["连接器与站点 recipes", "抓帖子、评论、Issues、分页", "识别目录字段、步骤与成功页"],
        ["持久会话", "登录后继续收集", "保留账号、草稿与邮箱验证状态"],
        ["状态机与 checkpoint", "长任务增量运行", "在人工介入后恢复"],
        ["证据仓库", "原帖、引用、Markdown", "截图、提交记录、回链状态"],
        ["失败知识库", "限流/空内容/缺字段", "CAPTCHA/字段变化/验证失败"],
        ["托管运行时", "定时监控与周报", "批量队列与并发执行"],
    ]
    story += [styled_table(shared, [40 * mm, 67 * mm, 67 * mm], styles), PageBreak()]

    # Reliability stack
    story += [P("4. 反爬与自动化：把“失败”产品化", styles, "H1")]
    story += [
        callout("核心护城河不是某个一次性的绕过技巧，而是：任务遇到不同阻力时能升级执行路径、保存证据、控制成本、恢复进度，并把修复沉淀为 recipe。", styles, RED),
        P("4.1 分级运行时", styles, "H2"),
    ]
    ladder = [
        ["层级", "运行路径", "适用情况", "必须记录的指标"],
        ["L0", "HTTP / 官方 API / feed", "静态、公开、成本敏感源", "响应码、配额、覆盖率"],
        ["L1", "渲染浏览器", "JavaScript、动态加载、简单交互", "加载成功率、耗时、浏览器分钟"],
        ["L2", "持久用户会话", "登录、cookie、跨步骤任务", "session 健康、重新登录次数"],
        ["L3", "可插拔代理/数据供应商", "区域、频率、访问稳定性问题", "供应商成功率、每千页成本"],
        ["L4", "CAPTCHA/未知状态人工接管", "机器无法可靠继续的节点", "介入原因、耗时、恢复成功率"],
        ["L5", "站点专属 recipe 与 repair", "高价值、高频、DOM 经常变化", "版本、回归测试、修复时长"],
    ]
    story += [styled_table(ladder, [17 * mm, 44 * mm, 55 * mm, 58 * mm], styles)]
    story += [P("4.2 必须原生支持的可靠性组件", styles, "H2")]
    components = [
        ["组件", "第一版要求", "为什么构成竞争力"],
        ["Task state machine", "queued/running/waiting-human/succeeded/failed", "Browser Agent 不再因为一个未知页面整单停止"],
        ["Checkpoint + idempotency", "每页/每步落盘；重复运行不重复提交", "长任务可恢复，也更容易调试"],
        ["Artifact store", "HTML、Markdown、截图、响应与日志按 task 保存", "可以复盘静默缺失，而非只看最终摘要"],
        ["Recipe registry", "站点版本、字段映射、成功条件、回归样例", "贡献者能修站点；维护速度随社区增长"],
        ["Budget controller", "页数、browser minutes、模型 token、供应商成本上限", "避免默认路由烧 credits 的信任问题"],
        ["Success telemetry", "目标完成率、介入率、失败分类、修复时长", "从“能跑 demo”升级为可收费 SLA"],
    ]
    story += [styled_table(components, [37 * mm, 65 * mm, 72 * mm], styles)]
    story += [P("相关证据", styles, "H2")]
    story += [P("跨站点从业者把 blocking、代理成本、JavaScript、DOM 变化和长期维护列为 scraping 最难问题；Bright Data 和 Apify 已把代理、CAPTCHA 处理、浏览器与垂直数据商品化。你的选择不是从零重建整条供应链，而是做统一 adapter 和任务编排，把不同底层能力组合成稳定完成率。" + refs("S18", "S20", "S38", "S40"), styles), PageBreak()]

    # Competition
    story += [P("5. 竞品分析：你的空位在哪里", styles, "H1")]
    comp = [
        ["竞品", "它卖什么", "公开信号", "你不应硬碰的部分", "你的切入空位"],
        ["Firecrawl", "LLM-ready Web Context API", "约 168K stars；1.25M devs；credits", "通用 scrape/search/interact 与云基础设施", "特定增长任务的状态、证据与行动闭环"],
        ["Crawl4AI", "开源 Python crawler", "约 78.5K stars、8.1K forks", "本地网页抓取与 Markdown 基础能力", "跨站 recipes、长期任务和非技术用户工作流"],
        ["Apify", "Actor 市场与托管执行", "60K+ Actors；$29/$199/$999+", "Actor 供给、调度、代理市场", "统一证据 schema、跨 Actor 质量与增长结果"],
        ["Bright Data", "代理、解锁、浏览器与数据集", "20K+ customers；约 $1/1K 显示价", "全球代理与反阻断网络", "独立开发者友好的开源编排和垂直 UX"],
        ["GummySearch", "Reddit 研究与 audience insights", "$29/$59/$199；历史 140K+ 用户", "已经验证 Reddit 痛点研究需求", "多源、可自托管、证据可携带；持续运营替代单平台依赖"],
        ["Syften / F5Bot", "关键词监听与 alerts", "$9.99–$119.95/月；大规模提醒", "低价实时监听", "深度聚类、机会评分、SEO brief 与执行"],
        ["Browser Use 类工具", "通用浏览器 agent", "任务灵活、低门槛", "任意网页的一次性交互", "垂直 recipes、可恢复状态、批处理成功率"],
    ]
    story += [styled_table(comp, [24 * mm, 34 * mm, 38 * mm, 38 * mm, 40 * mm], styles)]
    story += [P("5.1 你的竞争力公式", styles, "H2")]
    story += [callout("竞争力 = 垂直任务完成率 × 失败恢复速度 × 证据质量 × recipe 覆盖 × 社区贡献速度 ÷ 单次成功成本", styles, BLUE)]
    for item in [
        "Firecrawl 强在网页到上下文；你强在目标到结果。",
        "Apify 强在 Actor 数量；你强在同一任务跨站的一致状态和可复核输出。",
        "Bright Data 强在底层网络；你把它和其他 provider 变成可替换供应链。",
        "GummySearch 已验证市场；你用多源、开源、本地数据所有权和 Growth Pack 扩大边界。",
        "通用 Browser Agent 强在灵活性；你用 recipes、checkpoint 和 benchmark 取得稳定性。",
    ]:
        story.append(bullet(item, styles))
    story += [P("5.2 开源 moat 不是代码，而是失败语料", styles, "H2")]
    story += [P("代码很容易被复制，持续积累的站点配方、回归样例、失败截图、DOM 变化记录、provider 成本和成功率更难复制。开源仓库应该允许贡献 recipes 与 fixtures；云端则汇总匿名 telemetry，用更快 repair 和更优路由反哺用户。", styles), PageBreak()]

    # Market validation
    story += [P("6. 市场验证：为什么值得现在做", styles, "H1")]
    validation = [
        ["命题", "证据", "结论"],
        ["AI 需要干净 Web Context", "Firecrawl 的规模与 93% token reduction 叙事；Crawl4AI 的开源采用", "需求已被充分教育，不必从零解释"],
        ["可靠性仍未解决", "proxy support、Amazon login、empty Markdown、403/429/账号锁定 Issues", "市场不是缺 crawler，而是缺可完成的 workflow"],
        ["社区痛点研究能收费", "GummySearch $29–$199；Syften 与 F5Bot 持续定价", "独立开发者/营销者有明确预算区间"],
        ["垂直 recipes 可分发", "Firecrawl 的模板/集成/DevRel；Apify 60K+ Actors", "模板本身可以成为增长与供给飞轮"],
        ["数据之后仍有增长缺口", "现有产品多停在 scrape、dataset 或 alert", "Pain → SEO → execution 是差异化层"],
    ]
    story += [styled_table(validation, [43 * mm, 79 * mm, 52 * mm], styles)]
    story += [P("6.1 机会评分（按新版前提）", styles, "H2")]
    score = [
        ["方向", "需求强度", "开源传播", "收费空间", "工程难度", "战略评分"],
        ["通用 Firecrawl 克隆", "5", "4", "5", "极高", "6.0 / 10"],
        ["单一 Amazon scraper", "5", "3", "4", "高", "6.8 / 10"],
        ["Pain Miner（多源）", "5", "5", "4", "中高", "8.7 / 10"],
        ["Backlink Ops", "4", "4", "4", "高", "7.8 / 10"],
        ["两配方共享可靠引擎", "5", "5", "5", "高", "9.0 / 10"],
    ]
    story += [styled_table(score, [55 * mm, 25 * mm, 26 * mm, 25 * mm, 23 * mm, 20 * mm], styles)]
    story += [P("6.2 最关键的待验证假设", styles, "H2")]
    assumptions = [
        ["假设", "最小实验", "通过线"],
        ["独立开发者愿意安装", "GitHub 开源 + 一条命令生成 repo pain report", "30 天 300 stars、50 个成功运行 telemetry"],
        ["报告比原始数据更值钱", "给 10 位用户同时看 CSV 与 Growth Pack", "≥7 人选择报告；≥3 人要求持续监控"],
        ["目录自动化节省真实时间", "30 个目录的 founder dogfood", "≥24 个到最终步骤；失败 100% 被分类"],
        ["可靠性值得付费", "本地免费 vs hosted waitlist + $29 预购", "≥10 个付费意向或 3 个实际预购"],
        ["recipes 能形成社区供给", "发布 5 个模板与 contribution guide", "30 天 ≥5 个外部 recipe PR"],
    ]
    story += [styled_table(assumptions, [52 * mm, 68 * mm, 54 * mm], styles), PageBreak()]

    # Firecrawl growth
    story += [P("7. Firecrawl 增长拆解：你应该复制什么", styles, "H1")]
    story += [
        P("Firecrawl 的增长重点不是“它绕过了多少站”，而是把一个很痛的内部问题压成极简 API，再用开源降低试用摩擦，用托管层承接持续可靠性。官方资料显示：约三个月达到 8K+ stars；后来披露 350K developers、15x 年增长和 $14.5M Series A；当前官网与 repo 的规模进一步扩大。" + refs("S01", "S03", "S04", "S05"), styles),
        P("7.1 可复制增长飞轮", styles, "H2"),
    ]
    flywheel = [
        ["阶段", "Firecrawl 做法", "你对应的做法"],
        ["Dogfood", "Mendable 内部反复遇到摄取问题", "用自己的 SEO 研究和 30 站外链提交持续压测"],
        ["一行价值", "URL → LLM-ready Markdown", "目标 → 可追溯 pain/growth report；任务 → 可恢复完成"],
        ["开源获取", "README、self-host、快速开始", "CLI + Docker + sample datasets + 一条命令 demo"],
        ["内容分发", "YC Launch、模板、社区案例", "每周公开痛点报告、站点 benchmark、recipe showcase"],
        ["生态扩张", "SDK、MCP、Skill、集成", "recipes、provider adapters、Skill、MCP、GitHub Action"],
        ["托管转化", "credits、concurrency、browser minutes、企业能力", "hosted runs、proxy/provider、scheduler、team、repair SLA"],
    ]
    story += [styled_table(flywheel, [28 * mm, 64 * mm, 82 * mm], styles)]
    story += [P("7.2 你的开源增长资产", styles, "H2")]
    for item in [
        "Benchmark 页面：同一 500 条数据任务在覆盖率、token、用时、人工介入次数上的结果。",
        "Public Pain Reports：每周选择一个热门 repo/细分市场，发布可验证结论和 Markdown 数据包。",
        "Recipe Bounties：为高需求站点或目录悬赏 recipe；合并时必须带 fixture 与成功条件。",
        "Failure Gallery：展示真实失败、诊断和修复，不假装 100% 永远成功；这会建立工程信任。",
        "Growth Templates：pain miner、competitor review miner、directory submitter、Amazon monitor 等开箱配方。",
        "Contributor economics：未来 recipe marketplace 分成，让维护者为站点覆盖持续贡献。",
    ]:
        story.append(bullet(item, styles))
    story += [PageBreak()]

    # Monetization
    story += [P("8. 商业模式：免费卖能力，付费卖省心", styles, "H1")]
    tiers = [
        ["层级", "建议价格", "包含内容", "付费理由"],
        ["Open Source", "$0", "CLI、local storage、基础 connectors、recipes、自带 key/provider", "获得用户、贡献和真实失败反馈"],
        ["Solo", "$29/月", "托管运行、定时任务、历史、基础代理 credits、PDF/Markdown 报告", "无需维护浏览器与 cron"],
        ["Growth", "$99/月", "更高并发、多 workflow、团队空间、webhook、优先 recipes", "持续监控与增长执行"],
        ["Agency", "$299/月起", "多客户 workspace、白标报告、批量队列、权限、客户证据包", "把交付时间变成毛利"],
        ["Execution credits", "按用量", "browser minutes、proxy/provider、managed runs、人工接管额度", "将变动成本透明转嫁"],
        ["Recipe marketplace", "收入分成", "高价值站点 recipes、维护 SLA、行业模板", "扩大覆盖且降低内部维护"],
    ]
    story += [styled_table(tiers, [28 * mm, 25 * mm, 76 * mm, 45 * mm], styles)]
    story += [P("8.1 为什么这个分层成立", styles, "H2")]
    story += [
        P("Firecrawl 用免费 credits 承担试用，用付费 credits、并发、browser minutes 和支持承接规模；Apify 也用免费层加 usage-based 计算；GummySearch、Syften 与 F5Bot 则验证了独立开发者/营销用户对 $10–$200/月的研究与监听预算。" + refs("S02", "S34", "S36", "S37", "S38"), styles),
        P("你的付费边界应紧贴“谁承担失败成本”：用户自己运行、自带 provider、自己 repair 就免费；你承担调度、浏览器、代理、队列、历史与 repair，就收费。", styles, "Quote"),
    ]
    story += [P("8.2 单位经济必须从第一天记录", styles, "H2")]
    unit = [
        ["指标", "为什么重要", "早期目标"],
        ["Cost per successful task", "失败重试会吞掉代理和浏览器成本", "按 recipe 与 provider 分开核算"],
        ["Human interventions / 100 tasks", "人工接管决定毛利与自动化上限", "持续下降；高价值站点可接受非零"],
        ["Repair hours / recipe / month", "DOM 与流程变化是隐藏 COGS", "高频 recipes 优先自动回归"],
        ["Successful task gross margin", "用量收费不能掩盖负毛利", "托管层成熟后 >70%"],
        ["Two-week reuse", "排除一次性新奇使用", "Pain Miner ≥40%；Backlink Ops 按项目复用"],
    ]
    story += [styled_table(unit, [48 * mm, 73 * mm, 53 * mm], styles), PageBreak()]

    # Roadmap
    story += [P("9. 30 天 MVP：先证明任务完成率", styles, "H1")]
    roadmap = [
        ["周期", "构建内容", "必须交付的证据"],
        ["第 1 周", "task schema、artifact store、checkpoint、CLI、provider adapter 接口", "一个长任务中断后可恢复；重复运行不重复写入"],
        ["第 2 周", "GitHub Issues Pain Miner：分页、增量、去重、Markdown 证据报告", "500 条 Issues；每个结论有 source ID；模型不读取全量语料"],
        ["第 3 周", "Backlink Ops：10 个目录 recipe、知识库字段映射、截图、人工接管", "10 站均有明确最终状态；失败可复现；接管后继续"],
        ["第 4 周", "开源 README、Docker、sample report、benchmark、waitlist/预购页", "可在 10 分钟内跑通 demo；收集首批安装与付费信号"],
    ]
    story += [styled_table(roadmap, [26 * mm, 80 * mm, 68 * mm], styles)]
    story += [P("9.1 第一版技术形态", styles, "H2")]
    shape = [
        ["形态", "现在是否做", "理由"],
        ["CLI", "做", "最适合开源、批处理、保存本地 artifacts 和 CI"],
        ["Docker", "做", "降低环境差异；便于持久 browser/profile"],
        ["Skill", "做", "让 Codex/Cursor/Claude 调用固定 workflow，而非把全量数据进上下文"],
        ["MCP", "第 2 阶段", "等 schema、预算和工具路由稳定后开放，避免 credits 失控"],
        ["Web dashboard", "只做 hosted beta", "先验证任务结果，再做可视化；付费层需要历史与团队"],
        ["HTML 报告", "做轻量输出", "便于分享和 SEO；同时保留 Markdown/JSONL 可携带性"],
    ]
    story += [styled_table(shape, [33 * mm, 30 * mm, 111 * mm], styles)]
    story += [P("9.2 三个决定性 benchmark", styles, "H2")]
    benchmarks = [
        ["Benchmark", "输入", "通过线"],
        ["Pain 500", "500 条 GitHub Issues / 社区条目", "≥95% source links；去重可复核；报告模型上下文受预算限制"],
        ["Directory 30", "30 个精选目录", "≥24 到最终步骤；≥15 无人工完成；所有失败分类；中断可恢复"],
        ["Amazon 300（可选）", "300 商品页", "覆盖率、总耗时、每百页介入、数据新鲜度和成本全部可测"],
    ]
    story += [styled_table(benchmarks, [38 * mm, 54 * mm, 82 * mm], styles), PageBreak()]

    story += [P("10. 90 天路线：从开源工具到托管产品", styles, "H1")]
    phases = [
        ["阶段", "产品", "增长", "商业"],
        ["0–30 天", "GitHub Issues + 10 个目录 recipes；可靠状态机", "repo、benchmark、3 份公开报告", "waitlist + $29 founder plan"],
        ["31–60 天", "Reddit/X adapter 接口、用户导入、增量监控、30 目录", "weekly pain reports、recipe bounties、对比内容", "10 个设计伙伴；执行 credits 测试"],
        ["61–90 天", "hosted scheduler、团队空间、历史 diff、provider routing", "案例、贡献者计划、模板市场雏形", "Solo/Growth beta；3–10 个付费用户"],
    ]
    story += [styled_table(phases, [25 * mm, 58 * mm, 49 * mm, 42 * mm], styles)]
    story += [P("10.1 90 天北极星指标", styles, "H2")]
    metrics = [
        ["指标", "90 天目标", "为什么比 stars 更重要"],
        ["Weekly successful tasks", "≥250", "代表产品被用于真实工作"],
        ["Task completion rate", "目标站点集合内 ≥70%", "直接反映可靠性价值"],
        ["Two-week reuse", "≥40%", "说明不是一次性 demo"],
        ["External recipe contributors", "≥10", "验证开源供给飞轮"],
        ["Hosted paid users", "≥5；理想 10+", "验证免费到可靠性付费"],
        ["Median repair time", "高频 recipe <48 小时", "衡量动态站点维护能力"],
    ]
    story += [styled_table(metrics, [48 * mm, 38 * mm, 88 * mm], styles)]
    story += [P("10.2 明确不做的大而全范围", styles, "H2")]
    for item in [
        "不在 90 天内自建全球代理网络或通用 CAPTCHA 基础设施；先做 provider adapters 与统一 telemetry。",
        "不同时做十个垂直场景；Pain Miner 是公开楔子，Backlink Ops 是内部/早期用户压力测试。",
        "不把 dashboard 当 MVP；先把任务状态、证据和完成率做稳。",
        "不追求“支持全网”；优先维护能带来安装、复用或付费的高价值 recipes。",
    ]:
        story.append(bullet(item, styles))
    story += [PageBreak()]

    # SEO
    story += [P("11. 数据之后如何做 SEO 增长", styles, "H1")]
    story += [
        P("你的第二层想法是对的：如果产品只输出 Markdown，它仍然容易被 Firecrawl、Crawl4AI 或任意 scraper 替代；当它把证据变成可执行的增长队列时，价值才向业务结果移动。", styles),
        P("11.1 Growth Pack 输出", styles, "H2"),
    ]
    growth_pack = [
        ["产物", "由哪些证据生成", "用户下一步"],
        ["Pain clusters", "重复抱怨、Issue labels、原帖引用", "选择产品功能或细分市场"],
        ["Comparison briefs", "竞品名 + 反复缺点 + 需求语言", "发布 alternatives / vs 页面"],
        ["Question library", "用户原话中的 how/why/problem queries", "写 FAQ、教程、support content"],
        ["Programmatic page candidates", "稳定、可结构化、差异足够的数据维度", "先人工审核 20 页，再规模化"],
        ["Outreach list", "提到问题且有明确场景的帖子/作者", "做研究邀请、内容合作或社区回复"],
        ["Directory queue", "目录质量、相关性、流量、提交状态", "优先提交高价值站点并持续追踪"],
        ["Weekly diff", "新增痛点、强度变化、竞品新 Issue", "形成持续内容和产品迭代节奏"],
    ]
    story += [styled_table(growth_pack, [38 * mm, 71 * mm, 65 * mm], styles)]
    story += [P("11.2 外链提交不是附属功能，而是 Action Layer 的第一个配方", styles, "H2")]
    story += [
        P("社区对批量目录的质量评价并不一致：有人抱怨外链列表大量失效，也有人建议只做少数高质量、相关目录。对产品的启示不是删掉该功能，而是给目录加入 quality score、最后验证时间、成功率、编辑权和人工介入成本，让用户自己决定速度与质量。" + refs("S23", "S24", "S25"), styles),
        P("你可以把“成功提交 30 个站”升级为更可信的结果：30 个站的状态均可追踪，其中多少已提交、待验证、需人工、被拒绝、后续获得可访问 profile/backlink；这比 agent 在第一个 CAPTCHA 后停止更有价值。", styles, "Quote"),
    ]
    story += [PageBreak()]

    # Risks without veto
    story += [P("12. 风险地图：如何吸收，而不是如何退缩", styles, "H1")]
    risks = [
        ["风险", "可能发生什么", "产品化应对", "不改变的核心判断"],
        ["平台接口/条款变化", "连接器失效、成本变化、某条数据路径不可持续", "adapter 可替换；用户导入/API/browser/provider 共用 schema；单源收入设上限", "多源痛点研究仍成立"],
        ["账号与会话不稳定", "登录失效、账号锁定、长任务中断", "profile vault、健康检查、身份隔离、checkpoint、人工接管", "可靠执行仍是付费点"],
        ["CAPTCHA 与反爬升级", "成功率下降、代理/浏览器成本上升", "分级运行时、provider 路由、成本上限、失败透明、recipe repair", "阻力越大，稳定工具越有价值"],
        ["recipes 维护量爆炸", "站点 DOM 与流程持续变化", "优先级队列、fixtures、回归测试、社区 bounty、marketplace", "覆盖速度可形成 moat"],
        ["低质量数据污染 AI", "Markdown 为空、字段静默缺失、聚类幻觉", "coverage score、source ID、HTML fallback、证据门槛", "证据层成为差异化"],
        ["外链价值参差", "有些目录失效或收益低", "quality score、最后验证、成功证据、用户策略配置", "自动化仍能节省筛选和执行时间"],
        ["云成本不可控", "browser minutes、代理、模型重试吞噬毛利", "预算控制、缓存、按成功任务核算、usage credits", "商业模式改为透明用量"],
    ]
    story += [styled_table(risks, [32 * mm, 44 * mm, 62 * mm, 36 * mm], styles)]
    story += [P("12.1 什么时候真正需要改变方向", styles, "H2")]
    for item in [
        "不是因为某个平台难抓，而是因为连续 10 个目标用户都不愿安装、使用或为成功率付费。",
        "不是因为有 CAPTCHA，而是因为高价值任务的人工介入和 provider 成本长期高于用户愿付价格。",
        "不是因为外链质量有争议，而是因为用户看完状态与质量评分后仍不愿把它纳入工作流。",
        "不是因为竞品强，而是因为你的垂直完成率、证据质量和恢复速度无法在 benchmark 中形成可见优势。",
    ]:
        story.append(bullet(item, styles))
    story += [callout("风险结论：保持你的 idea。用架构分散平台风险，用 benchmark 管理可靠性，用单位经济决定哪些站点值得自动化。不要在写代码前用抽象限制替用户做出“不需要”的判断。", styles, GREEN), PageBreak()]

    # One page brief
    story += [P("13. 一页产品 Brief", styles, "H1")]
    brief = [
        ["项目", "建议"],
        ["工作名", "GrowthCrawler / PainOps / Crawl2Growth（发布前再做命名验证）"],
        ["一句话", "开源的可恢复增长爬虫：抓取难站点，把数据压成 AI-ready 证据，并继续执行 SEO/增长动作"],
        ["第一 ICP", "独立开发者、DevTool 创始人、micro-SaaS、SEO/增长 freelancer、小型 agency"],
        ["公开楔子", "Pain Miner：Reddit/X/GitHub Issues → Evidence Ledger → Pain Report → SEO Briefs"],
        ["自用楔子", "Backlink Ops：知识库 → 目录 recipes → 自动填表 → 状态/截图 → 人工接管 → 恢复"],
        ["免费", "本地 CLI、Docker、基础 connectors、JSONL/Markdown、recipes、自带 provider"],
        ["付费", "托管浏览器、调度、代理/数据 provider、历史、团队、可视化、repair SLA、执行 credits"],
        ["核心 KPI", "任务完成率、每百任务人工介入、成功成本、两周复用、repair time、外部 recipe PR"],
        ["30 天过线", "Pain 500 benchmark 通过；30 目录 ≥24 到最终步骤；50 个真实运行；3 个付费/预购"],
        ["90 天过线", "≥250 周成功任务；≥40% 两周复用；≥10 外部贡献者；5–10 hosted 付费用户"],
        ["战略结论", "现在就做。先做可靠任务引擎和两个配方，不先做大而全 Firecrawl clone"],
    ]
    story += [styled_table(brief, [35 * mm, 139 * mm], styles)]
    story += [Spacer(1, 5 * mm), callout("你最初的直觉是对的：上下文爆炸、反爬导致 agent 半途而废、抓完后不知道如何增长，这三个问题可以被同一个产品串起来。真正值得收敛的不是野心，而是第一批 recipes 和 benchmark。", styles, BLUE), PageBreak()]

    # Sources
    story += [P("附录 A：证据来源索引", styles, "H1")]
    story += [P("本版使用上一轮通过 Chrome 收集并保存的 40 个来源。链接均可点击；社区证据用于确认故障模式，官方页面用于规模、定价和产品事实。", styles)]
    rows = [["ID", "平台/日期", "来源与核心信号", "等级"]]
    for source in sources:
        domain = urlparse(source.url).netloc.replace("www.", "")
        title = f'<link href="{source.url}" color="#246BFD"><b>{source.title}</b></link><br/><font color="#5F6B7A">{domain}</font><br/>{source.signal}'
        rows.append([
            source.id,
            f"{source.platform}<br/>{source.date}",
            Paragraph(title, styles["TableCell"]),
            {"high": "高", "medium": "中", "low": "低"}.get(source.confidence, source.confidence),
        ])
    story += [styled_table(rows, [13 * mm, 31 * mm, 116 * mm, 14 * mm], styles)]
    story += [Spacer(1, 4 * mm), P("证据台账：research/evidence_ledger.csv；生成脚本：generate_report_v2.py。", styles, "Caption")]
    return story


def main() -> None:
    register_fonts()
    sources, source_map = load_sources()
    styles = build_styles()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = V2DocTemplate(
        str(OUT),
        pagesize=(PAGE_W, PAGE_H),
        title="AI 爬虫与增长自动化 SaaS 创业机会深度验证（执行导向重写版）",
        author="OpenAI Codex",
        subject="以开源垂直爬虫、可靠自动化、Pain Miner 与 SEO Growth Workflows 为核心的创业验证",
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
    )
    doc.multiBuild(build_story(sources, source_map, styles))
    print(OUT)


if __name__ == "__main__":
    main()
