#!/usr/bin/env python3
"""Generate the Chinese market-validation report PDF from the evidence ledger."""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.fonts import addMapping
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    LongTable,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parent
LEDGER = ROOT / "research" / "evidence_ledger.csv"
OUT = ROOT / "output" / "pdf" / "AI爬虫与洞察SaaS创业机会深度验证报告.pdf"

PAGE_W, PAGE_H = A4
MARGIN_X = 18 * mm
MARGIN_TOP = 18 * mm
MARGIN_BOTTOM = 17 * mm

NAVY = colors.HexColor("#0B1220")
INK = colors.HexColor("#172033")
MUTED = colors.HexColor("#5F6B7A")
LIGHT = colors.HexColor("#F4F7FB")
LINE = colors.HexColor("#D8E0EA")
BLUE = colors.HexColor("#246BFD")
CYAN = colors.HexColor("#16B8C4")
GREEN = colors.HexColor("#13A06F")
AMBER = colors.HexColor("#E59A16")
RED = colors.HexColor("#D84A4A")
PURPLE = colors.HexColor("#7557D3")
WHITE = colors.white


def register_fonts() -> None:
    regular = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
    bold = "/System/Library/Fonts/STHeiti Medium.ttc"
    if not os.path.exists(regular):
        raise FileNotFoundError(f"Missing CJK font: {regular}")
    pdfmetrics.registerFont(TTFont("CJK", regular))
    if os.path.exists(bold):
        try:
            pdfmetrics.registerFont(TTFont("CJK-Bold", bold, subfontIndex=0))
        except Exception:
            pdfmetrics.registerFont(TTFont("CJK-Bold", regular))
    else:
        pdfmetrics.registerFont(TTFont("CJK-Bold", regular))
    addMapping("CJK", 0, 0, "CJK")
    addMapping("CJK", 1, 0, "CJK-Bold")


@dataclass
class Source:
    id: str
    platform: str
    date: str
    title: str
    url: str
    evidence_type: str
    theme: str
    signal: str
    confidence: str


def load_sources() -> tuple[list[Source], dict[str, Source]]:
    with LEDGER.open(newline="", encoding="utf-8-sig") as f:
        rows = [Source(**row) for row in csv.DictReader(f)]
    return rows, {row.id: row for row in rows}


class ReportDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, **kwargs)
        cover_frame = Frame(0, 0, PAGE_W, PAGE_H, id="cover", showBoundary=0)
        body_frame = Frame(
            MARGIN_X,
            MARGIN_BOTTOM,
            PAGE_W - 2 * MARGIN_X,
            PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
            id="body",
            showBoundary=0,
        )
        self.addPageTemplates(
            [
                PageTemplate(id="cover", frames=[cover_frame], onPage=self._cover_page),
                PageTemplate(id="body", frames=[body_frame], onPage=self._body_page),
            ]
        )

    def _cover_page(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(NAVY)
        canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
        canvas.setFillColor(BLUE)
        canvas.circle(PAGE_W - 30 * mm, PAGE_H - 26 * mm, 34 * mm, stroke=0, fill=1)
        canvas.setFillColor(CYAN)
        canvas.circle(PAGE_W - 5 * mm, PAGE_H - 45 * mm, 18 * mm, stroke=0, fill=1)
        canvas.setStrokeColor(colors.Color(1, 1, 1, alpha=0.12))
        canvas.setLineWidth(0.5)
        for i in range(7):
            y = 38 * mm + i * 13 * mm
            canvas.line(18 * mm, y, PAGE_W - 18 * mm, y)
        canvas.restoreState()

    def _body_page(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN_X, PAGE_H - 12 * mm, PAGE_W - MARGIN_X, PAGE_H - 12 * mm)
        canvas.setFont("CJK", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_X, PAGE_H - 9.5 * mm, "AI 爬虫与洞察 SaaS 创业机会深度验证")
        canvas.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 9.5 * mm, "2026-08-17")
        canvas.line(MARGIN_X, 11 * mm, PAGE_W - MARGIN_X, 11 * mm)
        canvas.drawString(MARGIN_X, 7 * mm, "证据型研究报告 · 社区信号为定性样本")
        canvas.drawRightString(PAGE_W - MARGIN_X, 7 * mm, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            style_name = flowable.style.name
            if style_name in ("H1", "H2"):
                level = 0 if style_name == "H1" else 1
                text = flowable.getPlainText()
                key = f"h-{self.seq.nextf('heading')}"
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=level, closed=False)
                self.notify("TOCEntry", (level, text, self.page, key))


class EvidenceBar(Flowable):
    def __init__(self, label: str, value: int, max_value: int = 14, color=BLUE):
        super().__init__()
        self.label = label
        self.value = value
        self.max_value = max_value
        self.color = color
        self.width = 165 * mm
        self.height = 10 * mm

    def draw(self):
        c = self.canv
        c.setFont("CJK", 8.5)
        c.setFillColor(INK)
        c.drawString(0, 5.2 * mm, self.label)
        bar_x = 56 * mm
        bar_y = 4.4 * mm
        bar_w = 96 * mm
        bar_h = 3.2 * mm
        c.setFillColor(colors.HexColor("#E9EEF6"))
        c.roundRect(bar_x, bar_y, bar_w, bar_h, 1.6 * mm, stroke=0, fill=1)
        c.setFillColor(self.color)
        c.roundRect(bar_x, bar_y, bar_w * self.value / self.max_value, bar_h, 1.6 * mm, stroke=0, fill=1)
        c.setFont("CJK-Bold", 8.5)
        c.setFillColor(self.color)
        c.drawRightString(164 * mm, 5.2 * mm, f"{self.value} 个证据页")


class ProductPipeline(Flowable):
    def __init__(self):
        super().__init__()
        self.width = 174 * mm
        self.height = 52 * mm

    def draw(self):
        c = self.canv
        boxes = [
            ("合规连接器", "GitHub / HN / RSS\n授权数据导入"),
            ("证据层", "JSONL + 哈希\n来源与时间"),
            ("信号层", "去重 / 聚类\n强度与置信度"),
            ("行动层", "产品机会\nSEO / 监控"),
        ]
        x = 0
        box_w = 37 * mm
        gap = 8 * mm
        for i, (title, body) in enumerate(boxes):
            fill = [BLUE, CYAN, PURPLE, GREEN][i]
            c.setFillColor(colors.Color(fill.red, fill.green, fill.blue, alpha=0.10))
            c.setStrokeColor(fill)
            c.roundRect(x, 9 * mm, box_w, 31 * mm, 3 * mm, stroke=1, fill=1)
            c.setFillColor(fill)
            c.setFont("CJK-Bold", 9)
            c.drawCentredString(x + box_w / 2, 31 * mm, title)
            c.setFillColor(INK)
            c.setFont("CJK", 7.5)
            lines = body.split("\n")
            c.drawCentredString(x + box_w / 2, 23 * mm, lines[0])
            c.drawCentredString(x + box_w / 2, 17 * mm, lines[1])
            if i < len(boxes) - 1:
                ax = x + box_w + 1.5 * mm
                c.setStrokeColor(MUTED)
                c.setFillColor(MUTED)
                c.line(ax, 24.5 * mm, ax + 5 * mm, 24.5 * mm)
                c.line(ax + 5 * mm, 24.5 * mm, ax + 3 * mm, 26 * mm)
                c.line(ax + 5 * mm, 24.5 * mm, ax + 3 * mm, 23 * mm)
            x += box_w + gap


def build_styles():
    base = getSampleStyleSheet()
    styles = {}
    styles["CoverKicker"] = ParagraphStyle(
        "CoverKicker", fontName="CJK-Bold", fontSize=11, leading=14, textColor=CYAN,
        leftIndent=20 * mm, rightIndent=20 * mm, spaceBefore=52 * mm,
    )
    styles["CoverTitle"] = ParagraphStyle(
        "CoverTitle", fontName="CJK-Bold", fontSize=28, leading=37, textColor=WHITE,
        leftIndent=20 * mm, rightIndent=24 * mm, spaceBefore=8 * mm,
    )
    styles["CoverSub"] = ParagraphStyle(
        "CoverSub", fontName="CJK", fontSize=12, leading=20, textColor=colors.HexColor("#C9D4E4"),
        leftIndent=20 * mm, rightIndent=24 * mm, spaceBefore=8 * mm,
    )
    styles["CoverMeta"] = ParagraphStyle(
        "CoverMeta", fontName="CJK", fontSize=9, leading=15, textColor=colors.HexColor("#9FB0C6"),
        leftIndent=20 * mm, rightIndent=24 * mm, spaceBefore=38 * mm,
    )
    styles["H1"] = ParagraphStyle(
        "H1", fontName="CJK-Bold", fontSize=21, leading=28, textColor=NAVY,
        spaceBefore=5 * mm, spaceAfter=4 * mm, keepWithNext=True,
    )
    styles["H2"] = ParagraphStyle(
        "H2", fontName="CJK-Bold", fontSize=14, leading=20, textColor=BLUE,
        spaceBefore=4 * mm, spaceAfter=2 * mm, keepWithNext=True,
    )
    styles["H3"] = ParagraphStyle(
        "H3", fontName="CJK-Bold", fontSize=10.5, leading=15, textColor=INK,
        spaceBefore=3 * mm, spaceAfter=1.5 * mm, keepWithNext=True,
    )
    styles["Body"] = ParagraphStyle(
        "Body", fontName="CJK", fontSize=9.2, leading=15.5, textColor=INK,
        spaceAfter=2.2 * mm, wordWrap="CJK",
    )
    styles["BodySmall"] = ParagraphStyle(
        "BodySmall", fontName="CJK", fontSize=7.7, leading=11.5, textColor=INK,
        spaceAfter=1.2 * mm, wordWrap="CJK",
    )
    styles["Bullet"] = ParagraphStyle(
        "Bullet", parent=styles["Body"], leftIndent=5 * mm, firstLineIndent=-3.2 * mm,
        bulletIndent=0, spaceAfter=1.4 * mm,
    )
    styles["Quote"] = ParagraphStyle(
        "Quote", fontName="CJK", fontSize=9, leading=15, textColor=INK,
        leftIndent=6 * mm, rightIndent=5 * mm, borderColor=BLUE, borderWidth=0,
        borderPadding=(3 * mm, 4 * mm, 3 * mm, 5 * mm), backColor=LIGHT,
        spaceBefore=2 * mm, spaceAfter=2 * mm,
    )
    styles["Callout"] = ParagraphStyle(
        "Callout", fontName="CJK-Bold", fontSize=10.2, leading=17, textColor=NAVY,
        leftIndent=1 * mm, rightIndent=1 * mm,
    )
    styles["TableHead"] = ParagraphStyle(
        "TableHead", fontName="CJK-Bold", fontSize=7.6, leading=10, textColor=WHITE,
        alignment=TA_LEFT, wordWrap="CJK",
    )
    styles["TableCell"] = ParagraphStyle(
        "TableCell", fontName="CJK", fontSize=7.2, leading=10.5, textColor=INK,
        wordWrap="CJK",
    )
    styles["TableCellBold"] = ParagraphStyle(
        "TableCellBold", fontName="CJK-Bold", fontSize=7.3, leading=10.5, textColor=INK,
        wordWrap="CJK",
    )
    styles["Caption"] = ParagraphStyle(
        "Caption", fontName="CJK", fontSize=7, leading=10, textColor=MUTED,
        spaceBefore=1 * mm, spaceAfter=3 * mm,
    )
    styles["TOCHeading"] = ParagraphStyle(
        "TOCHeading", fontName="CJK-Bold", fontSize=12, leading=16, textColor=INK,
        leftIndent=0, firstLineIndent=0, spaceAfter=2 * mm,
    )
    return styles


def P(text: str, styles, style="Body") -> Paragraph:
    return Paragraph(text, styles[style])


def bullet(text: str, styles) -> Paragraph:
    return Paragraph(f"• {text}", styles["Bullet"])


def source_ref(ids: list[str], source_map: dict[str, Source]) -> str:
    out = []
    for sid in ids:
        s = source_map[sid]
        out.append(f'<link href="{s.url}" color="#246BFD">[{sid}]</link>')
    return " ".join(out)


def callout(text: str, styles, color=BLUE) -> Table:
    tbl = Table([[P(text, styles, "Callout")]], colWidths=[174 * mm])
    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.Color(color.red, color.green, color.blue, alpha=0.09)),
                ("BOX", (0, 0), (-1, -1), 0.8, color),
                ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
            ]
        )
    )
    return tbl


def styled_table(data, col_widths, styles, header=True, row_bgs=True, font_size=None):
    cooked = []
    for r, row in enumerate(data):
        cooked.append(
            [
                cell if isinstance(cell, Flowable) else P(str(cell), styles, "TableHead" if r == 0 and header else "TableCell")
                for cell in row
            ]
        )
    tbl = LongTable(cooked, colWidths=col_widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.2 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2.2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2 * mm),
    ]
    if header:
        commands += [("BACKGROUND", (0, 0), (-1, 0), NAVY)]
    if row_bgs:
        for i in range(1 if header else 0, len(cooked)):
            if i % 2 == 0:
                commands.append(("BACKGROUND", (0, i), (-1, i), LIGHT))
    tbl.setStyle(TableStyle(commands))
    return tbl


def metric_cards(styles):
    items = [
        ("结论", "有条件 GO", GREEN),
        ("推荐方向", "证据到增长", BLUE),
        ("第一数据源", "GitHub Issues", CYAN),
        ("核心禁区", "反爬绕过即产品", RED),
    ]
    cells = []
    for title, value, color in items:
        content = P(f'<font color="{color.hexval()}"><b>{title}</b></font><br/><font size="11"><b>{value}</b></font>', styles, "BodySmall")
        cells.append(content)
    tbl = Table([cells], colWidths=[42.5 * mm] * 4)
    ts = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
    ]
    tbl.setStyle(TableStyle(ts))
    return tbl


def build_story(sources: list[Source], source_map: dict[str, Source], styles):
    story = []
    refs = lambda *ids: source_ref(list(ids), source_map)

    # Cover
    story += [
        P("DEEP VALIDATION REPORT · 2026", styles, "CoverKicker"),
        P("AI 爬虫与洞察 SaaS<br/>创业机会深度验证", styles, "CoverTitle"),
        P("Firecrawl 增长拆解 × GitHub Issues / Reddit / X 用户痛点 × 竞品与市场进入策略", styles, "CoverSub"),
        P("为 Howard 制作<br/>研究日期：2026 年 8 月 17 日<br/>证据集：40 个官方、社区、Issue 与竞品页面", styles, "CoverMeta"),
        NextPageTemplate("body"),
        PageBreak(),
    ]

    # TOC
    story += [P("目录", styles, "H1")]
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(fontName="CJK-Bold", name="TOC1", fontSize=9.5, leading=15, textColor=INK, leftIndent=0, firstLineIndent=0, spaceBefore=2 * mm),
        ParagraphStyle(fontName="CJK", name="TOC2", fontSize=8, leading=12, textColor=MUTED, leftIndent=5 * mm, firstLineIndent=0),
    ]
    story += [toc, Spacer(1, 5 * mm), callout("阅读顺序建议：先看执行摘要与机会评分；再看合规风险；最后用 90 天计划决定是否进入产品开发。", styles, CYAN), PageBreak()]

    # Executive summary
    story += [P("0. 执行摘要", styles, "H1"), metric_cards(styles), Spacer(1, 4 * mm)]
    story += [
        callout("最终判断：这个方向值得做，但不应该做成“更小的 Firecrawl”，也不应该把“绕过 Reddit/X/Cloudflare”当成产品护城河。最有胜率的切口是：把合规获取的公开问题数据，压缩成有出处、可去重、能直接驱动产品与 SEO 的证据工作流。", styles, GREEN),
        P("Firecrawl 已证明“网页 → 干净、LLM-ready 上下文”是一个巨大且高速增长的基础设施市场：其官网与仓库在本次调研时显示约 168K stars，官方还披露 1.25M 开发者、150K+ 公司与 5B+ 请求。它从 Mendable 的内部数据摄取问题出发，三个月拿到 8K+ stars，随后通过 YC Launch、模板、集成、DevRel 和托管可靠性完成开源到云服务的飞轮。" + refs("S01", "S03", "S04", "S05"), styles),
        P("但横向爬虫基础设施已经非常拥挤：Firecrawl、Apify、Crawl4AI、Bright Data 分别在 LLM 上下文 API、Actor 市场、开源 Python 爬虫、代理/CAPTCHA/垂直数据集上形成强势位置。直接复制其能力，既要承担代理、浏览器、队列、解析与反爬维护，又缺乏明显分发优势。" + refs("S05", "S38", "S39", "S40"), styles),
        P("真正的市场缺口在“抓完之后”：独立开发者并不只想得到 10,000 条帖子，而是想知道哪 5 个痛点最值得做、哪些竞品缺口有重复证据、下一篇 SEO 内容写什么、哪些结论来自哪些原帖。GummySearch 的 140K+ 历史用户与 $29-$199/月定价、Syften 与 F5Bot 的持续收费和大规模提醒量，都验证了社区洞察的需求与付费意愿。" + refs("S34", "S35", "S36", "S37"), styles),
        P("最大风险同样非常明确：GummySearch 因 Reddit API 商业政策关闭；Reddit 当前条款要求商业使用另行协议；X 官方规范明确禁止 scraping/browser automation。故 Reddit/X 必须走商业授权、官方 API、合规数据供应商或用户主动导入，不能靠反爬绕过作为 SaaS 核心。" + refs("S30", "S31", "S35"), styles),
    ]
    story += [P("建议的第一性选择", styles, "H2")]
    for text in [
        "第一版只做 <b>GitHub Issues + Hacker News + Discourse/RSS</b>；这几类数据更稳定、更适合开发者 ICP，且 GitHub 官方 API 的认证额度可达 5,000 请求/小时。" + refs("S32"),
        "产品形态采用 <b>CLI + Skill</b>：本地保存 JSONL/Markdown，天然避免把全量数据塞进模型上下文；MCP 等到工具路由和上下文预算成熟后再加。",
        "核心输出不是爬取结果，而是 <b>Evidence Ledger → Pain Clusters → Opportunity Score → Growth Pack</b>，每个结论都能回到原帖。",
        "SEO 方向先做“选题、比较页、用户问题库、证据引用与监控”；外链提交仅作为后续的人机协同工作流，不做 CAPTCHA 绕过和批量低质提交。" + refs("S25", "S33"),
    ]:
        story.append(bullet(text, styles))
    story += [PageBreak()]

    # Methodology
    story += [P("1. 研究设计与证据口径", styles, "H1")]
    story += [
        P("本报告通过 Chrome 在 2026-08-17 访问或检索 40 个页面，覆盖 Firecrawl 官方站、GitHub 仓库与 Issues、Reddit 原帖、X 原帖、平台条款和竞品定价。社区证据用于发现模式，不等同于总体市场比例；官方条款与官方产品页被赋予更高权重。", styles),
        P("研究问题", styles, "H2"),
    ]
    research_questions = [
        "Firecrawl 为什么能增长？哪些机制可复制，哪些是资本与基础设施壁垒？",
        "用户在 Amazon、Reddit、X、GitHub Issues 和 Browser/Computer Use 中遇到的具体失败是什么？",
        "现有竞品是在卖抓取、提醒、洞察，还是最终增长行动？",
        "哪个 MVP 既能快速开源获客，又不把平台政策和 CAPTCHA 运维变成致命依赖？",
        "哪些证据支持 GO，哪些反证要求缩小或改变方向？",
    ]
    for q in research_questions:
        story.append(bullet(q, styles))
    story += [P("证据评级", styles, "H2")]
    rating_data = [
        ["等级", "适用证据", "本报告如何使用"],
        ["高", "官方产品/条款；同一主题 3+ 独立来源", "可支撑方向性决策"],
        ["中", "2 个来源或单一细分群体内一致", "可支撑 MVP 假设，仍需付费测试"],
        ["低", "单条帖子、回复或搜索索引片段", "只作线索，不单独下结论"],
    ]
    story += [styled_table(rating_data, [23 * mm, 68 * mm, 83 * mm], styles)]
    story += [P("样本局限", styles, "H2")]
    for text in [
        "Reddit/X/GitHub Issue 用户偏技术、偏负面；这能高效暴露故障，但不能推断所有买家的平均满意度。",
        "部分 GitHub Issue 详情页在调研中短暂返回服务错误，因此使用 Chrome 搜索索引片段核对标题与问题摘要；报告保留直接 Issue URL。",
        "尚未完成真实客户访谈、落地页转化或预付款测试；所以这是“值得进入验证”的判断，不是 PMF 结论。",
        "市场规模使用底层付费与转化情景，不引用宽泛的 web-scraping 行业 TAM。",
    ]:
        story.append(bullet(text, styles))
    story += [PageBreak()]

    # Pain evidence
    story += [P("2. 用户痛点：频率 × 强度 × 可付费性", styles, "H1")]
    story += [
        P("下图是对证据台账的主题编码。数字代表本次样本中支持该主题的独立页面数，不能理解为市场发生率；它用于比较痛点的相对密度。", styles),
        EvidenceBar("反爬 / CAPTCHA / 账号安全", 13, color=RED),
        EvidenceBar("限流 / 登录 / 封闭平台", 11, color=AMBER),
        EvidenceBar("可靠性 / 覆盖 / 维护", 10, color=PURPLE),
        EvidenceBar("代理 / 浏览器 / credits 成本", 8, color=BLUE),
        EvidenceBar("数据压缩与可行动输出", 7, color=CYAN),
        EvidenceBar("外链提交质量与可维护性", 4, color=GREEN),
        P("主题计数来自 research/evidence_ledger.csv 的人工编码与交叉归类。", styles, "Caption"),
    ]
    story += [P("2.1 反爬不是一个 bug，而是一条持续运维曲线", styles, "H2")]
    story += [
        P("Amazon 讨论显示，即使是每 3-5 分钟一次的低频抓取，也可能从“偶尔 CAPTCHA”演化为“Python 请求全部 CAPTCHA”；用户随后面对 Selenium、TLS 指纹、住宅代理、验证码处理和会话预热等一整套复杂性。另一个 300 商品样本需要约 3 小时并仍在 30-50 次连续请求后被封。" + refs("S16", "S17"), styles),
        P("跨站点从业者把 Cloudflare、webdriver/TLS 指纹、代理成本和 DOM 变化并列为最难问题，并指出长期维护可能显著高于初次开发成本。" + refs("S18", "S20", "S26"), styles),
        P("<b>产品含义：</b>不要承诺“永不被封”。更可售卖的是成功率、重试透明度、成本上限、失败原因分类、人工接管与数据完整性评分。", styles, "Quote"),
    ]
    story += [P("2.2 平台登录与账号风险比纯抓取更难", styles, "H2")]
    story += [
        P("X 的开源生态反复出现 403、限流、账号锁定与即时封号；Reddit 的 PRAW/PRAWCore 也有 429 和分页/并发边界。这里的失败对象不是某一段 XPath，而是账号、IP、身份、API 层级和平台政策共同作用。" + refs("S10", "S11", "S12", "S13", "S14", "S15"), styles),
        P("Firecrawl 自身也出现“如何登录 Amazon 后再抓取”的 Issue，说明通用 scrape endpoint 与带认证、多步骤、可恢复的业务流程之间仍有距离。" + refs("S07"), styles),
        P("<b>产品含义：</b>封闭平台应作为合规连接器问题，而不是反爬技术问题；官方 API、商业授权、用户导入和第三方许可数据优先。", styles, "Quote"),
    ]
    story += [P("2.3 干净 Markdown 仍会空、漏、错；完整性比速度更值钱", styles, "H2")]
    story += [
        P("Firecrawl Issue 显示同一 URL 在托管版可返回 Markdown，而自托管版可能为空；X 用户也反馈“速度并未带来覆盖”，在实验室报告上失败。" + refs("S08", "S09", "S28"), styles),
        P("这类痛点对 AI 更危险：空结果容易发现，部分缺失、表格错位和静默分类错误却会直接污染下游结论。", styles),
        P("<b>产品含义：</b>你的差异化不应只是 Markdown 输出，而要包含 coverage score、字段缺失检测、原文锚点、重复证据数和低置信度提示。", styles, "Quote"),
    ]
    story += [P("2.4 上下文和 credits 的问题，本质是工具路由失控", styles, "H2")]
    story += [
        P("Firecrawl 宣称清理页面可减少 93% 模型输入 token，这说明上下文压缩本身有明确价值。与此同时，2026 年一位 X 用户投诉 agent instructions 让工具总是优先调用 Firecrawl，导致不必要的 credits 消耗，且用户无法覆盖路由规则。" + refs("S01", "S27"), styles),
        P("<b>产品含义：</b>Skill/CLI 应默认“先索引、后取证、最后摘要”，提供预算、缓存与 dry-run；MCP 不能一次暴露大 schema 或把原始语料回灌模型。", styles, "Quote"),
    ]
    story += [P("2.5 SEO 外链提交：操作痛，但价值密度更低", styles, "H2")]
    story += [
        P("社区确实有人抱怨外链列表一半不可用，并希望在手工 citation 与工具之间找到平衡。但更一致的建议是：只做少数本地/垂直高质量目录，保留账号编辑权；“一次提交 200 个目录”反而被视为应当远离的信号。" + refs("S23", "S24", "S25"), styles),
        P("Google 当前政策把自动程序创建链接和低质量目录链接明确列为 link spam。" + refs("S33"), styles),
        callout("结论：外链提交自动化可以是“高质量目录筛选 + 资料预填 + 状态跟踪 + CAPTCHA/邮箱验证时人工接管”的辅助功能；不适合成为第一款产品，更不适合用“成功提交数量”作为核心价值指标。", styles, AMBER),
    ]
    story += [PageBreak()]

    # Firecrawl case
    story += [P("3. Firecrawl 是怎么做起来的", styles, "H1")]
    story += [
        P("Firecrawl 的增长不是从“做一个万能爬虫”开始，而是从 Mendable 的文档问答业务中发现重复基础设施问题：清洗网页、渲染 JavaScript、处理限流、解析 HTML。这使它一开始就拥有真实的内部客户和明确的上游价值。" + refs("S03"), styles),
        P("3.1 增长时间线", styles, "H2"),
    ]
    timeline = [
        ["阶段", "公开里程碑", "可复制的动作"],
        ["问题发现", "Mendable 反复遇到网页数据摄取难题", "先服务自己的工作流，确保输出可被下游 AI 使用"],
        ["开源起量", "约 3 个月、8K+ GitHub stars", "极简定位、README 快速开始、透明代码与免费自托管"],
        ["分发放大", "2024-07 YC Launch", "模板、案例、社区作品、DevRel 与生态集成"],
        ["商业验证", "2025-08：350K 开发者、48K stars、15x 年增长", "托管可靠性、速度、批处理、监控与企业能力收费"],
        ["平台扩张", "2026-08：约 168K stars；search/scrape/interact/agent", "从爬虫变成 Context API，并接入 Skill/MCP/CLI"],
    ]
    story += [styled_table(timeline, [27 * mm, 58 * mm, 89 * mm], styles)]
    story += [P("3.2 开源到付费的价值切分", styles, "H2")]
    split = [
        ["开源层", "云付费层", "为什么用户愿意升级"],
        ["代码、基本抓取、可自托管", "代理、渲染、Fire-Engine、并发、监控、支持", "最贵的不是代码，而是持续成功率与运维"],
        ["Markdown / JSON 输出", "搜索、Interact、Agent、索引和批处理", "购买的是更少工程拼装与更快交付"],
        ["社区贡献与透明度", "SLA、零数据保留、SSO、企业支持", "信任与治理满足大客户采购"],
    ]
    story += [styled_table(split, [47 * mm, 63 * mm, 64 * mm], styles)]
    story += [P("3.3 你真正应该复制的 6 个机制", styles, "H2")]
    for text in [
        "从自己的重复工作开始，先成为最苛刻的第一个用户。",
        "用一个非常窄的输入输出承诺切入：给 repo/关键词，得到可引用的痛点报告。",
        "开源 core，付费卖调度、历史、团队、可靠性与合规数据接入。",
        "让示例报告本身成为内容：每个热门 repo 都能生成一个公开、可搜索的研究页。",
        "围绕真实失败做 benchmark：覆盖率、引用完整性、token 成本、重复率，而不是只比抓取速度。",
        "从 CLI/Skill 进入用户现有工作流，再扩展 MCP 与可视化，不从大而全 dashboard 起步。",
    ]:
        story.append(bullet(text, styles))
    story += [P("3.4 不应该复制的部分", styles, "H2")]
    for text in [
        "不要一开始自建全球代理与浏览器基础设施；Bright Data、Apify、Firecrawl 已把这变成资本密集型赛道。",
        "不要用 GitHub stars 代替留存和付费；开源热度是分发信号，不是单位经济。",
        "不要把“支持 Reddit/X”写成默认承诺，除非数据权利和商业协议已经确定。",
        "不要把模型调用藏在默认路由里；credits 的不透明消耗会损害信任。" + refs("S27"),
    ]:
        story.append(bullet(text, styles))
    story += [PageBreak()]

    # Competition
    story += [P("4. 竞品分析：真正拥挤的是哪一层", styles, "H1")]
    comp = [
        ["产品", "核心层", "公开价格/规模信号", "强项", "留下的缺口"],
        ["Firecrawl", "通用 Web Context API", "168K stars；credits", "LLM-ready、搜索、抓取、交互、托管可靠性", "不负责把证据变成特定业务决策"],
        ["Crawl4AI", "开源 LLM 爬虫", "78.5K stars；赞助/Cloud beta", "本地控制、Python、Markdown/结构化", "自托管运维与 anti-bot 仍由用户承担"],
        ["Apify", "Actor 平台与市场", "60K+ Actors；$0/$29/$199/$999+用量", "垂直 scraper 供给、调度、代理、开发者变现", "结果跨 Actor 不统一；洞察需另建"],
        ["Bright Data", "代理/解锁/垂直数据", "约 $1/1K 起；20K+ 客户", "CAPTCHA、渲染、Amazon/X 等现成数据", "偏基础设施与数据交付，独立开发者学习/成本重"],
        ["GummySearch", "Reddit 市场研究", "$29/$59/$199；140K+ 历史用户；已关闭", "痛点发现、AI 模式、报告", "证明需求，也暴露 Reddit 商业政策致命风险"],
        ["Syften", "社区实时监听", "$29.95/$49.95/$119.95", "多源、AI 过滤、API/Webhook/MCP", "偏 alerts，不是深度证据与增长方案"],
        ["F5Bot", "轻量关键词提醒", "$0/$9.99/$49.99；430K+ alerts/day", "便宜、稳定、简单", "历史研究、聚类、机会评分与行动输出较弱"],
    ]
    story += [styled_table(comp, [23 * mm, 31 * mm, 43 * mm, 40 * mm, 37 * mm], styles)]
    story += [P("4.1 竞争结构", styles, "H2")]
    layers = [
        ["层", "竞争强度", "典型玩家", "建议"],
        ["代理/CAPTCHA/浏览器", "极高", "Bright Data、Apify、Firecrawl", "购买或接入，不自建"],
        ["通用网页 → Markdown/JSON", "极高", "Firecrawl、Crawl4AI、Scraping APIs", "不要作为主定位"],
        ["社区监听/提醒", "中高", "Syften、F5Bot、Brand tools", "仅作为数据入口"],
        ["证据 → 产品/SEO 决策", "中低", "大量人工顾问与零散 AI 工具", "推荐切入"],
        ["合规工作流与来源治理", "低但重要", "平台条款、企业自建流程", "可形成长期壁垒"],
    ]
    story += [styled_table(layers, [37 * mm, 27 * mm, 56 * mm, 54 * mm], styles)]
    story += [callout("竞争结论：你的产品不应回答“我能爬哪个网站”，而应回答“我用哪些合法证据，帮你决定下一个产品、内容和增长动作”。", styles, BLUE)]
    story += [PageBreak()]

    # Market validation
    story += [P("5. 市场验证与机会评分", styles, "H1")]
    story += [P("评分采用 1-5 分：需求强度、付费信号、切入可行性越高越好；竞争、平台风险、运维负担越低越好。总分为本次研究的决策工具，不是统计学市场规模。", styles)]
    opp = [
        ["方向", "需求", "付费", "竞争", "平台风险", "运维", "综合判断"],
        ["通用 Firecrawl Lite", "5", "5", "1", "3", "1", "3.2/10 · 不做"],
        ["Amazon 价格/评论爬虫", "5", "5", "1", "2", "1", "4.0/10 · 仅做极窄垂直"],
        ["Reddit/X 痛点抓取 SaaS", "5", "5", "3", "1", "2", "4.6/10 · 未授权不做"],
        ["SEO 批量外链提交", "3", "3", "2", "2", "1", "2.8/10 · 不做核心"],
        ["GitHub Issue 洞察 CLI/Skill", "4", "4", "4", "5", "4", "8.3/10 · 最佳开源楔子"],
        ["合规 Research-to-Growth 平台", "5", "5", "4", "4", "3", "8.1/10 · 最佳商业方向"],
    ]
    story += [styled_table(opp, [49 * mm, 15 * mm, 15 * mm, 17 * mm, 21 * mm, 17 * mm, 40 * mm], styles)]
    story += [P("5.1 支持 GO 的证据", styles, "H2")]
    for text in [
        "基础需求巨大：Firecrawl、Crawl4AI、Apify 的开发者采用证明 AI 获取 Web Context 是基础能力。" + refs("S01", "S38", "S39"),
        "社区研究可收费：GummySearch 曾覆盖 140K+ 用户并设置 $29-$199/月；Syften、F5Bot 继续以 $9.99-$119.95/月收费。" + refs("S34", "S35", "S36", "S37"),
        "痛点高频且反复：反爬、账号、代理、维护、覆盖和成本在多个平台重复出现。" + refs("S10", "S17", "S18", "S27", "S29"),
        "开发者原生分发成立：开源 repo、CLI、Skill、模板与集成可以形成低成本试用飞轮。" + refs("S04", "S05"),
    ]:
        story.append(bullet(text, styles))
    story += [P("5.2 要求收缩方向的反证", styles, "H2")]
    for text in [
        "Reddit/X 的商业数据权利不是工程问题。GummySearch 的关闭说明：即便产品有 140K 用户，平台政策仍可归零业务。" + refs("S30", "S31", "S35"),
        "反爬基础设施已被大型玩家商品化；以绕过为护城河会陷入持续军备竞赛。" + refs("S18", "S38", "S40"),
        "通用 Markdown 输出已有 168K-star 和 78.5K-star 开源项目，差异化不足。" + refs("S05", "S39"),
        "批量目录外链存在 SEO 负价值；用户真正需要的是高质量机会筛选，而非表单完成率。" + refs("S24", "S25", "S33"),
    ]:
        story.append(bullet(text, styles))
    story += [P("5.3 底层收入情景（不是预测）", styles, "H2")]
    revenue = [
        ["情景", "活跃开源用户", "付费率", "ARPA", "对应 MRR", "意义"],
        ["早期验证", "1,000", "3%", "$29", "$870", "证明有人付费，不证明规模"],
        ["微型 SaaS", "5,000", "5%", "$49", "$12,250", "可支持小团队持续迭代"],
        ["垂直平台", "20,000", "6%", "$59", "$70,800", "需要多源、团队与历史数据"],
        ["Agency lane", "150 agencies", "—", "$249", "$37,350", "白标、客户空间与报告自动化"],
    ]
    story += [styled_table(revenue, [32 * mm, 28 * mm, 18 * mm, 19 * mm, 25 * mm, 52 * mm], styles)]
    story += [P("收入情景的作用是定义验证门槛；不能用竞品用户量直接推导你的可获得市场。", styles, "Caption"), PageBreak()]

    # MVP
    story += [P("6. 推荐产品：Research-to-Growth Copilot", styles, "H1")]
    story += [
        callout("一句话定位：输入 GitHub repos、社区关键词或已授权数据，输出一份可追溯的痛点证据库，并把高置信度信号自动转成产品机会、SEO 选题与持续监控。", styles, CYAN),
        P("6.1 为什么先做 GitHub Issues", styles, "H2"),
    ]
    for text in [
        "目标用户清晰：独立开发者、开源工具作者、DevTool PM、创业工作室。",
        "数据结构清晰：标题、正文、评论、labels、reactions、状态、仓库、时间。",
        "官方 API 可用且限额透明：认证用户一般 5,000 请求/小时，可升级为 GitHub App。" + refs("S32"),
        "购买动机直接：决定做什么、修什么、写什么，而不是“拥有更多帖子”。",
        "容易开源传播：每个热门 repo 都能生成一份带引用的公开痛点报告。",
    ]:
        story.append(bullet(text, styles))
    story += [P("6.2 MVP 数据与处理管线", styles, "H2"), ProductPipeline(), P("推荐的数据对象：", styles, "H3")]
    schema = [
        ["字段", "示例/目的"],
        ["source_id / url / fetched_at", "任何结论都能回溯原始来源与抓取时间"],
        ["author_role_hint", "维护者、贡献者、用户；只做公开且必要的角色线索"],
        ["problem / trigger / workaround", "痛点、触发事件、当前替代方案"],
        ["intensity / recurrence / recency", "情绪强度、跨来源重复、时间衰减"],
        ["buyer_fit / actionability / risk", "是否匹配 ICP、能否形成动作、平台/隐私风险"],
        ["cluster_id / duplicate_hash", "跨 Issue/评论去重，避免模型重复计数"],
    ]
    story += [styled_table(schema, [52 * mm, 122 * mm], styles)]
    story += [P("6.3 第一版命令与输出", styles, "H2")]
    commands = [
        ["命令", "作用", "输出"],
        ["signal init", "创建项目与证据预算", "project.yaml"],
        ["signal collect github owner/repo", "增量拉取 Issues/评论", "evidence.jsonl"],
        ["signal analyze --icp indie-dev", "去重、聚类、评分", "clusters.json + report.md"],
        ["signal growth-pack", "生成行动建议", "seo-briefs.md + roadmap.md"],
        ["signal diff --since 30d", "发现新增/升温痛点", "changes.md"],
    ]
    story += [styled_table(commands, [55 * mm, 66 * mm, 53 * mm], styles)]
    story += [P("6.4 上下文控制：产品必须比 Browser Use 更节省", styles, "H2")]
    for text in [
        "原始内容写入磁盘/对象存储，不进入聊天上下文。",
        "先用确定性字段和哈希去重，再调用模型。",
        "每个 cluster 只携带代表性短摘录、计数和 source IDs。",
        "提供 token/credits 预算、缓存命中、dry-run 与 provider routing。",
        "最终报告只保留结论、证据摘要和可点击链接；用户可按需展开原文。",
    ]:
        story.append(bullet(text, styles))
    story += [P("6.5 Done 标准", styles, "H2")]
    acceptance = [
        ["维度", "MVP 验收标准"],
        ["可追溯", "报告中的每个事实结论都有 source_id；链接抽查可访问"],
        ["去重", "人工抽查 100 条，重复合并/误合并率分别记录并可复现"],
        ["完整性", "显示 API pagination、缺失评论、失败重试与 coverage score"],
        ["上下文", "分析只消费代表性证据；原始 1,000 Issues 不直接塞进模型"],
        ["可恢复", "中断后从 cursor/checkpoint 继续，不重复计费"],
        ["合规", "连接器携带来源条款、保留期限与删除能力；默认最小化个人数据"],
    ]
    story += [styled_table(acceptance, [32 * mm, 142 * mm], styles), PageBreak()]

    # Form factor
    story += [P("7. Skill、MCP 还是 HTML：推荐顺序", styles, "H1")]
    format_table = [
        ["形态", "现在是否做", "优点", "风险/代价"],
        ["CLI", "第一优先", "可测试、可缓存、GitHub 原生、输出到磁盘", "需要基础命令行使用能力"],
        ["Skill", "与 CLI 同发", "让 Codex/Claude 等代理按固定证据流程调用 CLI", "Skill 指令必须可被用户覆盖，避免强制 credits"],
        ["MCP", "第二阶段", "生态兼容、工具化调用、适合 IDE/Agent", "schema/context bloat、工具路由失控、调试面更大"],
        ["Hosted HTML", "有重复使用后", "可视化趋势、团队协作、支付与留存", "太早做会把时间花在 dashboard 而非证据质量"],
    ]
    story += [styled_table(format_table, [25 * mm, 26 * mm, 61 * mm, 62 * mm], styles)]
    story += [P("推荐发布包", styles, "H2")]
    for text in [
        "GitHub 仓库：开源 connector + evidence schema + analyzer + Markdown renderer。",
        "一个 Skill：负责创建项目、调用 CLI、读取摘要、按需打开证据，不默认调用付费抓取。",
        "3 份真实示例报告：Firecrawl Issues、Crawl4AI Issues、一个独立开发者 SaaS 竞品集。",
        "一个可复制的 GitHub Action：每周更新 pain-diff，并在仓库生成 artifact，不自动发帖。",
        "MCP 只暴露紧凑工具：search_clusters、get_evidence、build_growth_pack；不暴露全量原始语料。",
    ]:
        story.append(bullet(text, styles))
    story += [callout("关键产品原则：用户可以明确控制“何时调用付费源、最多花多少 credits、哪些来源不允许访问”。Firecrawl 的 credits 投诉说明，这种可控性本身就是差异化。" + refs("S27"), styles, PURPLE), PageBreak()]

    # GTM
    story += [P("8. 开源增长、付费与 90 天路线", styles, "H1")]
    story += [P("8.1 开源增长飞轮", styles, "H2")]
    flywheel = [
        ["环节", "具体动作", "生成的新资产"],
        ["抓真实问题", "对热门开发者工具仓库生成证据报告", "可引用的公开数据页"],
        ["公开输出", "README 示例、benchmark、痛点周报", "搜索流量与社交分享"],
        ["用户复用", "CLI/Skill 一键复刻到自己的 repo", "安装、stars、issues、templates"],
        ["反馈改进", "用户提交误合并、缺失来源和新 connector", "更强 ontology 与质量数据"],
        ["付费升级", "定时任务、历史 diff、团队与合规源", "MRR 与真实留存信号"],
    ]
    story += [styled_table(flywheel, [33 * mm, 79 * mm, 62 * mm], styles)]
    story += [P("8.2 建议的付费点（用于测试，不是最终定价）", styles, "H2")]
    pricing = [
        ["层级", "建议价格", "付费价值"],
        ["Open source", "$0", "本地 GitHub connector、手动运行、Markdown/CSV 输出"],
        ["Solo", "$29/月", "定时监控、历史 diff、10 项目、托管模型预算"],
        ["Studio", "$79/月", "50 项目、团队、Slack/email、增长包、优先队列"],
        ["Agency", "$249/月", "客户空间、白标 PDF、API/webhook、审计与导出"],
        ["Licensed sources", "成本加成", "Reddit/X 等需商业协议或授权供应商的数据"],
    ]
    story += [styled_table(pricing, [35 * mm, 28 * mm, 111 * mm], styles)]
    story += [P("8.3 90 天路线", styles, "H2")]
    roadmap = [
        ["时间", "目标", "交付", "继续/停止门槛"],
        ["Day 1-14", "付费前验证", "为 10 位独立开发者手工做 GitHub 痛点报告；收 $49 或取得明确拒付理由", "至少 5 人愿意接受报告，2 人付费或预付"],
        ["Day 15-30", "开源楔子", "CLI + Skill + 3 个真实示例 + evidence schema", "30 次完整运行；链接/去重抽查通过"],
        ["Day 31-60", "重复使用", "增量更新、diff、HN/Discourse/RSS connector、Growth Pack", "≥40% 用户两周内重复运行"],
        ["Day 61-90", "托管收费", "scheduler、项目历史、团队、预算控制、账单", "至少 5 位 $29+ 付费用户；3 位要求持续监控"],
    ]
    story += [styled_table(roadmap, [23 * mm, 31 * mm, 72 * mm, 48 * mm], styles)]
    story += [P("8.4 North Star 与反指标", styles, "H2")]
    metrics = [
        ["指标类型", "应该看", "不要被迷惑"],
        ["价值", "每周被用户采纳的高置信度机会数", "抓取页数、帖子数"],
        ["留存", "项目在 14/30 天是否再次更新", "一次性报告下载"],
        ["质量", "有 3+ 独立证据的结论占比、用户确认率", "模型生成字数"],
        ["成本", "每个可采纳洞察的总数据+模型成本", "单次 API 调用价格"],
        ["增长", "公开报告 → 安装 → 完成首跑 → 周复用", "GitHub stars 单点"],
    ]
    story += [styled_table(metrics, [30 * mm, 78 * mm, 66 * mm], styles), PageBreak()]

    # SEO plan
    story += [P("9. 从数据到 SEO 增长：产品应如何闭环", styles, "H1")]
    story += [P("你的第二层想法是正确的：数据只有在变成增长动作时才更有付费价值。但“利用爬取数据做 SEO”必须强调原创判断与用户价值，不能把抓来的帖子轻改后批量发布。Google 当前政策明确反对自动造链和无新增价值的规模化/抓取内容。" + refs("S33"), styles)]
    story += [P("9.1 Growth Pack 的 5 类输出", styles, "H2")]
    growth_pack = [
        ["输出", "从证据如何生成", "成功标准"],
        ["Problem pages", "3+ 独立来源的重复痛点 → 问题/解决方案页", "包含原创测试、截图、方法与引用"],
        ["Comparison pages", "竞品替代方案与切换触发 → A vs B / alternatives", "不编造功能；说明适用边界"],
        ["Issue-led docs", "高频安装/错误 Issue → troubleshooting/guide", "能减少 support 与搜索跳出"],
        ["Programmatic pages", "只有当模板字段有独立价值时扩展", "每页有唯一数据与洞察，不是换关键词"],
        ["Monitoring loop", "新 Issue/讨论升温 → 更新旧内容", "内容 freshness 与实际转化提升"],
    ]
    story += [styled_table(growth_pack, [36 * mm, 81 * mm, 57 * mm], styles)]
    story += [P("9.2 外链提交工作流的安全版本", styles, "H2")]
    safe_link = [
        ["步骤", "自动化", "必须人工"],
        ["机会筛选", "检测行业/地域相关性、索引状态、nofollow/sponsored、垃圾迹象", "批准目标站点"],
        ["资料准备", "从品牌知识库预填名称、描述、Logo、URL、类别", "确认最终文案与账号归属"],
        ["表单执行", "导航、字段映射、草稿、状态记录", "CAPTCHA、邮箱/短信验证、最终提交"],
        ["结果验证", "跟踪 approved/indexed/referral、失效提醒", "处理拒绝与付费目录决策"],
    ]
    story += [styled_table(safe_link, [28 * mm, 86 * mm, 60 * mm], styles)]
    story += [callout("把成功指标从“提交了 30 个站”改成“获得了多少条被批准、被索引、相关且可维护的高质量引用”。这会自然淘汰低价值目录，也避免产品被 CAPTCHA 成功率绑架。", styles, GREEN)]
    story += [PageBreak()]

    # Risks
    story += [P("10. 风险清单与产品护栏", styles, "H1")]
    risks = [
        ["风险", "严重度", "早期信号", "护栏"],
        ["Reddit 商业授权", "致命", "无法获得协议、保留/删除义务不清", "MVP 不直抓；商业协议/授权供应商/用户导入"],
        ["X 非 API 自动化", "致命", "账号锁定、403、官方政策冲突", "只用官方 API 或授权数据；不做 browser scraping"],
        ["反爬军备竞赛", "高", "成功率波动、代理成本上升", "外购基础设施；按成功交付计费；失败原因透明"],
        ["洞察幻觉", "高", "模型生成结论找不到原帖", "所有结论绑定 source IDs；无证据则不输出"],
        ["一次性使用", "高", "用户只下载一次报告", "监控/diff/周报绑定持续 JTBD"],
        ["数据隐私与删除", "高", "长期存储用户名与内容", "最小化、保留期、删除传播、审计日志"],
        ["SEO 低质扩张", "中高", "大量相似页面、低转化目录", "原创增值 gate；质量而非数量 KPI"],
        ["credits 不透明", "中高", "默认路由导致超预算", "预算、dry-run、缓存、可覆盖路由"],
    ]
    story += [styled_table(risks, [36 * mm, 18 * mm, 57 * mm, 63 * mm], styles)]
    story += [P("10.1 明确的 No-Go 条件", styles, "H2")]
    for text in [
        "核心用户坚持“必须无限抓 Reddit/X”，但无法接受官方 API/商业授权成本。",
        "10 个 concierge 用户中没有 2 个愿意为报告或持续监控付费。",
        "用户只想要原始数据导出，不在乎聚类、证据、行动或持续更新。",
        "两周复用率低于 20%，说明问题更像一次性咨询而非 SaaS。",
        "数据成本 + 模型成本超过收入的 35%，且不能通过缓存/用户自带 key 改善。",
    ]:
        story.append(bullet(text, styles))
    story += [P("10.2 最终决策", styles, "H2")]
    story += [callout("GO：用 14 天 concierge 验证“GitHub Issue 证据 → 产品与 SEO 决策”的付费；通过后开源 CLI + Skill。NO-GO：通用 Firecrawl 克隆、未授权 Reddit/X scraper、以 CAPTCHA 绕过或批量外链提交为核心。", styles, GREEN), PageBreak()]

    # One-page brief
    story += [P("11. 一页产品 Brief", styles, "H1")]
    brief = [
        ["项目", "建议"],
        ["工作名", "SignalKit / PainLedger / EvidenceOS（先不急于定品牌）"],
        ["ICP", "独立开发者、DevTool PM、开源作者、startup studio、轻量 SEO/内容团队"],
        ["核心 JTBD", "在数百/数千条 Issue 与讨论中，快速确认哪些痛点重复、强烈、近期且值得行动"],
        ["输入", "GitHub repos、关键词、竞品、时间范围；后续接 HN/Discourse/RSS 与授权数据"],
        ["输出", "evidence.csv、pain-report.md、opportunities.json、seo-briefs.md、weekly-diff.md"],
        ["免费", "本地 CLI、GitHub connector、手动运行、基础聚类、Markdown 导出"],
        ["付费", "定时、历史、团队、API/webhook、白标 PDF、预算控制、合规数据源"],
        ["非目标", "通用浏览器代理、验证码绕过、账号农场、未授权社媒抓取、批量低质外链"],
        ["14 天成功", "10 份 concierge 报告；2 个付费；3 个明确请求持续监控"],
        ["90 天成功", "30 完整用户、≥40% 两周复用、5 个 $29+ 付费、3 个公开案例"],
    ]
    story += [styled_table(brief, [34 * mm, 140 * mm], styles)]
    story += [Spacer(1, 5 * mm), callout("最重要的战略变化：把“爬虫产品”重新定义为“证据到行动的产品”。爬虫只是供应链中的一个可替换部件；证据质量、合规连接器、持续状态和增长闭环才是可积累的资产。", styles, BLUE), PageBreak()]

    # Sources
    story += [P("附录 A：来源索引", styles, "H1")]
    story += [P("所有链接均为可点击链接。访问日期默认为 2026-08-17；发布日期见日期列。", styles)]
    src_rows = [["ID", "平台/日期", "来源与核心信号", "等级"]]
    for s in sources:
        domain = urlparse(s.url).netloc.replace("www.", "")
        title = f'<link href="{s.url}" color="#246BFD"><b>{s.title}</b></link><br/><font color="#5F6B7A">{domain}</font><br/>{s.signal}'
        src_rows.append([
            s.id,
            f"{s.platform}<br/>{s.date}",
            Paragraph(title, styles["TableCell"]),
            {"high": "高", "medium": "中", "low": "低"}.get(s.confidence, s.confidence),
        ])
    story += [styled_table(src_rows, [13 * mm, 31 * mm, 116 * mm, 14 * mm], styles)]
    story += [Spacer(1, 4 * mm), P("研究文件：research/evidence_ledger.csv；报告生成脚本：generate_report.py。", styles, "Caption")]
    return story


def main() -> None:
    register_fonts()
    sources, source_map = load_sources()
    styles = build_styles()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = ReportDocTemplate(
        str(OUT),
        pagesize=A4,
        title="AI 爬虫与洞察 SaaS 创业机会深度验证报告",
        author="OpenAI Codex",
        subject="Firecrawl 增长拆解、GitHub/Reddit/X 用户痛点、竞品分析与市场验证",
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
    )
    story = build_story(sources, source_map, styles)
    doc.multiBuild(story)
    print(OUT)


if __name__ == "__main__":
    main()
