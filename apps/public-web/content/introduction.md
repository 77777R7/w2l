# One link. Web data, ready.

W2L turns a public web page into readable content and, on supported pages, fields you can check against the source. [Try a page now](/), then use these guides when you need a durable task or an MCP connection.

> **Availability:** Try the page preview at the URL where you are reading this. The MCP walkthrough below is verified on the same computer as the client. A permanent HTTPS MCP address and browser login are still pending validation. A hosted page preview does not include hosted MCP or persistent Monitor tasks.

## Try W2L

Paste `https://docs.firecrawl.dev/introduction` into [the W2L page](/) and select **Extract page**. The result shows readable Markdown, the final URL, a page status, and the time from submission until the result is visible. You can switch between Markdown and result JSON, then copy or download the output without another extraction.

This is a recorded result from the W2L capture path, not a guaranteed response for every future visit:

```json
{
  "observedAt": "2026-09-24T08:52:01.350Z",
  "sourceCommit": "936fdf0",
  "requestedUrl": "https://docs.firecrawl.dev/introduction",
  "status": "success",
  "finalUrl": "https://docs.firecrawl.dev/introduction",
  "title": "Introduction",
  "totalMs": 2509,
  "excerpt": "Get Started\n# Introduction"
}
```

`totalMs` above is the server-side measurement from that capture. The web page displays the longer client-visible time, including network and rendering. A successful page capture does not mean every optional structured field was found.

## When W2L cannot read a page

W2L reports a reason instead of inventing content. In another real local capture on the same source commit, a LinkedIn feed URL was stopped by the site's automated-access policy:

```json
{
  "observedAt": "2026-09-24T08:52:48.374Z",
  "sourceCommit": "936fdf0",
  "requestedUrl": "https://www.linkedin.com/feed/",
  "status": "blocked",
  "reason": "This site does not allow automated preview of this page.",
  "finalUrl": "https://www.linkedin.com/feed/",
  "totalMs": 572
}
```

The preview did not return readable feed content in this result. A separate X request from this local machine **timed out**, so it is not used as an example of a site block. See [result states and limits](/docs/limits/) for the difference.

## Choose your next step

- [Extract a public page](/docs/guides/extract-page/) for the browser workflow.
- [Connect MCP](/docs/connect-mcp/) to ask Codex to preview, monitor, or batch pages with the local service.
- [Check Amazon.sg product JSON](/docs/guides/amazon-product/) when subject identity, region, and currency matter.
