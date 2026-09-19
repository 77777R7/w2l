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
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    out = Path(args.out)
    (out / "markdown").mkdir(parents=True, exist_ok=True)
    metadata = {
        "tool": "crawl4ai",
        "version": "0.9.3",
        "python": sys.version,
        "platform": platform.platform(),
        "command": "crawl4ai==0.9.3 AsyncWebCrawler CacheMode.BYPASS",
        "costModel": {"type": "runner_wall_time", "usdPerHour": 0.0, "assumption": "self-hosted compute is not billed by the comparator"},
    }
    (out / "environment.json").write_text(json.dumps(metadata, indent=2) + "\n")
    records = []
    async with AsyncWebCrawler() as crawler:
        for case in manifest["suite"]["cases"]:
            started = time.perf_counter()
            try:
                result = await crawler.arun(case["target"], config=CrawlerRunConfig(cache_mode=CacheMode.BYPASS))
                markdown = markdown_value(result.markdown)
                record = {
                    "id": case["id"],
                    "url": case["target"],
                    "success": bool(result.success),
                    "markdown": markdown,
                    "error": result.error_message or "",
                    "wallMs": round((time.perf_counter() - started) * 1000),
                    "raw": str(result),
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
