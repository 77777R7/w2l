#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import platform
import sys
import time
from pathlib import Path

from crawl4ai import AsyncWebCrawler, CacheMode, CrawlerRunConfig


async def reset_fixture(manifest):
    import urllib.request
    urllib.request.urlopen(urllib.request.Request(manifest["reset"]["endpoint"], method="POST"), timeout=5).close()


def markdown_value(value):
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    return getattr(value, "raw_markdown", None) or getattr(value, "fit_markdown", None) or str(value)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--mode", choices=["default", "filtered"], default="default")
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    out = Path(args.out)
    (out / "markdown").mkdir(parents=True, exist_ok=True)
    metadata = {
        "tool": "crawl4ai",
        "version": "0.9.3",
        "python": sys.version,
        "platform": platform.platform(),
        "command": f"crawl4ai==0.9.3 mode={args.mode} AsyncWebCrawler CacheMode.BYPASS",
        "costModel": {"type": "runner_wall_time", "usdPerHour": 0.0, "assumption": "self-hosted compute is not billed by the comparator"},
    }
    (out / "environment.json").write_text(json.dumps(metadata, indent=2) + "\n")
    records = []
    await reset_fixture(manifest)
    async with AsyncWebCrawler() as crawler:
        for case in manifest["suite"]["cases"]:
            started = time.perf_counter()
            try:
                config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS)
                if args.mode == "filtered":
                    from crawl4ai import DefaultMarkdownGenerator
                    from crawl4ai.content_filter_strategy import PruningContentFilter
                    config.markdown_generator = DefaultMarkdownGenerator(content_filter=PruningContentFilter(threshold=0.4, threshold_type="fixed"))
                result = await crawler.arun(case["target"], config=config)
                markdown = markdown_value(result.markdown)
                record = {
                    "id": case["id"],
                    "url": case["target"],
                    "success": bool(result.success),
                    "markdown": markdown,
                    "error": result.error_message or "",
                    "wallMs": round((time.perf_counter() - started) * 1000),
                    "raw": str(result),
                    "rawResult": {
                        "success": bool(result.success),
                        "url": getattr(result, "url", None),
                        "redirectedUrl": getattr(result, "redirected_url", None),
                        "errorMessage": result.error_message or "",
                        "markdownType": type(result.markdown).__name__,
                    },
                }
            except Exception as exc:
                record = {
                    "id": case["id"], "url": case["target"], "success": False,
                    "markdown": "", "error": repr(exc),
                    "wallMs": round((time.perf_counter() - started) * 1000),
                }
            (out / "markdown" / f"{case['id']}.md").write_text(record["markdown"])
            records.append(record)
    (out / "raw.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
