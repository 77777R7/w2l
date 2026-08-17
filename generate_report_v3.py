#!/usr/bin/env python3
"""Generate the Chrome-validated, execution-first crawler opportunity report."""

from __future__ import annotations

import csv
from pathlib import Path
from urllib.parse import urlparse

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Flowable, NextPageTemplate, PageBreak, Paragraph, Spacer, Table, TableStyle
from reportlab.platypus.tableofcontents import TableOfContents

from generate_report import (
    AMBER, BLUE, CYAN, GREEN, INK, LIGHT, LINE, MARGIN_BOTTOM, MARGIN_TOP,
    MARGIN_X, MUTED, NAVY, PAGE_H, PAGE_W, PURPLE, RED, WHITE, P,
    ReportDocTemplate, Source, build_styles, bullet, callout, register_fonts,
    source_ref, styled_table,
)


ROOT = Path(__file__).resolve().parent
BASE_LEDGER = ROOT / "research" / "evidence_ledger.csv"
ADD_LEDGER = ROOT / "research" / "evidence_additions_v3.csv"
OUT = ROOT / "output" / "pdf" / "AI爬虫与批量增长自动化SaaS_Chrome深度验证版.pdf"


def load_all_sources() -> tuple[list[Source], dict[str, Source]]:
    rows: list[Source] = []
    for path in (BASE_LEDGER, ADD_LEDGER):
        with path.open(newline="", encoding="utf-8-sig") as handle:
            rows.extend(Source(**row) for row in csv.DictReader(handle))
    ids = [row.id for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate evidence IDs")
    return rows, {row.id: row for row in rows}


class V3DocTemplate(ReportDocTemplate):
    def _body_page(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN_X, PAGE_H - 12 * mm, PAGE_W - MARGIN_X, PAGE_H - 12 * mm)
        canvas.setFont("CJK", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_X, PAGE_H - 9.5 * mm, "AI 爬虫与批量增长自动化 SaaS - Chrome 深度验证版")
        canvas.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 9.5 * mm, "2026-08-17")
        canvas.line(MARGIN_X, 11 * mm, PAGE_W - MARGIN_X, 11 * mm)
        canvas.drawString(MARGIN_X, 7 * mm, "旧 40 源 + 新增 Chrome/CDP 证据 - 以任务完成率为核心")
        canvas.drawRightString(PAGE_W - MARGIN_X, 7 * mm, str(doc.page))
        canvas.restoreState()


class FourPillars(Flowable):
    def __init__(self):
        super().__init__()
        self.width = 174 * mm
        self.height = 58 * mm

    def draw(self):
        canvas = self.canv
        boxes = [
            ("1. 穿过反爬", "多通道运行\n会话 / 代理 / 接管", RED),
            ("2. 批量提交", "状态机 / Recipe\n验证 / 恢复", AMBER),
            ("3. 垂直抓取", "增量 / 去重\n证据 / Markdown", BLUE),
            ("4. 痛点闭环", "数据到洞察\n洞察到增长", GREEN),
        ]
        x = 0
        box_w, gap = 37 * mm, 8 * mm
        for index, (title, body, color) in enumerate(boxes):
            canvas.setFillColor(colors.Color(color.red, color.green, color.blue, alpha=0.10))
            canvas.setStrokeColor(color)
            canvas.roundRect(x, 10 * mm, box_w, 34 * mm, 3 * mm, stroke=1, fill=1)
            canvas.setFillColor(color)
            canvas.setFont("CJK-Bold", 8.8)
            canvas.drawCentredString(x + box_w / 2, 34 * mm, title)
            canvas.setFillColor(INK)
            canvas.setFont("CJK", 7.2)
            for line_no, line in enumerate(body.split("\n")):
                canvas.drawCentredString(x + box_w / 2, (25 - line_no * 6) * mm, line)
            if index < len(boxes) - 1:
                arrow_x = x + box_w + 1.5 * mm
                canvas.setStrokeColor(MUTED)
                canvas.line(arrow_x, 27 * mm, arrow_x + 5 * mm, 27 * mm)
                canvas.line(arrow_x + 5 * mm, 27 * mm, arrow_x + 3 * mm, 28.5 * mm)
                canvas.line(arrow_x + 5 * mm, 27 * mm, arrow_x + 3 * mm, 25.5 * mm)
            x += box_w + gap


def metric_cards(styles, source_count: int):
    items = [
        ("创业判断", "强 GO", GREEN),
        ("证据规模", f"{source_count} 源", BLUE),
        ("北极星", "任务完成率", RED),
        ("第一产品", "GrowthCrawler", CYAN),
    ]
    cells = [P(f'<font color="{color.hexval()}"><b>{title}</b></font><br/><font size="11"><b>{value}</b></font>', styles, "BodySmall") for title, value, color in items]
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
    n_sources = len(sources)
    n_new = n_sources - 40
    official_count = sum(row.evidence_type.startswith("official") or row.evidence_type == "official_repo" for row in sources)
    community_count = sum(row.evidence_type in {"community_post", "community_comparison", "third_party_reviews", "user_issue", "search_indexed_user_issue"} for row in sources)
    reddit_count = sum(row.platform == "Reddit" for row in sources)
    issue_count = sum(row.platform == "GitHub Issue" for row in sources)
    x_count = sum(row.platform == "X" for row in sources)
    high_count = sum(row.confidence == "high" for row in sources)
    medium_count = sum(row.confidence == "medium" for row in sources)
    low_count = sum(row.confidence == "low" for row in sources)

    story += [
        P("CHROME + CDP DEEP VALIDATION · FOUNDER EDITION", styles, "CoverKicker"),
        P("AI 爬虫与批量增长自动化 SaaS<br/>深度验证报告", styles, "CoverTitle"),
        P("严格围绕四个核心竞争力：如何穿过反爬、如何批量提交、如何稳定抓取、如何解决用户最痛的任务失败", styles, "CoverSub"),
        P(f"为 Howard 制作 · 2026 年 8 月 17 日<br/>复用原始 40 个来源，新增 {n_new} 个 Chrome/CDP 验证来源<br/>覆盖 GitHub Issues、Reddit、X、官方产品、定价与融资公告", styles, "CoverMeta"),
        NextPageTemplate("body"),
        PageBreak(),
    ]

    story += [P("目录", styles, "H1")]
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(fontName="CJK-Bold", name="TOC1V3", fontSize=9.3, leading=14.5, textColor=INK, leftIndent=0, firstLineIndent=0, spaceBefore=2 * mm),
        ParagraphStyle(fontName="CJK", name="TOC2V3", fontSize=7.8, leading=11.5, textColor=MUTED, leftIndent=5 * mm, firstLineIndent=0),
    ]
    story += [toc, Spacer(1, 4 * mm), callout("阅读重点：第 2-5 章是产品核心；第 6 章给出竞争信息差；第 8-10 章把能力落到开源、收费、30/90 天执行。", styles, CYAN), PageBreak()]

    story += [P("0. 结论：你要做的不是爬虫，而是任务完成引擎", styles, "H1"), metric_cards(styles, n_sources), Spacer(1, 4 * mm)]
    story += [
        callout("最终判断：强 GO。反爬、CAPTCHA、登录、批量失败和上下文爆炸不是应当避开的边界，它们就是用户愿意安装和付费的原因。产品的核心指标不再是抓了多少页，而是一个高价值任务最终完成了多少。", styles, GREEN),
        P("原始 40 个来源已经证明 Firecrawl 的横向 Context API、Amazon/X/Reddit 抓取失败、Markdown 空结果和代理成本。新增 Chrome/CDP 证据进一步确认：Browser Use 用户会随机卡在 about:blank 循环，旧 session 让任务无法回到登录页，现有 profile 启动会超时，文件上传中断流程，甚至出现“点击了提交按钮但表单没有真正提交”。" + refs("S42", "S43", "S44", "S45", "S46", "S47"), styles),
        P("更强的 VOC 进一步显示失败会直接吞掉时间与预算：同一浏览器的第二个顺序任务就失败；远程 CDP 调用可无限挂起；一个人类两次点击的购票任务让 agent 循环 40 分钟并导致购物车两次过期。" + refs("S87", "S89", "S95"), styles),
        P("市场侧也更强：Browserbase 披露 $40M Series B，Browser Use 披露 $17M 融资，Firecrawl 披露 $14.5M Series A，Skyvern 披露 $2.7M seed。四个公开公告合计至少 $74.2M，说明浏览器基础设施、上下文获取和复杂 Web 工作流正在形成独立赛道。" + refs("S03", "S64", "S65", "S66"), styles),
        P("与此同时，Browserbase、Browser Use、Skyvern、Steel、Browse AI 和 Axiom 都把代理、stealth、CAPTCHA、持久 session、2FA、录屏和并发放进付费层。这说明用户买的不是“AI 会点击”，而是生产环境的稳定性。" + refs("S58", "S59", "S60", "S61", "S62", "S63"), styles),
        FourPillars(),
        P("推荐形态：一个开源 <b>GrowthCrawler Runtime</b>，上面运行两个首发 recipes。<b>Pain Miner</b> 把 Reddit/X/GitHub Issues 变成可引用的市场证据；<b>Submission Runner</b> 把 30-200 个目录/增长站点变成可暂停、可恢复、可证明完成的批量任务。", styles),
    ]
    story += [PageBreak()]

    story += [P("1. 新增研究发现与信息差", styles, "H1")]
    story += [P(f"本轮通过 Chrome 与 CDP 复核页面 DOM、可见文本、定价表和 Google 索引片段。总证据由 40 个增加到 {n_sources} 个；当前包含 {official_count} 个官方/官方仓库来源、{community_count} 个社区或用户 Issue 来源，其中 Reddit {reddit_count} 个、GitHub Issues {issue_count} 个、X {x_count} 个。置信度分布为高 {high_count}、中 {medium_count}、低 {low_count}。官方材料用于产品与价格事实，社区材料用于故障模式与用户语言。", styles)]
    new_findings = [
        ["新增发现", "证据", "对产品的含义"],
        ["持久登录既是解法也是新故障源", "profile timeout、旧 session、storage state、cookie 注入失败", "需要 Session Vault、profile 锁、健康检查与显式重置"],
        ["点击成功不等于任务成功", "表单未提交、上传按钮不能工作、agent output 误判", "每一步必须有 post-condition validator 和 artifact"],
        ["一直运行不等于仍有进展", "CDP 无限挂起、modal 循环、40 分钟未收敛", "action deadline、loop fingerprint、watchdog、hard stop 与接管"],
        ["本地成功不等于云端成功", "cloud IP 被阻、付费代理仍被识别", "本地/CDP/云浏览器/代理/provider 必须是可切换 lanes"],
        ["数据可能不是空，而是被悄悄污染", "crawler 被检测后收到不同价格", "需要跨路径抽检、异常检测和可信度评分"],
        ["批量目录工作有可量化时间成本", "10-12 小时、30+ 小时、80+ 小时等用户自报", "时间节省是强卖点，但需用真实 benchmark 排除供应商宣传"],
        ["批量提交的断点发生在提交之后", "审批可延续数月、未索引、链接失效、账号归属不清", "将 approval / live / indexed / owned / reverified 建成状态机"],
        ["竞品正在按可靠性分层收费", "$15-$999+；并发、代理、CAPTCHA、录屏、人机接管进入高阶层", "开源免费 / 托管可靠性付费的结构已被市场教育"],
    ]
    story += [styled_table(new_findings, [46 * mm, 65 * mm, 63 * mm], styles)]
    story += [P("1.1 痛点强度排序", styles, "H2")]
    pain_rank = [
        ["痛点", "频率", "强度", "付费性", "判断"],
        ["反爬/CAPTCHA/云 IP", "高", "极高", "高", "阻止核心任务完成，直接进入付费基础设施"],
        ["登录/session/2FA", "高", "极高", "高", "任务无法复用，所有批处理都会退化为人工"],
        ["长任务中断与不可恢复", "高", "极高", "高", "从第 27 个站失败会浪费前 26 个站状态"],
        ["错误成功与静默脏数据", "中", "极高", "高", "结果看似完成但业务结论错误"],
        ["模型上下文爆炸", "高", "高", "中高", "限制规模并持续产生 token 成本"],
        ["目录/表单重复劳动", "中高", "高", "中高", "创始人愿意用工具或服务换回 10-80 小时"],
        ["提交后审批/索引/维护黑箱", "中高", "极高", "高", "直接决定用户是否相信报告并再次购买"],
    ]
    story += [styled_table(pain_rank, [45 * mm, 18 * mm, 19 * mm, 20 * mm, 72 * mm], styles), PageBreak()]

    # Core 1
    story += [P("2. 核心一：如何绕过反爬机制", styles, "H1")]
    story += [
        callout("这里的“绕过”应被产品化为：在用户有权执行的任务中，通过分级访问、持久状态、可替换供应商和人工接管提高通过率；不依赖一段永久有效的对抗技巧。", styles, RED),
        P("2.1 六级通过率架构", styles, "H2"),
    ]
    anti_bot = [
        ["级别", "执行通道", "什么时候升级", "产物/指标"],
        ["L0", "API、RSS、静态 HTTP", "存在稳定结构或公开接口", "响应、配额、字段覆盖率"],
        ["L1", "真实渲染浏览器", "JS、无限滚动、交互加载", "加载时间、DOM 完整度、截图"],
        ["L2", "持久 Chrome/CDP profile", "登录、cookie、跨步骤任务", "session 健康、登录次数、profile 锁"],
        ["L3", "代理/provider 路由", "云 IP、区域或访问稳定性问题", "每域成功率、带宽成本、出口质量"],
        ["L4", "CAPTCHA/未知页面人工接管", "自动路径无法可靠继续", "介入原因、用时、恢复率"],
        ["L5", "站点 recipe + 自动 repair", "高频高价值站点反复变化", "recipe 版本、回归通过率、修复时长"],
    ]
    story += [styled_table(anti_bot, [17 * mm, 44 * mm, 57 * mm, 56 * mm], styles)]
    story += [P("2.2 反爬系统不能只做 Proxy 选项", styles, "H2")]
    for item in [
        "先做 <b>Route Planner</b>：对目标域选择最低成本且最近成功的通道；只有失败时才升级到更贵的 browser/proxy/provider。",
        "做 <b>Session Vault</b>：为每个用户、站点和身份保存独立 profile；检测过期、锁冲突和旧 session 污染。Browser Use 的 profile/session Issues 及 cloud browser 必须显式 stop 的文档证明，这不是边角问题。" + refs("S43", "S44", "S45", "S67"),
        "做 <b>Block Detector</b>：识别 CAPTCHA、403/429、软阻断、空内容和异常跳转；不要让模型把阻断页总结成正常内容。",
        "做 <b>Provider Adapter</b>：Browserbase、Steel、Browse AI、Bright Data 等都可成为底层；产品不绑定单一供应商。" + refs("S40", "S58", "S60", "S63"),
        "做 <b>Budget Governor</b>：按域设定最高浏览器分钟、代理 GB、重试次数和人工介入；超过预算进入人工队列。",
        "做 <b>Watchdog</b>：每个 CDP action 有 deadline，连接有 heartbeat；相同 DOM/modal/action fingerprint 连续出现就停止烧钱并交给人工。" + refs("S89", "S95"),
        "做 <b>Data Truth Check</b>：对价格、库存、评论数等关键字段抽样走第二通道，防止“返回 200 但数据被替换”。" + refs("S52"),
    ]:
        story.append(bullet(item, styles))
    story += [P("2.3 为什么这能成为竞争力", styles, "H2")]
    story += [P("Reddit 用户报告付费代理仍会被 Cloudflare 识别；有人估算 4G proxy 单个 $40-$50/月，十个接近 $500/月；也有人遇到本地成功、上云即被封。竞争力不是无限堆代理，而是知道哪个域值得升级、何时停止、哪条路径数据可信。" + refs("S48", "S50", "S51"), styles)]
    story += [callout("反爬北极星：不是“零 CAPTCHA”，而是 Completed Tasks / Total Tasks、每百任务人工介入次数、每个成功任务的代理与浏览器成本、阻断后恢复率。", styles, GREEN), PageBreak()]

    # Core 2
    story += [P("3. 核心二：如何批量提交", styles, "H1")]
    story += [
        P("批量提交的真正难点不是循环 30 次，而是 30 个站点拥有不同字段、账号、上传组件、验证邮件、CAPTCHA 和成功条件。Browser Use 的文件上传和错误提交 Issue 说明：通用 agent 会在最关键的最后一步产生假成功。" + refs("S46", "S47"), styles),
        P("这不是一个想象出来的小众场景：Reddit 上有用户明确要向 300 个不同机构提交 300 张字段各异的表单。对这种任务，schema mapper、preview、人审、幂等与回执不是锦上添花，而是避免错误提交的最低产品契约。" + refs("S93"), styles),
        P("3.1 Submission Runtime 数据模型", styles, "H2"),
    ]
    submission_model = [
        ["对象", "关键字段", "作用"],
        ["Campaign", "product_id、目标、预算、策略", "一次 30/100/200 站提交计划"],
        ["Target", "domain、quality score、recipe version、priority", "决定是否值得花贵通道和人工时间"],
        ["Attempt", "lane、session、cost、started_at、checkpoint", "每次执行可重试且不覆盖历史"],
        ["Step", "action、expected state、actual state、retry policy", "点击后必须验证，不依赖 agent 自我报告"],
        ["Artifact", "screenshot、HTML、submitted URL、email state", "证明完成或定位失败"],
        ["Handoff", "reason、required action、resume token", "人工处理后从原步骤继续"],
    ]
    story += [styled_table(submission_model, [28 * mm, 81 * mm, 65 * mm], styles)]
    story += [P("3.2 批量执行流程", styles, "H2")]
    batch_flow = [
        ["阶段", "系统动作", "通过条件"],
        ["预处理", "从产品知识库生成字段包；检查 logo、描述、URL、账号需求", "必填资料齐全，不进入空跑"],
        ["优先级", "按相关性、历史成功率、预计价值、预计人工成本排序", "高价值站先跑，预算不足时仍有产出"],
        ["执行", "按 recipe 进入页面、填表、上传、预览；每站独立 task", "单站失败不阻断整个 campaign"],
        ["验证", "检查成功页面、提交记录、可访问 profile、确认邮件或下一状态", "不能只相信 click 已执行"],
        ["接管", "CAPTCHA、未知字段、人工判断、邮箱验证进入队列", "用户处理后自动续跑"],
        ["复查", "按 24h/7d 检查 listing 是否上线、链接是否存在", "最终输出 verified/pending/rejected"],
    ]
    story += [styled_table(batch_flow, [24 * mm, 94 * mm, 56 * mm], styles)]
    story += [P("3.3 Recipe 不是死脚本", styles, "H2")]
    story += [P("最有价值的做法来自 Skyvern 的路线：AI 第一次探索成功路径，把成功轨迹编译成便宜、确定性的 Playwright recipe；固定路径失效时，再唤醒 AI repair 并重新编译。这样把 LLM 从每一步都调用，变成只在探索和修复时调用。" + refs("S66"), styles, "Quote")]
    story += [P("3.4 目录提交痛点的量化信号", styles, "H2")]
    directory_signals = [
        ["社区信号", "自报数字", "如何使用"],
        ["200+ 目录的基础 SEO 表单", "10-12 小时", "作为 landing page 的时间假设，需 founder dogfood 验证"],
        ["自动化 80% backlink workflow", "约 2 小时 vs 过去 30+ 小时", "说明 workflow 自动化的感知价值，不当作普遍 ROI"],
        ["提交 SaaS 到目录", "80+ 小时", "极端痛点样本，适合研究最耗时步骤"],
        ["220+ 手工目录经验", "90+ comments", "可反向构建目录质量、持久价值和成功率数据库"],
    ]
    story += [styled_table(directory_signals, [62 * mm, 35 * mm, 77 * mm], styles)]
    story += [P("这些帖子可能包含自我推广，因此报告把它们作为定量假设，而不是总体市场统计。" + refs("S53", "S54", "S56", "S57"), styles, "Caption")]
    story += [P("3.5 已经存在的付费锚点，以及它们留下的空位", styles, "H2")]
    submission_market = [
        ["产品/来源", "公开价格与单位", "已经卖出的价值", "仍未解决的状态"],
        ["SubmitSaaS", "$60/$100/$140；60/100/140+ 目录", "48 小时交付、表格与截图", "FAQ 明说不提供最终 approved list；审批可到数月"],
        ["ListingBott", "$299-$999；100 个精选 listing", "筛选、人工节奏、客户审核与所有权", "公开结果主要为厂商自报；交付周期一个月"],
        ["BacklinkBot", "$99-$357 一次性；Agent $99/月", "人工逐表单、live proof、定期复查", "目录价值、审批率与流量效果仍需独立验证"],
        ["Bardeen", "$10/100 credits；$50/1,000", "横向抓取/自动化与 scraper 维护", "没有目录质量、审批、索引和所有权语义"],
    ]
    story += [styled_table(submission_market, [31 * mm, 42 * mm, 50 * mm, 51 * mm], styles)]
    story += [P("价格证明市场已被教育：一次性代提交可卖 $60-$999，横向自动化可按月收费。真正的信息差是把 submitted 继续推进为 approved、live、indexed、owned、reverified，并在 7/30 天后报告真实 referral 或失效。" + refs("S71", "S72", "S73", "S77", "S78", "S79", "S80"), styles)]
    story += [callout("批量提交北极星：30 个目标都有最终状态；≥24 个到最终步骤；≥15 个无需人工完成；人工接管后可恢复；每个成功都有截图/URL/时间证据。", styles, GREEN)]

    # Core 3
    story += [P("4. 核心三：如何抓取", styles, "H1")]
    story += [
        P("抓取层必须同时解决两件事：上游取得数据，下游不把模型上下文塞爆。Firecrawl 已证明页面清洗能显著减少模型输入，但其 self-host 空 Markdown Issues 也说明“输出 Markdown”本身不是完整质量保证。" + refs("S01", "S08", "S09"), styles),
        P("4.1 数据管线", styles, "H2"),
    ]
    scraping = [
        ["层", "职责", "落盘产物", "质量 Gate"],
        ["Acquire", "API/HTTP/browser/session/provider 获取", "raw HTML/JSON、status、截图", "阻断识别、覆盖率、预算"],
        ["Normalize", "统一 post/issue/review/product schema", "normalized.jsonl", "必填字段、时间、作者/来源"],
        ["Deduplicate", "URL、内容哈希、近似重复、转帖合并", "dedupe map", "重复率、保留原引用"],
        ["Extract", "正文、字段、评论树、价格、评分", "records.parquet/jsonl", "字段缺失、范围、类型"],
        ["Evidence", "为每段文本分配 source/chunk ID", "evidence ledger", "每个结论可回溯"],
        ["Synthesize", "先聚类和采样，再交给模型", "pain clusters、briefs", "上下文预算、反例、置信度"],
        ["Act", "SEO brief、目录队列、监控、outreach research", "growth pack", "用户是否执行/复用"],
    ]
    story += [styled_table(scraping, [25 * mm, 58 * mm, 43 * mm, 48 * mm], styles)]
    story += [P("4.2 解决上下文爆炸", styles, "H2")]
    for item in [
        "原始 corpus 永远保存在模型上下文之外；模型先读统计、簇摘要和代表样本，需要证据时再按 source ID 回取。",
        "采用 map-reduce：单条结构化、主题内压缩、跨主题比较、最后生成报告；每层保存中间结果。",
        "每个站点或任务重置 context；确定性字段提取先行，只有歧义元素才调用模型。20 个顺序任务的 token 激增报告说明，浏览器步骤数会放大上下文成本。" + refs("S91"),
        "设置 hard budget：最大 records、最大 chunks、每簇代表样本、每次模型 token；超过预算先采样而不是直接截断。",
        "增量运行：保存 cursor、last_seen、etag/hash，只处理新增/变化数据；周报输出 diff，不重算全部历史。",
        "原文与模型结论分离：用户可以打开 evidence.csv/JSONL，避免 Markdown 报告成为不可审计的黑盒。",
    ]:
        story.append(bullet(item, styles))
    story += [P("4.3 Reddit、X、GitHub Issues 的 Connector Contract", styles, "H2")]
    connectors = [
        ["能力", "统一接口", "为什么重要"],
        ["搜索", "query + time range + sort + filters", "业务配方不依赖平台查询语法"],
        ["分页", "cursor + checkpoint + retry_after", "429/断线后可续跑"],
        ["线程", "root + replies + depth + score", "保留痛点语境，而非只抓标题"],
        ["身份", "public author key + optional profile hints", "去重与 persona 信号，同时最小化存储"],
        ["证据", "source URL + captured_at + raw hash", "结论可核验，页面变化可 diff"],
        ["成本", "request/browser/proxy/model/human", "按成功任务而非页数计算毛利"],
    ]
    story += [styled_table(connectors, [30 * mm, 70 * mm, 74 * mm], styles)]
    story += [callout("抓取北极星：500 条输入可稳定产出 evidence ledger；≥95% 结论有可点击来源；重复可解释；模型从不读取全量 corpus；中断后不丢 cursor。", styles, BLUE), PageBreak()]

    # Core 4
    story += [P("5. 核心四：如何切实解决非常痛的用户问题", styles, "H1")]
    pain_solutions = [
        ["用户最痛的瞬间", "现有工具怎么失败", "你的产品必须怎样结束任务", "可计费结果"],
        ["第 27/30 个站出现 CAPTCHA", "整单停止，前面状态散落", "第 27 个进入 handoff；其余继续；处理后从 checkpoint 恢复", "完整 campaign 状态"],
        ["两次点击跑了 40 分钟", "重复 modal/action，购物车 TTL 耗尽", "loop detector + step budget + TTL 告警；超限立即接管", "有界执行 SLA"],
        ["本地跑通，上云全被挡", "用户重新猜代理和环境", "自动切 lane，并展示每域本地/云/provider 成功率", "稳定托管执行"],
        ["Agent 说已提交，实际没有", "只有 action log，没有业务证据", "post-condition validator + screenshot + submitted URL +复查", "verified completion"],
        ["登录每次失效", "重复输账号，旧 session 污染", "独立 profile、健康检查、显式重置、2FA/human queue", "可复用身份运行"],
        ["抓到 10,000 条却无法决策", "token 爆、摘要泛化、无出处", "聚类、频率×强度、反例、source IDs、Growth Pack", "可执行洞察"],
        ["价格抓到但可能是假的", "200 被当作成功", "跨路径抽样、异常检测、可信度和原始 artifact", "可信数据 SLA"],
        ["站点改版脚本全坏", "人工重新写 selector", "fixture 回归、AI repair、重新编译 recipe、修复时长追踪", "recipe maintenance"],
        ["买了代提交却不知道是否上线", "只交付表格或 submitted 数量", "追踪 approval/live/indexed/owner，7/30 天复查并归因 referral", "listing management"],
    ]
    story += [styled_table(pain_solutions, [38 * mm, 43 * mm, 60 * mm, 33 * mm], styles)]
    story += [P("5.1 产品承诺应该改成结果语言", styles, "H2")]
    promises = [
        ["弱承诺", "强承诺"],
        ["支持 100 个网站", "30 个目标全部有可验证最终状态，失败不会拖垮整批任务"],
        ["自动绕过 CAPTCHA", "检测阻断、切换运行通道、控制成本；需要人工时可接管并续跑"],
        ["输出 Markdown", "每个结论都有证据 ID、原文链接、覆盖率和置信度"],
        ["AI 自动填表", "填写、上传、验证、截图、复查组成完整 submission transaction"],
        ["快速爬取", "500 条数据在固定预算内增量完成，中断后不重复、不丢失"],
    ]
    story += [styled_table(promises, [68 * mm, 106 * mm], styles)]
    story += [P("5.2 用户愿意付费的四类责任转移", styles, "H2")]
    for item in [
        "把“我自己维护 Chrome/Playwright”转移给托管 browser runtime。",
        "把“我自己判断阻断并换 provider”转移给 domain routing。",
        "把“失败后从头再来”转移给 checkpoint、retry 与 human handoff。",
        "把“抓完后自己分析和执行”转移给 Pain Report、SEO Brief 和 Submission Queue。",
    ]:
        story.append(bullet(item, styles))
    story += [PageBreak()]

    # Competition
    story += [P("6. 竞品分析：我们的信息差在哪里", styles, "H1")]
    competition = [
        ["产品", "核心商品", "价格/规模信号", "强能力", "你的空位"],
        ["Firecrawl", "Web Context API", "免费+credits；约 168K stars", "网页到 Markdown/JSON、search/scrape/interact", "不负责垂直增长任务最终完成"],
        ["Browserbase", "生产级 browser infra", "$0/$20/$99/custom；$40M B 轮", "并发、hours、proxy、CAPTCHA、stealth、recording", "独立开发者的垂直 recipe 与 evidence-to-growth"],
        ["Browser Use", "开源 agent + cloud", "$0/$29/$299/$999；$17M", "结构化 UI、advanced stealth、500 concurrency", "批量业务状态、结果验证与增长工作流"],
        ["Skyvern", "复杂 browser workflows", "$0/$29/$149；$2.7M", "planner/actor/validator、repair、HITL、2FA", "独立开发者分发、Pain Mining 与目录增长数据库"],
        ["Steel", "开源 browser API", "$0/$250/custom；1M+ browser hours", "24h session、context、CAPTCHA、proxy、recording", "上层任务与市场洞察"],
        ["Browse AI", "no-code scrape/monitor robots", "$0/$48/$87/$500+", "录制、表单、住宅代理、premium sites", "开源、可携带证据、AI repair 和开发者 recipes"],
        ["Axiom", "no-code/code browser bots", "$15/$50/$150/$250", "2FA、scheduler、recording、proxy、Turnstile、failed-run pricing", "多源研究、证据层、开源 contributor flywheel"],
        ["Apify", "Actor marketplace", "60K+ Actors；usage tiers", "垂直供给、调度、代理、marketplace", "统一 task contract、跨 Actor 验证和增长结果"],
        ["Bright Data", "代理/解锁/数据", "usage-based；20K+ customers", "全球网络、CAPTCHA、现成 datasets", "provider-neutral、独立开发者 UX 与开源 workflow"],
    ]
    story += [styled_table(competition, [22 * mm, 31 * mm, 38 * mm, 45 * mm, 38 * mm], styles)]
    story += [P("补充竞争压力：Scrapling 已接近 75K GitHub stars，并把自适应元素定位、持久 session、proxy rotation、pause/resume、阻断检测、CDP 与 MCP 放进开源底座；Zyte 以成功响应计费并整合 cookie session、浏览器渲染和 CAPTCHA；ScrapingBee 则把并发从 25 一路卖到 500+。因此“支持代理/浏览器/Markdown”都不能单独构成差异化。" + refs("S68", "S69", "S70"), styles)]
    story += [P("用户侧反证更有价值：一名 Browserbase 高频用户称短任务存在会话计费下限并主动合批；Browser Use 用户在 100+ 站点上报告每站 3-5 分钟、25-30 步与显著 token burn；Browse AI 的少量 Product Hunt 评论则显示简单任务易用与复杂流程可靠性之间存在明显断层。这些不是行业平均数，却共同指向 batch planner、确定性 recipe、预算预估和长任务恢复。" + refs("S81", "S83", "S86"), styles)]
    story += [PageBreak(), P("6.1 真正的白空间", styles, "H2")]
    story += [callout("开源、provider-neutral 的垂直任务层：下接 Browserbase/Steel/Bright Data/本地 Chrome，上接 Pain Miner、Submission Runner、Amazon Monitor；统一状态、证据、成本、人工接管和 Growth Pack。", styles, BLUE)]
    whitespace = [
        ["维度", "现有市场常见做法", "你的差异化"],
        ["计价单位", "browser hours、credits、proxy GB、rows", "successful task + transparent underlying usage"],
        ["成功定义", "请求返回、action executed、run ended", "业务 post-condition 被验证"],
        ["失败处理", "日志/录屏，用户自己修", "失败分类、lane escalation、human queue、resume"],
        ["数据输出", "HTML/JSON/CSV/Markdown", "evidence ledger + confidence + Growth Pack"],
        ["站点维护", "内部团队或 Actor 作者", "开源 recipe + fixture + bounty + marketplace"],
        ["目标用户", "开发团队或企业 ops", "独立开发者、micro-SaaS、SEO freelancer、小 agency"],
    ]
    story += [styled_table(whitespace, [33 * mm, 65 * mm, 76 * mm], styles), PageBreak()]

    # Market validation
    story += [P("7. 市场验证：需求、付费和进入时机", styles, "H1")]
    market = [
        ["验证维度", "硬信号", "置信度", "决策"],
        ["资本进入", "Firecrawl $14.5M、Browserbase $40M、Browser Use $17M、Skyvern $2.7M", "高", "Web context + browser execution 是独立且增长中的品类"],
        ["公开付费", "$15 到 $999+ 的多档订阅；另加 browser/proxy/model usage", "高", "可靠性与并发已有价格锚点"],
        ["开源分发", "Firecrawl、Browser Use、Crawl4AI、Skyvern/Steel 等均用开源进入", "高", "你的开源优先策略与市场路径一致"],
        ["极痛失败", "403/429、账号锁、空 Markdown、session 污染、假提交、上传中断", "高", "不是便利工具，而是生产阻断"],
        ["任务不收敛", "第二个顺序任务失败、CDP 无限挂起、两次点击跑 40 分钟", "中高", "watchdog、loop detector、checkpoint 可直接形成付费 SLA"],
        ["批量提交耗时", "社区自报 10-80+ 小时与 100-220+ 目录", "中低", "值得 MVP，但必须由 founder benchmark 校准"],
        ["代提交付款锚点", "$60-$999/批次；$99/月 agent；$99-$357 人工服务", "高", "买方已经为省时与交付证据付费"],
        ["提交后管理", "审批从数天到数月；社区反复讨论未索引、首日后被埋", "中高", "订阅机会在 reverify、update、index 和 referral 归因"],
        ["洞察付费", "GummySearch、Syften、F5Bot 的历史/当前价格", "中高", "Pain Miner 可用 $29-$99 起步"],
    ]
    story += [styled_table(market, [35 * mm, 83 * mm, 19 * mm, 37 * mm], styles)]
    story += [P("7.1 进入时机为什么成立", styles, "H2")]
    story += [
        P("Browserbase 从成立约 16 个月走到 $40M Series B，并同时降低价格、提高并发、推出无代码 Director；Browser Use 从四天原型和 Hacker News 发布走到 50K stars、15K+ developers 与 $17M 融资；Skyvern 则直接把 manual browser work 和 brittle scripts 称为 maintenance tax。" + refs("S64", "S65", "S66"), styles),
        P("这说明底层浏览器供给会越来越商品化，新的创业机会向上移动：谁能拥有垂直任务的状态、成功定义、失败语料、数据模型和用户增长闭环。", styles, "Quote"),
    ]
    story += [P("7.2 需要真实实验而不是继续讨论的三个数字", styles, "H2")]
    experiments = [
        ["问题", "实验", "通过线"],
        ["用户是否真的安装", "开源 CLI 一条命令跑 repo/community Pain Report", "30 天 300 stars + 50 个真实成功任务"],
        ["批量提交是否真省时", "Founder 自己跑 30 个目录，并记录人工基线", "总人工时间下降 ≥60%，所有失败有状态"],
        ["可靠性是否值得付费", "免费 self-host vs $29 hosted founder plan", "3 个预购或 10 个明确付费承诺"],
    ]
    story += [styled_table(experiments, [44 * mm, 82 * mm, 48 * mm], styles), PageBreak()]

    # OSS and business model
    story += [P("8. 开源产品设计与增长", styles, "H1")]
    repo = [
        ["模块", "开源内容", "托管/付费内容"],
        ["runtime-core", "task state、checkpoint、artifact、budget、adapter contract", "managed queue、autoscaling、SLA"],
        ["browser-lanes", "local Chrome/CDP、Playwright、BYO provider", "hosted browser、proxy routing、session vault"],
        ["recipes", "GitHub Issues、sample directories、fixtures、contribution guide", "premium recipes、repair SLA、marketplace"],
        ["evidence", "JSONL/Markdown、source IDs、dedupe、local reports", "history、team、scheduled diff、white-label PDF"],
        ["human queue", "local pause/resume contract", "shared inbox、roles、managed operations"],
        ["growth pack", "basic pain/SEO outputs", "workflow automation、integrations、agency workspaces"],
    ]
    story += [styled_table(repo, [32 * mm, 75 * mm, 67 * mm], styles)]
    story += [P("8.1 GitHub 增长飞轮", styles, "H2")]
    for item in [
        "每周发布一份公开 Pain Report：热门 repo、细分 SaaS、Amazon 类目或增长问题。",
        "维护 Failure Gallery：真实阻断、假成功、静默脏数据和修复前后 benchmark。",
        "Recipe Bounty：高需求站点必须带 fixture、success validator 和成本数据，不能只交 selector。",
        "Provider Shootout：同一合法测试集对比本地 Chrome、Browserbase、Steel、Bright Data 等成功率与成本。",
        "Directory Freshness Index：记录站点最后验证、字段变化、人工介入率和可见 listing 状态。",
        "让报告页可分享和索引，但原始证据包可下载，形成 SEO 与开发者信任。",
    ]:
        story.append(bullet(item, styles))
    story += [P("8.2 开源护城河", styles, "H2")]
    story += [P("真正难复制的不是 core 代码，而是 recipe fixtures、失败截图、domain/provider 成功率、修复时长、post-condition validators、目录质量与用户执行结果。代码带来采用，失败语料和运营网络带来持续优势。", styles, "Quote"), PageBreak()]

    story += [P("9. 商业模式：按责任与结果分层", styles, "H1")]
    pricing = [
        ["层级", "建议价格", "能力", "为什么会付费"],
        ["Open Source", "$0", "CLI、local Chrome/CDP、基础 recipes、Markdown/JSONL、BYO providers", "数据在本地、可扩展、先体验结果"],
        ["Solo", "$29/月", "hosted runs、scheduler、历史、基础 proxy credits、PDF", "不维护浏览器、cron 和报告"],
        ["Growth", "$99/月", "更多并发、多个 workflows、session vault、webhooks、priority recipes", "持续研究和增长执行"],
        ["Agency", "$299/月", "多客户、白标、批量 campaign、团队 human queue、权限", "把重复交付转成毛利"],
        ["Execution", "按用量", "browser minutes、proxy/provider、model、managed handoff", "透明传递变动成本"],
        ["Listing Care", "$49-$149/月", "approval/index/live 监控、资料更新、失效重跑、referral 归因", "把一次性提交转为持续增长资产"],
        ["Recipe Market", "20%-30% 抽成", "高价值站点、行业 pack、维护 SLA", "扩大供给并激励维护者"],
    ]
    story += [styled_table(pricing, [28 * mm, 24 * mm, 76 * mm, 46 * mm], styles)]
    story += [P("9.1 不要复制竞品的纯 credits 黑箱", styles, "H2")]
    story += [P("竞品普遍用 credits、hours、GB、tokens 计费，用户很难提前知道一个 campaign 会花多少。你的 dashboard 应同时显示底层消耗和业务结果，例如“30 站 campaign：21 verified、5 waiting-human、4 failed；成本 $8.40；人工 38 分钟”。", styles)]
    story += [P("9.2 单位经济", styles, "H2")]
    economics = [
        ["指标", "定义", "早期要求"],
        ["Cost per verified completion", "browser + proxy + model + human / verified tasks", "按 domain 和 recipe 分拆"],
        ["Human minutes per 100 tasks", "人工接管总分钟 / 总任务 * 100", "每个版本持续下降"],
        ["Repair cost per recipe", "每月修复与回归工时", "高频 recipe <2 小时/月为目标"],
        ["Completion gross margin", "收入减执行变动成本", "托管层成熟后 >70%"],
        ["Two-week reuse", "两周内再次运行有效任务", "Pain Miner ≥40%"],
    ]
    story += [styled_table(economics, [49 * mm, 73 * mm, 52 * mm], styles), PageBreak()]

    # Roadmap
    story += [P("10. 30 天 MVP 与 90 天路线", styles, "H1")]
    mvp = [
        ["周期", "构建", "完成线"],
        ["第 1 周", "runtime core：task/attempt/step/artifact/handoff；checkpoint；预算", "任务中断后恢复；重复运行幂等；每步有状态"],
        ["第 2 周", "Pain Miner：GitHub Issues + 用户导入；去重、证据、Markdown", "500 条；≥95% 结论有来源；模型不读全量"],
        ["第 3 周", "Submission Runner：10-30 目录 recipes；知识库；上传；验证；handoff", "30 个站全部有最终状态；假成功可被发现"],
        ["第 4 周", "开源 README、Docker、Skill、3 个 benchmark、waitlist/预购", "10 分钟 demo；50 次真实运行；3 个付费/预购"],
    ]
    story += [styled_table(mvp, [26 * mm, 83 * mm, 65 * mm], styles)]
    story += [P("10.1 90 天路线", styles, "H2")]
    ninety = [
        ["阶段", "产品", "分发", "商业"],
        ["0-30 天", "GitHub Pain Miner + 30 目录 + local Chrome lane", "公开 repo、3 份报告、Failure Gallery", "$29 founder plan 预购"],
        ["31-60 天", "Reddit/X adapter、provider routing、session vault、weekly diff", "recipe bounties、provider shootout、目录指数", "10 个 design partners、usage credits"],
        ["61-90 天", "hosted scheduler、team human queue、history、30+ recipes", "案例、marketplace beta、SEO 报告页", "5-10 hosted payers、1-3 agency"],
    ]
    story += [styled_table(ninety, [25 * mm, 65 * mm, 48 * mm, 36 * mm], styles)]
    story += [P("10.2 三个公开 benchmark", styles, "H2")]
    benchmarks = [
        ["Benchmark", "测试集", "公开指标"],
        ["Pain 500", "500 条 Issues/帖子", "覆盖、去重、token、引用完整度、运行成本"],
        ["Directory 30", "30 个真实目录", "verified/waiting/failed、人工分钟、恢复率、7 天上线率"],
        ["Protected 100", "100 个经授权的受保护页面", "各 lane 成功率、升级次数、proxy GB、假数据检测"],
    ]
    story += [styled_table(benchmarks, [37 * mm, 59 * mm, 78 * mm], styles)]
    story += [callout("30 天最重要的结果不是做出 dashboard，而是拿出一张竞争对手难以回避的表：同一批任务，我们完成了多少、失败在哪里、恢复了多少、花了多少钱。", styles, GREEN), PageBreak()]

    # Risk
    story += [P("11. 风险：作为架构与单位经济输入", styles, "H1")]
    risks = [
        ["风险", "怎么进入产品", "什么时候真的改变方向"],
        ["平台和页面变化", "adapter、recipe version、fixture、repair queue、单源收入上限", "高价值 recipe 长期修复成本超过收入"],
        ["CAPTCHA/反爬升级", "lane escalation、provider routing、budget、human handoff", "成功任务成本高于用户愿付价格"],
        ["账号/session 风险", "profile isolation、health check、explicit reset、least storage", "用户无法稳定复用身份且无替代路径"],
        ["批量低价值", "quality score、verified listing、7/30 天复查、用户策略配置", "用户看到真实结果后仍不复用或付费"],
        ["静默脏数据", "cross-path sample、schema checks、source artifact、confidence", "关键字段错误率无法达到业务阈值"],
        ["云成本", "按成功任务核算、缓存、cheap-first routing、usage credits", "成熟后毛利仍低于可持续水平"],
    ]
    story += [styled_table(risks, [39 * mm, 77 * mm, 58 * mm], styles)]
    story += [P("11.1 本报告保留的执行边界", styles, "H2")]
    story += [P("报告提供的是提高通过率的产品架构、运行分层、供应商组合、状态恢复与验证体系，不提供账号农场、验证码破解、隐蔽指纹伪造或规避安全控制的操作手册。这不会削弱商业判断，因为成熟竞品本身已经证明：用户付费购买的是托管能力、成本控制和结果，而不是一段无法长期保持的技巧。", styles)]
    story += [callout("保持你的 idea：不要把困难的平台从产品里删掉；把每种困难变成一个有状态、有成本、有恢复路径、有成功证据的产品对象。", styles, BLUE), PageBreak()]

    # Brief
    story += [P("12. 一页创始人决策 Brief", styles, "H1")]
    brief = [
        ["项目", "结论"],
        ["是否做", "强 GO，现在开始"],
        ["工作名", "GrowthCrawler / CrawlOps / PainOps"],
        ["一句话", "开源的高完成率增长爬虫：穿过阻断、批量执行、保存证据，并把数据继续转成增长动作"],
        ["首发 ICP", "独立开发者、micro-SaaS 创始人、SEO freelancer、小型 agency"],
        ["Recipe 1", "Pain Miner：Reddit/X/GitHub Issues -> Evidence Ledger -> Pain Report -> SEO Brief"],
        ["Recipe 2", "Submission Runner：Knowledge Vault -> 30-200 targets -> verify/handoff/resume -> listing report"],
        ["核心 moat", "recipes + fixtures + failure corpus + success validators + domain/provider telemetry + repair speed"],
        ["开源", "runtime core、local Chrome/CDP、基础 connectors、Markdown/JSONL、sample recipes"],
        ["收费", "hosted browsers、proxy routing、session vault、scheduler、teams、human queue、repair SLA、credits"],
        ["北极星", "verified task completion rate；cost per verified completion；human minutes/100 tasks"],
        ["30 天过线", "Pain 500；Directory 30；50 次成功运行；3 个付费/预购"],
        ["不先做", "大而全 Firecrawl clone、全球代理网络、十个垂直场景、重 dashboard"],
    ]
    story += [styled_table(brief, [34 * mm, 140 * mm], styles)]
    story += [Spacer(1, 5 * mm), callout("最关键的战略变化：从“网页抓取成功”升级为“业务任务被验证完成”。这一层既连接了反爬、批量提交和上下文压缩，也提供了开源增长之后最自然的付费点。", styles, GREEN), PageBreak()]

    # Sources
    story += [P("附录 A：完整证据来源", styles, "H1")]
    story += [P(f"共 {n_sources} 个来源：原始 40 个来源完整保留，新增 {n_new} 个 Chrome/CDP 验证来源。社区与搜索索引证据用于确认痛点模式；官方页面用于定价、规模、融资和功能事实。所有链接可点击。", styles)]
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
    story += [Spacer(1, 4 * mm), P("证据文件：research/evidence_ledger.csv + research/evidence_additions_v3.csv；生成脚本：generate_report_v3.py。", styles, "Caption")]
    return story


def main() -> None:
    register_fonts()
    sources, source_map = load_all_sources()
    styles = build_styles()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = V3DocTemplate(
        str(OUT),
        pagesize=(PAGE_W, PAGE_H),
        title="AI 爬虫与批量增长自动化 SaaS - Chrome 深度验证版",
        author="OpenAI Codex",
        subject="反爬通过率、批量提交、垂直抓取、用户极痛问题、竞品与市场验证",
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
    )
    doc.multiBuild(build_story(sources, source_map, styles))
    print(OUT)


if __name__ == "__main__":
    main()
