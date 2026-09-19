#!/usr/bin/env python3
import argparse
import json
import platform
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:3002")
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    out = Path(args.out)
    (out / "markdown").mkdir(parents=True, exist_ok=True)
    (out / "environment.json").write_text(json.dumps({
        "tool": "firecrawl-self-hosted", "version": "v2.11.162",
        "platform": platform.platform(), "python": sys.version,
        "command": "POST /v2/scrape formats=[markdown] timeout=60000",
    }, indent=2) + "\n")
    records = []
    for case in manifest["suite"]["cases"]:
        started = time.perf_counter()
        payload = json.dumps({"url": case["target"], "formats": ["markdown"], "timeout": 60000}).encode()
        request = Request(f"{args.base_url}/v2/scrape", data=payload, headers={"content-type": "application/json"})
        try:
            with urlopen(request, timeout=75) as response:
                body = json.loads(response.read())
            data = body.get("data", {}) if isinstance(body, dict) else {}
            markdown = data.get("markdown", "") or ""
            record = {"id": case["id"], "url": case["target"], "success": bool(body.get("success")), "markdown": markdown, "error": body.get("error", ""), "wallMs": round((time.perf_counter() - started) * 1000), "raw": body}
        except Exception as exc:
            record = {"id": case["id"], "url": case["target"], "success": False, "markdown": "", "error": repr(exc), "wallMs": round((time.perf_counter() - started) * 1000)}
        (out / "markdown" / f"{case['id']}.md").write_text(record["markdown"])
        records.append(record)
    (out / "raw.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
